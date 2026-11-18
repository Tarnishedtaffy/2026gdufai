import { describe, expect, it, vi } from 'vitest';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { CaptureDraft, ImportBatch } from '../../src/modules/capture/index.ts';
import { context, deferred, draft, idGenerator, response } from './helpers.ts';

describe('M1 用户确认流程', () => {
  it('准备及修改均不导入，明确提交时发送修改后的元金额', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const prepared = session.prepare(context, [draft()]);
    session.update(prepared.records[0]!.record.recordId, { amount: 32.5, merchant: '演示商户' });
    expect(importBatch).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('draft');
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch).toHaveBeenCalledTimes(1);
    expect(importBatch.mock.calls[0]![0].records[0]).toMatchObject({ amount: 32.5, merchant: '演示商户' });
  });

  it('模型与修改载荷不能覆盖可信身份，外部副本修改不污染会话', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const source = { ...draft(), userId: 'untrusted', recordId: 'untrusted', idempotencyKey: 'untrusted' };
    const originalContext = { ...context };
    const prepared = session.prepare(originalContext, [source]);
    const original = { ...prepared.records[0]!.record };
    session.update(original.recordId, { userId: 'changed', recordId: 'changed', idempotencyKey: 'changed' } as Partial<CaptureDraft>);
    prepared.records[0]!.record.amount = 999;
    source.amount = 888;
    originalContext.sentAt = '2026-11-18T09:00:00+08:00';
    await session.submit();
    expect(importBatch.mock.calls[0]![0]).toMatchObject({ sentAt: context.sentAt, records: [original] });
  });

  it('未知信息保留 null，原消息时间原样传递，不猜发生时间或方向', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    session.prepare(context, [draft({ amount: null })]);
    await session.submit();
    expect(importBatch.mock.calls[0]![0]).toMatchObject({ version: 1, sentAt: context.sentAt,
      records: [{ amount: null, merchant: null, direction: null, occurredAt: null, chatAt: null, confidence: null }] });
    expect(importBatch.mock.calls[0]![0]).not.toHaveProperty('sessionId');
  });

  it.each(['2026-11-17T09:00:00Z', '2026-02-30T09:00:00+08:00'])('拒绝含歧义或无效的时间 %s', sentAt => {
    const importBatch = vi.fn();
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    expect(() => session.prepare({ ...context, sentAt }, [draft()])).toThrow();
    expect(session.getSnapshot().phase).toBe('empty');
    expect(importBatch).not.toHaveBeenCalled();
  });

  it('非法修改整体拒绝，不截断金额或把非法值猜成有效值', () => {
    const session = createCaptureSession({ importBatch: vi.fn(), newId: idGenerator() });
    const recordId = session.prepare(context, [draft()]).records[0]!.record.recordId;
    expect(() => session.update(recordId, { amount: 12.345 })).toThrow();
    expect(session.getSnapshot().records[0]!.record.amount).toBe(12.5);
    expect(() => session.prepare(context, [draft({ confidence: 2 })])).toThrow();
    expect(session.getSnapshot().records[0]!.record.recordId).toBe(recordId);
  });

  it('连续双击共用一个 Promise，提交中阻止修改和替换草稿', async () => {
    const pending = deferred<unknown>();
    const importBatch = vi.fn((_batch: ImportBatch) => pending.promise);
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const recordId = session.prepare(context, [draft()]).records[0]!.record.recordId;
    const first = session.submit(), second = session.submit();
    expect(first).toBe(second);
    expect(session.getSnapshot().phase).toBe('submitting');
    expect(() => session.update(recordId, { amount: 20 })).toThrow();
    expect(() => session.prepare(context, [draft()])).toThrow();
    await Promise.resolve();
    expect(importBatch).toHaveBeenCalledTimes(1);
    pending.resolve(response(importBatch.mock.calls[0]![0]));
    await first;
    await session.submit();
    expect(importBatch).toHaveBeenCalledTimes(1);
    expect(() => session.update(recordId, { amount: 20 })).toThrow();
  });

  it('网络结果不确定时冻结原批次，重试载荷逐字段相同且 duplicate 按成功处理', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch, [{ status: 'duplicate' }]));
    importBatch.mockRejectedValueOnce(new Error('网络超时'));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const recordId = session.prepare(context, [draft()]).records[0]!.record.recordId;
    expect(await session.submit()).toMatchObject({ phase: 'retry', error: '网络超时' });
    expect(() => session.update(recordId, { amount: 30 })).toThrow();
    expect(() => session.prepare(context, [draft()])).toThrow();
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch.mock.calls[1]![0]).toEqual(importBatch.mock.calls[0]![0]);
  });

  it('批量乱序结果按 recordId 配对，补充后只重发 pending 记录并保留原幂等键', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => {
      const answer = response(batch, batch.records.length === 3 ? [
        {}, { status: 'pending_followup', transactionId: null,
          feedback: [{ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' }] },
        { status: 'rejected', transactionId: null },
      ] : []);
      answer.results.reverse();
      return answer;
    });
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const prepared = session.prepare(context, [draft(), draft({ amount: null }), draft()]);
    const pendingRecord = prepared.records[1]!.record;
    const first = await session.submit();
    expect(first.phase).toBe('pending_followup');
    expect(first.records.map(row => row.result?.status)).toEqual(['confirmed', 'pending_followup', 'rejected']);
    expect(() => session.prepare(context, [draft()])).toThrow();
    session.update(pendingRecord.recordId, { amount: 18 });
    const final = await session.submit();
    expect(final.phase).toBe('complete');
    expect(importBatch.mock.calls[1]![0].records).toEqual([{ ...pendingRecord, amount: 18 }]);
    expect(importBatch.mock.calls[1]![0].batchId).not.toBe(importBatch.mock.calls[0]![0].batchId);
    expect(final.records[0]!.result).toEqual(first.records[0]!.result);
  });
});
