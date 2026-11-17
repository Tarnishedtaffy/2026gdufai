import { describe, expect, it, vi } from 'vitest';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { ImportBatch } from '../../src/modules/capture/index.ts';
import { context, draft, idGenerator, response } from './helpers.ts';

/** Issue #7 的 M1 契约流程测试；预设 M2 回执，不在 stub 中实现 M2 的业务判断。 */
describe('M1 根据 M2 反馈继续用户确认', () => {
  it.each([
    { label: '缺时间', occurredAt: null, code: 'MISSING_TIME' },
    { label: '未来时间', occurredAt: '2099-11-17T08:00:00+08:00', code: 'FUTURE_TIME' },
  ])('$label 首轮追问，次轮回显 M2 实际采用的聊天时间', async ({ occurredAt, code }) => {
    const returnedTime = '2026-11-17T08:42:00+08:00';
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    importBatch.mockImplementationOnce(async batch => response(batch, [{
      status: 'pending_followup', transactionId: null, occurredAt,
      feedback: [{ field: 'occurredAt', code, severity: 'blocking' }],
    }])).mockImplementationOnce(async batch => response(batch, [{
      occurredAt: returnedTime,
      feedback: [{ field: 'occurredAt', code: 'TIME_DEFAULTED_TO_CHAT_TIME', severity: 'warning' }],
    }]));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const initial = session.prepare({ ...context, chatAt: returnedTime }, [draft({ occurredAt, direction: 'expense' })]);

    const first = await session.submit();
    expect(first.phase).toBe('pending_followup');
    expect(first.records[0]!.messages).toMatchObject([{ code, severity: 'blocking' }]);
    expect(importBatch).toHaveBeenCalledTimes(1);
    const second = await session.submit();

    expect(second.phase).toBe('complete');
    expect(second.records[0]!.result?.occurredAt).toBe(returnedTime);
    expect(second.records[0]!.messages[0]).toMatchObject({
      code: 'TIME_DEFAULTED_TO_CHAT_TIME', severity: 'warning', text: expect.stringContaining(returnedTime),
    });
    for (const [batch] of importBatch.mock.calls) {
      expect(batch.sentAt).toBe(context.sentAt);
      expect(batch.records[0]).toMatchObject({ occurredAt, chatAt: returnedTime,
        idempotencyKey: initial.records[0]!.record.idempotencyKey });
    }
  });

  it('方向冲突先显示追问，确认后按 M2 返回的收入方向和类别展示', async () => {
    const category = { id: 9, name: '工资', kind: 'income' as const };
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    importBatch.mockImplementationOnce(async batch => response(batch, [{
      status: 'pending_followup', transactionId: null, direction: 'expense', category,
      feedback: [{ field: 'direction', code: 'CATEGORY_KIND_MISMATCH', severity: 'blocking' }],
    }])).mockImplementationOnce(async batch => response(batch, [{
      direction: 'income', category,
      feedback: [{ field: 'direction', code: 'DIRECTION_FORCED_BY_CATEGORY', severity: 'warning' }],
    }]));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const initial = session.prepare(context, [draft({ direction: 'expense', rawText: '演示工资 100 元', amount: 100 })]);

    const first = await session.submit();
    expect(first.phase).toBe('pending_followup');
    expect(first.records[0]!.messages[0]?.code).toBe('CATEGORY_KIND_MISMATCH');
    expect(importBatch).toHaveBeenCalledTimes(1);
    const second = await session.submit();

    expect(second.phase).toBe('complete');
    expect(second.records[0]!.result).toMatchObject({ direction: 'income', category });
    expect(second.records[0]!.messages[0]).toMatchObject({
      code: 'DIRECTION_FORCED_BY_CATEGORY', severity: 'warning', text: expect.stringContaining('收入'),
    });
    for (const [batch] of importBatch.mock.calls) {
      expect(batch.records[0]).toMatchObject({ direction: 'expense', amount: 100,
        idempotencyKey: initial.records[0]!.record.idempotencyKey });
      expect(batch.records[0]).not.toHaveProperty('categoryId');
    }
  });

  it('退款按 M2 的 rejected 结果提示作废原账单，不自动记为收入或再次提交', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch, [{
      status: 'rejected', transactionId: null,
      feedback: [{ field: 'amount', code: 'REFUND_NOT_SUPPORTED', severity: 'blocking' }],
    }]));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const initial = session.prepare(context, [draft({ rawText: '演示商品退款 12.50 元', direction: 'expense' })]);
    expect(importBatch).not.toHaveBeenCalled();

    const snapshot = await session.submit();
    expect(snapshot.phase).toBe('complete');
    expect(snapshot.records[0]!.result?.status).toBe('rejected');
    expect(snapshot.records[0]!.messages[0]).toMatchObject({
      code: 'REFUND_NOT_SUPPORTED', severity: 'blocking', text: expect.stringContaining('作废原账单'),
    });
    expect(importBatch.mock.calls[0]![0].records[0]).toMatchObject({ amount: 12.5, direction: 'expense' });
    expect(() => session.update(initial.records[0]!.record.recordId, { direction: 'income' })).toThrow();
    await session.submit();
    expect(importBatch).toHaveBeenCalledTimes(1);
  });

  it('第三次由 M2 返回 rejected 后保持只读，M1 不发送或自行维护 followupRound', async () => {
    const feedback = [{ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' as const }];
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch, [{
      status: 'pending_followup', transactionId: null, feedback,
    }]));
    importBatch.mockImplementationOnce(async batch => response(batch, [{
      status: 'pending_followup', transactionId: null, feedback,
    }])).mockImplementationOnce(async batch => response(batch, [{
      status: 'pending_followup', transactionId: null, feedback,
    }])).mockImplementationOnce(async batch => response(batch, [{ status: 'rejected', transactionId: null, feedback }]));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const initial = session.prepare(context, [draft({ amount: null })]);

    expect((await session.submit()).phase).toBe('pending_followup');
    expect(importBatch).toHaveBeenCalledTimes(1);
    expect((await session.submit()).phase).toBe('pending_followup');
    expect(importBatch).toHaveBeenCalledTimes(2);
    const third = await session.submit();
    expect(third.phase).toBe('complete');
    expect(third.records[0]!.result?.status).toBe('rejected');
    expect(() => session.update(initial.records[0]!.record.recordId, { amount: 20 })).toThrow();
    expect((await session.submit()).records[0]!.result?.status).toBe('rejected');
    expect(importBatch).toHaveBeenCalledTimes(3);
    for (const [batch] of importBatch.mock.calls) {
      expect(batch).not.toHaveProperty('followupRound');
      expect(batch.records[0]).not.toHaveProperty('followupRound');
      expect(batch.records[0]).toMatchObject({ amount: null, idempotencyKey: initial.records[0]!.record.idempotencyKey });
    }
  });

  it.each([
    { modality: 'voice' as const, sourceRef: 'uploads/2026/11/demo-voice.webm' },
    { modality: 'image' as const, sourceRef: 'uploads/2026/11/demo-receipt.jpg' },
  ])('$modality 草稿使用相同确认与追问流程，源文件引用重发时保持不变', async ({ modality, sourceRef }) => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    importBatch.mockImplementationOnce(async batch => response(batch, [{
      status: 'pending_followup', transactionId: null,
      feedback: [{ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' }],
    }]));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const initial = session.prepare(context, [draft({ modality, sourceRef, amount: null, rawText: '演示商户消费' })]);
    expect(importBatch).not.toHaveBeenCalled();
    expect((await session.submit()).phase).toBe('pending_followup');
    session.update(initial.records[0]!.record.recordId, { amount: 32.5, merchant: '核对后的演示商户' });
    expect(importBatch).toHaveBeenCalledTimes(1);
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch.mock.calls[1]![0].records[0]?.amount).toBe(32.5);
    for (const [batch] of importBatch.mock.calls) {
      expect(batch.records[0]).toMatchObject({ modality, sourceRef, rawText: '演示商户消费',
        idempotencyKey: initial.records[0]!.record.idempotencyKey });
    }
  });
});
