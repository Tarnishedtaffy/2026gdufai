import { afterEach, expect, it } from 'vitest';
import { createLedgerHarness, type LedgerHarness } from './ledger-harness.ts';

const opened: LedgerHarness[] = [];
function ledger(env: NodeJS.ProcessEnv = {}) {
  const harness = createLedgerHarness(env);
  opened.push(harness);
  return harness;
}
afterEach(async () => { await Promise.all(opened.splice(0).map(harness => harness.close())); });

it('真实 M2 永久 400 后明确放弃，清本地状态并允许重新准备正确身份的记录', async () => {
  const h = ledger({ DEMO_USER_ID: 'u_owner' });
  const original = h.session.prepare({ ...h.context, userId: 'u_001' }, [h.draft()]);
  expect((await h.session.submit()).error).toContain('INVALID_BATCH');
  expect((await h.session.submit()).phase).toBe('retry');
  expect(h.batches[1]).toEqual(h.batches[0]);
  expect(h.transactionCount()).toBe(0);
  expect(h.session.discard()).toEqual({ phase: 'empty', sessionId: null, batchId: null, records: [], error: null });
  expect(h.batches).toHaveLength(2);
  const next = h.session.prepare(h.context, [h.draft()]);
  expect(next.records[0]!.record.idempotencyKey).not.toBe(original.records[0]!.record.idempotencyKey);
  expect((await h.session.submit()).phase).toBe('complete');
  expect(h.transactionCount()).toBe(1);
});

it('真实入库后回执丢失，放弃仅清本地重试信息，不撤销账单或自动再提交', async () => {
  const h = ledger();
  const session = h.newSession(async batch => {
    await h.importBatch(batch);
    throw new Error('模拟真实入库后丢失回执');
  });
  const original = session.prepare(h.context, [h.draft()]);
  expect((await session.submit()).phase).toBe('retry');
  expect(h.transactionCount()).toBe(1);
  expect(session.discard().phase).toBe('empty');
  expect(h.transactionCount()).toBe(1);
  expect(h.batches).toHaveLength(1);
  const next = session.prepare(h.context, [h.draft({ rawText: '明确新建的另一笔虚构消费' })]);
  expect(next.records[0]!.record.recordId).not.toBe(original.records[0]!.record.recordId);
  expect(h.batches).toHaveLength(1);
  expect(h.transactionCount()).toBe(1);
});

it('超大识别金额在调用真实 M2 之前拦截，不污染整数分列', () => {
  const h = ledger();
  expect(() => h.session.prepare(h.context, [h.draft({ amount: 1e20 })])).toThrow('金额超出');
  expect(h.batches).toHaveLength(0);
  expect(h.transactionCount()).toBe(0);
});
