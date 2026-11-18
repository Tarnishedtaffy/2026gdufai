import { describe, expect, it, vi } from 'vitest';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { ImportBatch, ImportResult } from '../../src/modules/capture/index.ts';
import { context, draft, idGenerator, response } from './helpers.ts';

describe('M1 对 M2 回执的边界处理', () => {
  it('v1.2 分类候选随反馈原样保留，修改快照不影响原回执', async () => {
    const candidates = [{ id: 1, name: '餐饮' }, { id: 3, name: '购物' }];
    const session = createCaptureSession({ newId: idGenerator(), importBatch: async batch => response(batch, [{
      feedback: [{ field: 'category', code: 'LOW_CONFIDENCE_CATEGORY', severity: 'warning', candidates }],
    }]) });
    session.prepare(context, [draft()]);
    const snapshot = await session.submit();
    expect(snapshot.records[0]!.result?.feedback[0]).toMatchObject({ candidates });
    expect(snapshot.records[0]!.messages[0]).toMatchObject({ candidates });
    snapshot.records[0]!.result!.feedback[0]!.candidates![0]!.name = '改写';
    expect(session.getSnapshot().records[0]!.result!.feedback[0]!.candidates).toEqual(candidates);
  });

  it.each([
    { candidates: Array.from({ length: 4 }, (_, index) => ({ id: index + 1, name: '候选' })) },
    { candidates: [{ id: '1', name: '餐饮' }] }, { candidates: [{ id: 1, name: '' }] },
  ])('非法分类候选使整批保留为可安全重试', async ({ candidates }) => {
    const session = createCaptureSession({ newId: idGenerator(), importBatch: async batch => ({
      ...response(batch), results: [{ ...response(batch).results[0], feedback: [
        { field: 'category', code: 'LOW_CONFIDENCE_CATEGORY', severity: 'warning', candidates },
      ] }],
    }) });
    session.prepare(context, [draft()]);
    expect((await session.submit()).phase).toBe('retry');
    expect(session.getSnapshot().records[0]!.result).toBeNull();
  });

  const invalidResponses: [string, (batch: ImportBatch) => unknown][] = [
    ['错批', batch => ({ ...response(batch), batchId: 'other_batch' })],
    ['漏项', batch => ({ ...response(batch), results: response(batch).results.slice(0, 1) })],
    ['重复记录', batch => ({ ...response(batch), results: [response(batch).results[0], response(batch).results[0]] })],
    ['未知记录', batch => response(batch, [{ recordId: 'other_record' }])],
    ['非法状态', batch => response(batch, [{ status: 'other' as ImportResult['status'] }])],
    ['缺账单标识', batch => response(batch, [{ transactionId: null }])],
    ['非法反馈', batch => response(batch, [{ feedback: [{ field: 'amount', code: 'MISSING_AMOUNT',
      severity: 'other' as 'blocking' }] }])],
  ];

  it.each(invalidResponses)('%s 响应不部分应用，保留原批次安全重试', async (_name, badResponse) => {
    const importBatch = vi.fn(async (batch: ImportBatch): Promise<unknown> => response(batch));
    importBatch.mockImplementationOnce(async batch => badResponse(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    session.prepare(context, [draft(), draft()]);
    const invalid = await session.submit();
    expect(invalid.phase).toBe('retry');
    expect(invalid.records.every(row => row.result === null)).toBe(true);
    expect(invalid.error).toBeTruthy();
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch.mock.calls[1]![0]).toEqual(importBatch.mock.calls[0]![0]);
  });

  it('反馈原样保留 code/severity，duplicate 即使带 blocking 仍完成，不触发追问', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch, [{ status: 'duplicate', feedback: [
      { field: null, code: 'DUPLICATE_RECORD', severity: 'blocking' },
      { field: 'merchant', code: 'MERCHANT_DEFAULTED', severity: 'warning' },
    ] }]));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    session.prepare(context, [draft()]);
    const result = await session.submit();
    expect(result.phase).toBe('complete');
    expect(result.records[0]!.messages).toMatchObject([
      { code: 'DUPLICATE_RECORD', severity: 'blocking', text: expect.stringContaining('已经记过') },
      { code: 'MERCHANT_DEFAULTED', severity: 'warning' },
    ]);
    await session.submit();
    expect(importBatch).toHaveBeenCalledTimes(1);
  });

  it('未知的增量反馈码仍保留语义，界面有可读的备用话术', async () => {
    const session = createCaptureSession({ newId: idGenerator(), importBatch: async batch => response(batch, [{
      status: 'pending_followup', transactionId: null,
      feedback: [{ field: 'merchant', code: 'ADDITIONAL_CHECK', severity: 'blocking' }],
    }]) });
    session.prepare(context, [draft()]);
    const result = await session.submit();
    expect(result.records[0]!.messages[0]).toEqual({
      field: 'merchant', code: 'ADDITIONAL_CHECK', severity: 'blocking', text: '请检查 merchant（ADDITIONAL_CHECK）。',
    });
  });

  it('批次级 INVALID_BATCH 保留可见错误与原请求，且不应用记录结果', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch): Promise<unknown> => response(batch));
    importBatch.mockResolvedValueOnce({ error: { code: 'INVALID_BATCH', message: '批次缺少必填字段', field: 'sentAt' } });
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const original = session.prepare(context, [draft()]);
    const failed = await session.submit();
    expect(failed).toMatchObject({ phase: 'retry', error: 'INVALID_BATCH: 批次缺少必填字段' });
    failed.records[0]!.record.amount = 999;
    expect(session.getSnapshot().records).toEqual(original.records);
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch.mock.calls[1]![0]).toEqual(importBatch.mock.calls[0]![0]);
  });

  it('HTTP 客户端抛出的 M2 错误码不会丢失', async () => {
    const failure = Object.assign(new Error('批次无效'), { code: 'INVALID_BATCH' });
    const session = createCaptureSession({ newId: idGenerator(), importBatch: async () => { throw failure; } });
    session.prepare(context, [draft()]);
    expect(await session.submit()).toMatchObject({ phase: 'retry', error: 'INVALID_BATCH: 批次无效' });
  });

  it('实际时间与方向只使用 M2 返回值，空反馈保持空，不补造业务事实', async () => {
    const session = createCaptureSession({ newId: idGenerator(), importBatch: async batch => response(batch, [{
      direction: 'income', occurredAt: '2026-11-16T10:30:00+08:00', feedback: [
        { field: 'occurredAt', code: 'TIME_DEFAULTED_TO_CHAT_TIME', severity: 'warning' },
        { field: 'direction', code: 'DIRECTION_FORCED_BY_CATEGORY', severity: 'warning' },
        { field: null, code: 'toString', severity: 'warning' },
      ],
    }, {}]) });
    session.prepare(context, [draft(), draft()]);
    const snapshot = await session.submit();
    expect(snapshot.records[0]!.messages.map(message => message.text)).toEqual([
      '已按聊天时间记账，发生时间为 2026-11-16T10:30:00+08:00。',
      '已按类别记为收入。', '请检查 这笔记录（toString）。',
    ]);
    expect(snapshot.records[1]!.messages).toEqual([]);
  });
});
