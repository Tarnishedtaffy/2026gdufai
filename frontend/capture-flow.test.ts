import { describe, expect, it, vi } from 'vitest';
import { createCaptureFlow } from './src/composables/useCaptureFlow';
import { mockImportBatch } from './src/mock/import';
import { parseCaptureEdit } from './src/components/capture/capture-form';
import type { CaptureDraft, ImportBatch, ImportRecord } from '../backend/src/modules/capture/index.ts';

const sentAt = '2026-11-17T19:00:00+08:00';
const draft: CaptureDraft = {
  rawText: '虚构测试：午饭 24.5 元', amount: 24.5, merchant: null,
  direction: 'expense', occurredAt: '2026-11-16T12:00:00+08:00',
  modality: 'text', sourceRef: null, confidence: null,
};

function result(record: ImportRecord, status: 'confirmed' | 'pending_followup' | 'rejected' = 'confirmed') {
  return {
    recordId: record.recordId, status, transactionId: status === 'confirmed' ? `tx_${record.recordId}` : null,
    direction: record.direction, occurredAt: record.occurredAt, category: null, confidence: null,
    feedback: status === 'pending_followup' ? [{ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' }] : [],
  };
}

function setup(client: (batch: ImportBatch) => Promise<unknown>, isMock = true) {
  let counter = 0;
  return createCaptureFlow({ importBatch: client, newId: () => `ui-${++counter}`, isMock: () => isMock, now: () => sentAt });
}

describe('M1 确认界面流程适配', () => {
  it('仅修改金额不会截断识别时间的秒数，也不会覆盖其他未编辑字段', async () => {
    const client = vi.fn(async (batch: ImportBatch) => ({ batchId: batch.batchId, results: batch.records.map(record => result(record)) }));
    const flow = setup(client);
    const original = { ...draft, occurredAt: '2026-11-16T12:34:56+08:00', merchant: '虚构午餐店', confidence: 0.91 };
    flow.prepare([original]);
    const recordId = flow.snapshot.value.records[0]!.record.recordId;
    const edit = parseCaptureEdit('amount', '32.50');
    expect(edit).toEqual({ patch: { amount: 32.5 }, error: null });
    expect(flow.update(recordId, edit.patch!)).toBe(true);
    await flow.confirm();
    expect(client.mock.calls[0]?.[0].records[0]).toMatchObject({ ...original, amount: 32.5 });
  });

  it('编辑字段各自生成最小补丁，显式修改时间才归一化时间', () => {
    expect(parseCaptureEdit('merchant', '  虚构商户  ').patch).toEqual({ merchant: '虚构商户' });
    expect(parseCaptureEdit('merchant', '').patch).toEqual({ merchant: null });
    expect(parseCaptureEdit('direction', 'income').patch).toEqual({ direction: 'income' });
    expect(parseCaptureEdit('direction', null).patch).toEqual({ direction: null });
    expect(parseCaptureEdit('occurredAt', '2026-11-16T12:34:56').patch).toEqual({ occurredAt: '2026-11-16T12:34:56+08:00' });
    expect(parseCaptureEdit('occurredAt', '').patch).toEqual({ occurredAt: null });
  });

  it('无效输入不生成覆盖原值的补丁', () => {
    for (const [field, value] of [['amount', '12.345'], ['amount', '999999999999999999999'], ['occurredAt', '2026-02-31T12:00'], ['occurredAt', 'bad'], ['direction', 'unknown']] as const) {
      const edit = parseCaptureEdit(field, value);
      expect(edit.patch).toBeNull();
      expect(edit.error).toBeTruthy();
    }
  });

  it('草稿和修改不调用 M2，确认后按元与 +08:00 提交', async () => {
    const client = vi.fn(async (batch: ImportBatch) => ({ batchId: batch.batchId, results: batch.records.map(record => result(record)) }));
    const flow = setup(client);
    expect(flow.prepare([draft])).toBe(true);
    const first = flow.snapshot.value.records[0]!;
    flow.update(first.record.recordId, { amount: 32.5, merchant: '虚构咖啡店' });
    expect(client).not.toHaveBeenCalled();
    expect(flow.snapshot.value.phase).toBe('draft');
    await flow.confirm();
    const batch = client.mock.calls[0]![0];
    expect(batch.records[0]).toMatchObject({ amount: 32.5, merchant: '虚构咖啡店', sourceRef: null, userId: 'demo-user' });
    expect(batch.records[0]?.occurredAt).toBe('2026-11-16T12:00:00+08:00');
    expect(flow.snapshot.value.phase).toBe('complete');
  });

  it('真实模式没有可信会话时禁止生成 demo-user 的真实请求', async () => {
    const client = vi.fn(async () => ({}));
    const flow = setup(client, false);
    expect(flow.canPrepare.value).toBe(false);
    expect(flow.prepare([draft])).toBe(false);
    expect(flow.inputError.value).toContain('登录会话');
    await flow.confirm();
    expect(client).not.toHaveBeenCalled();
  });

  it('真实模式使用提供的身份，并阻止跨账号提交旧草稿', async () => {
    const client = vi.fn(async (batch: ImportBatch) => ({ batchId: batch.batchId, results: batch.records.map(record => result(record)) }));
    const flow = setup(client, false);
    const trusted = { sessionId: 's_verified', userId: 'u_verified', sentAt, chatAt: sentAt };
    flow.setContextProvider(() => trusted);
    expect(flow.prepare([draft])).toBe(true);
    flow.setContextProvider(() => ({ ...trusted, userId: 'u_other' }));
    await flow.confirm();
    expect(client).not.toHaveBeenCalled();
    expect(flow.inputError.value).toContain('会话已变化');
    flow.setContextProvider(() => trusted);
    await flow.confirm();
    expect(client.mock.calls[0]?.[0].records[0]?.userId).toBe('u_verified');
  });

  it('并发点击只发送一次，失败重试保留完全相同的载荷', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    const client = vi.fn((batch: ImportBatch): Promise<unknown> => client.mock.calls.length === 1
      ? new Promise((_resolve, reject) => { rejectFirst = reject; })
      : Promise.resolve({ batchId: batch.batchId, results: batch.records.map(record => result(record)) }));
    const flow = setup(client);
    flow.prepare([draft]);
    const first = flow.confirm();
    const doubleClick = flow.confirm();
    await Promise.resolve();
    expect(client).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('模拟网络断开'));
    await Promise.all([first, doubleClick]);
    expect(flow.snapshot.value.phase).toBe('retry');
    const submitted = JSON.stringify(client.mock.calls[0]?.[0]);
    expect(flow.update(flow.snapshot.value.records[0]!.record.recordId, { amount: 99 })).toBe(false);
    await flow.confirm();
    expect(JSON.stringify(client.mock.calls[1]?.[0])).toBe(submitted);
    expect(flow.snapshot.value.phase).toBe('complete');
  });

  it('批量部分完成后只重发待补充记录，保留其幂等键', async () => {
    const client = vi.fn(async (batch: ImportBatch) => ({
      batchId: batch.batchId,
      results: batch.records.map((record, index) => result(record, record.amount === null ? 'pending_followup' : index === 2 ? 'rejected' : 'confirmed')).reverse(),
    }));
    const flow = setup(client);
    flow.prepare([draft, { ...draft, amount: null }, { ...draft, rawText: '虚构退款样例' }]);
    await flow.confirm();
    expect(flow.snapshot.value.records.map(row => row.result?.status)).toEqual(['confirmed', 'pending_followup', 'rejected']);
    const pending = flow.snapshot.value.records[1]!;
    flow.update(pending.record.recordId, { amount: 18 });
    await flow.confirm();
    const resubmitted = client.mock.calls[1]![0].records;
    expect(resubmitted).toHaveLength(1);
    expect(resubmitted[0]).toMatchObject({ recordId: pending.record.recordId, idempotencyKey: pending.record.idempotencyKey, amount: 18 });
    expect(flow.snapshot.value.phase).toBe('complete');
  });

  it('现有 mock 能完成缺金额追问；测试与真实识别、入库无关', async () => {
    const flow = setup(mockImportBatch);
    flow.prepare([{ ...draft, amount: null }]);
    await flow.confirm();
    expect(flow.snapshot.value.phase).toBe('pending_followup');
    const pending = flow.snapshot.value.records[0]!;
    expect(pending.messages.some(message => message.code === 'MISSING_AMOUNT')).toBe(true);
    flow.update(pending.record.recordId, { amount: 18 });
    await flow.confirm();
    expect(flow.snapshot.value.records[0]?.result?.status).toBe('confirmed');
    expect(flow.snapshot.value.records[0]?.record.idempotencyKey).toBe(pending.record.idempotencyKey);
  });
});
