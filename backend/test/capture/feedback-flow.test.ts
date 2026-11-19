import { afterEach, describe, expect, it } from 'vitest';
import { nowIsoShanghai } from '../../src/shared/time.ts';
import { createLedgerHarness, type LedgerHarness } from './ledger-harness.ts';

const opened: LedgerHarness[] = [];
const ledger = () => { const harness = createLedgerHarness(); opened.push(harness); return harness; };
afterEach(async () => { await Promise.all(opened.splice(0).map(harness => harness.close())); });

/** Current real M2 responses replace recordings from the former unmerged PR #9. */
describe('M1 根据真实 M2 反馈继续用户确认', () => {
  it.each(['缺时间', '未来时间'] as const)('%s 首轮追问，次轮回显 M2 采用的聊天时间', async label => {
    const h = ledger();
    const occurredAt = label === '缺时间' ? null : nowIsoShanghai(new Date(Date.now() + 60 * 60 * 1000));
    const code = label === '缺时间' ? 'MISSING_TIME' : 'FUTURE_TIME';
    const returnedTime = nowIsoShanghai(new Date(Date.now() - 2 * 60 * 1000));
    const initial = h.session.prepare({ ...h.context, chatAt: returnedTime }, [h.draft({ occurredAt })]);
    expect(h.transactionCount()).toBe(0);
    expect(h.batches).toHaveLength(0);
    const first = await h.session.submit();
    expect(first.phase).toBe('pending_followup');
    expect(first.records[0]!.messages).toMatchObject([{ code, severity: 'blocking' }]);
    expect(h.transactionCount()).toBe(0);
    const second = await h.session.submit();
    expect(second.phase).toBe('complete');
    expect(second.records[0]!.result?.occurredAt).toBe(returnedTime);
    expect(second.records[0]!.messages).toContainEqual(expect.objectContaining({
      code: 'TIME_DEFAULTED_TO_CHAT_TIME', severity: 'warning', text: expect.stringContaining(returnedTime),
    }));
    expect(h.transactionCount()).toBe(1);
    for (const batch of h.batches) {
      expect(batch.sentAt).toBe(h.context.sentAt);
      expect(batch.records[0]).toMatchObject({ occurredAt, chatAt: returnedTime,
        idempotencyKey: initial.records[0]!.record.idempotencyKey });
    }
  });

  it('方向冲突先显示追问，确认后按 M2 返回的收入类别展示', async () => {
    const h = ledger();
    const initial = h.session.prepare(h.context, [h.draft({ direction: 'expense', merchant: '虚构用工方',
      rawText: '演示工资到账 100 元', amount: 100 })]);
    const first = await h.session.submit();
    expect(first.phase).toBe('pending_followup');
    expect(first.records[0]!.messages[0]?.code).toBe('CATEGORY_KIND_MISMATCH');
    expect(h.transactionCount()).toBe(0);
    const second = await h.session.submit();
    expect(second.phase).toBe('complete');
    expect(second.records[0]!.result).toMatchObject({ direction: 'income', category: { name: '工资', kind: 'income' } });
    expect(second.records[0]!.messages).toContainEqual(expect.objectContaining({
      code: 'DIRECTION_FORCED_BY_CATEGORY', severity: 'warning', text: expect.stringContaining('收入'),
    }));
    for (const batch of h.batches) {
      expect(batch.records[0]).toMatchObject({ direction: 'expense', amount: 100,
        idempotencyKey: initial.records[0]!.record.idempotencyKey });
      expect(batch.records[0]).not.toHaveProperty('categoryId');
    }
  });

  it('按已部署的退款契约展示真实 M2 反馈，兼容 #17 合并前后', async () => {
    const h = ledger();
    const initial = h.session.prepare(h.context, [h.draft({ rawText: '演示商品退款 12.50 元', direction: 'expense' })]);
    expect(h.batches).toHaveLength(0);
    const snapshot = await h.session.submit();
    // #13 先合并；#17 的迁移新增 entry_type。两条契约分支分别在 main 和 #17 副本联调。
    const neutralEntries = (h.db.pragma('table_info(transactions)') as { name: string }[])
      .some(column => column.name === 'entry_type');
    if (neutralEntries) {
      expect(snapshot.phase).toBe('pending_followup');
      expect(snapshot.records[0]!.messages[0]).toMatchObject({ code: 'MISSING_ORIGINAL_TRANSACTION',
        severity: 'blocking', text: expect.stringContaining('原账单') });
      expect(h.transactionCount()).toBe(0);
      const second = await h.session.submit();
      expect(second.phase).toBe('complete');
      expect(second.records[0]!.messages).toContainEqual(expect.objectContaining({
        code: 'ORIGINAL_NOT_FOUND_RECORDED', severity: 'warning', text: expect.stringContaining('不计入收支'),
      }));
      expect(h.transactionCount()).toBe(1);
      expect(h.batches[1]!.records[0]!.idempotencyKey).toBe(initial.records[0]!.record.idempotencyKey);
      return;
    }
    expect(snapshot.phase).toBe('complete');
    expect(snapshot.records[0]!.result?.status).toBe('rejected');
    expect(snapshot.records[0]!.messages[0]).toMatchObject({
      code: 'REFUND_NOT_SUPPORTED', severity: 'blocking', text: expect.stringContaining('作废原账单'),
    });
    expect(h.transactionCount()).toBe(0);
    expect(() => h.session.update(initial.records[0]!.record.recordId, { direction: 'income' })).toThrow();
    await h.session.submit();
    expect(h.batches).toHaveLength(1);
  });

  it('第三次由真实 M2 返回 rejected，M1 不自行维护轮次或重发终态', async () => {
    const h = ledger();
    const initial = h.session.prepare(h.context, [h.draft({ amount: null })]);
    expect((await h.session.submit()).phase).toBe('pending_followup');
    expect((await h.session.submit()).phase).toBe('pending_followup');
    const third = await h.session.submit();
    expect(third.phase).toBe('complete');
    expect(third.records[0]!.result?.status).toBe('rejected');
    expect(() => h.session.update(initial.records[0]!.record.recordId, { amount: 20 })).toThrow();
    expect((await h.session.submit()).records[0]!.result?.status).toBe('rejected');
    expect(h.batches).toHaveLength(3);
    expect(h.transactionCount()).toBe(0);
    for (const batch of h.batches) {
      expect(batch).not.toHaveProperty('followupRound');
      expect(batch.records[0]).not.toHaveProperty('followupRound');
      expect(batch.records[0]).toMatchObject({ amount: null, idempotencyKey: initial.records[0]!.record.idempotencyKey });
    }
  });

  it.each([
    { modality: 'voice' as const, sourceRef: 'uploads/demo-voice.webm' },
    { modality: 'image' as const, sourceRef: 'uploads/demo-receipt.jpg' },
  ])('$modality 识别草稿补金额后经真实 M2 入库，源文件引用保持不变', async ({ modality, sourceRef }) => {
    const h = ledger();
    const initial = h.session.prepare(h.context, [h.draft({ modality, sourceRef, amount: null })]);
    expect(h.batches).toHaveLength(0);
    expect((await h.session.submit()).phase).toBe('pending_followup');
    h.session.update(initial.records[0]!.record.recordId, { amount: 32.5, merchant: '核对后的演示商户' });
    expect((await h.session.submit()).phase).toBe('complete');
    expect(h.transactionCount()).toBe(1);
    for (const batch of h.batches) {
      expect(batch.records[0]).toMatchObject({ modality, sourceRef,
        recordId: initial.records[0]!.record.recordId, idempotencyKey: initial.records[0]!.record.idempotencyKey });
    }
    const response = await h.app.inject({ method: 'GET', url: '/api/transactions' });
    expect(response.json()).toMatchObject({ items: [{ amountCents: 3250, sourceModality: modality, sourceRef }] });
  });
});
