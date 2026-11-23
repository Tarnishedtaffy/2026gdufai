import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/config/index.ts';
import { openDatabase } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';
import { seedDemoUser } from '../../src/db/seed/users.ts';

const config: AppConfig = {
  port: 0,
  nodeEnv: 'test',
  databasePath: ':memory:',
  uploadDir: './uploads',
  authToken: null,
  demoUserId: 'u_001'
};

const db = openDatabase(':memory:');
seedCategories(db);
seedDemoUser(db, config.demoUserId);
const app = buildApp({ config, db });

afterAll(async () => {
  await app.close();
  db.close();
});

const SENT_AT = '2026-11-15T21:00:00+08:00';

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: 'r1',
    userId: 'u_001',
    direction: null,
    amount: 32.5,
    merchant: null,
    occurredAt: '2026-11-14T09:12:00+08:00',
    chatAt: null,
    rawText: '瑞幸 32.5',
    modality: 'text',
    sourceRef: null,
    confidence: 0.9,
    idempotencyKey: 'k1',
    ...overrides
  };
}

async function send(records: Record<string, unknown>[], batchPatch: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/transactions/import',
    payload: { version: 1, batchId: 'b1', sentAt: SENT_AT, records, ...batchPatch }
  });
  return { status: response.statusCode, body: response.json() };
}

function transactionCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
  return row.count;
}

describe('POST /api/transactions/import', () => {
  it('完整记录直接入库', async () => {
    const result = await send([record()]);
    expect(result.status).toBe(201);
    const item = result.body.results[0];
    expect(item).toMatchObject({
      status: 'confirmed',
      direction: 'expense',
      category: { id: 1, name: '餐饮', kind: 'expense' }
    });
    expect(item.transactionId).toMatch(/^tx_/);
    const row = db
      .prepare('SELECT amount_cents, merchant, occurred_date, category_id FROM transactions WHERE id = ?')
      .get(item.transactionId) as { amount_cents: number; merchant: string; occurred_date: string; category_id: number };
    expect(row).toEqual({ amount_cents: 3250, merchant: '未知账号', occurred_date: '2026-11-14', category_id: 1 });
  });

  it('缺金额先追问，补发后入库', async () => {
    const key = 'k-amount';
    const first = await send([record({ idempotencyKey: key, amount: null })]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'amount',
      code: 'MISSING_AMOUNT',
      severity: 'blocking'
    });
    expect(transactionCount()).toBe(1);

    const second = await send([record({ idempotencyKey: key, amount: 10 })]);
    expect(second.body.results[0].status).toBe('confirmed');
    expect(transactionCount()).toBe(2);
  });

  it('超出安全整数范围的金额整批 400，不入库', async () => {
    const before = transactionCount();
    const res = await send([record({ idempotencyKey: 'k-overflow', amount: 1e16 })]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BATCH');
    expect(transactionCount()).toBe(before);
  });

  it('缺时间第二轮回退到聊天时间', async () => {
    const key = 'k-time';
    const first = await send([record({ idempotencyKey: key, occurredAt: null })]);
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'occurredAt',
      code: 'MISSING_TIME',
      severity: 'blocking'
    });

    const second = await send([record({ idempotencyKey: key, occurredAt: null })]);
    const item = second.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.occurredAt).toBe(SENT_AT);
    expect(item.feedback).toContainEqual({
      field: 'occurredAt',
      code: 'TIME_DEFAULTED_TO_CHAT_TIME',
      severity: 'warning'
    });
    const row = db
      .prepare('SELECT time_source, occurred_at FROM transactions WHERE id = ?')
      .get(item.transactionId) as { time_source: string; occurred_at: string };
    expect(row).toEqual({ time_source: 'chat_time', occurred_at: SENT_AT });
  });

  it('未来时间先追问，第二轮回退聊天时间', async () => {
    const key = 'k-future';
    const future = '2030-01-01T00:00:00+08:00';
    const first = await send([record({ idempotencyKey: key, occurredAt: future })]);
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'occurredAt',
      code: 'FUTURE_TIME',
      severity: 'blocking'
    });

    const second = await send([record({ idempotencyKey: key, occurredAt: future })]);
    expect(second.body.results[0].status).toBe('confirmed');
    expect(second.body.results[0].occurredAt).toBe(SENT_AT);
  });

  it('重复幂等键返回 duplicate，不重复入库', async () => {
    const key = 'k-dup';
    const first = await send([record({ idempotencyKey: key })]);
    expect(first.body.results[0].status).toBe('confirmed');
    const before = transactionCount();

    const second = await send([record({ idempotencyKey: key })]);
    expect(second.body.results[0].status).toBe('duplicate');
    expect(second.body.results[0].transactionId).toBe(first.body.results[0].transactionId);
    expect(transactionCount()).toBe(before);
  });

  it('方向与类别冲突：首轮追问，次轮以类别为准', async () => {
    const key = 'k-conflict';
    const payload = record({ idempotencyKey: key, direction: 'expense', amount: 8000, rawText: '工资到账 8000' });

    const first = await send([payload]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'direction',
      code: 'CATEGORY_KIND_MISMATCH',
      severity: 'blocking'
    });

    const second = await send([payload]);
    const item = second.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.direction).toBe('income');
    expect(item.category).toMatchObject({ id: 9, kind: 'income' });
    expect(item.feedback).toContainEqual({
      field: 'direction',
      code: 'DIRECTION_FORCED_BY_CATEGORY',
      severity: 'warning'
    });
  });

  it('等额退款：作废原账单并记中性记录', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-refund-orig', rawText: '买鞋 299', amount: 299, merchant: '鞋店' })
    ]);
    const originalId = original.body.results[0].transactionId as string;

    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;

    const refund = await send([
      record({
        idempotencyKey: 'k-refund-matched',
        rawText: '退款 299',
        amount: 299,
        originalTransactionId: originalId
      })
    ]);
    const item = refund.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.matchedTransactionId).toBe(originalId);
    expect(item.direction).toBe('income');
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'REFUND_RECORDED_NEUTRAL',
      severity: 'warning'
    });

    const originalRow = db
      .prepare('SELECT status FROM transactions WHERE id = ?')
      .get(originalId) as { status: string };
    expect(originalRow.status).toBe('void');

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    expect(after.expenseCents).toBe(before.expenseCents - 29900);
  });

  it('退款小于原账单：把原单金额改为剩余金额并记中性', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-partial-orig', rawText: '买鞋 100', amount: 100 })
    ]);
    const originalId = original.body.results[0].transactionId as string;
    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;

    const refund = await send([
      record({
        idempotencyKey: 'k-partial-refund',
        rawText: '退款 30',
        amount: 30,
        originalTransactionId: originalId
      })
    ]);
    const item = refund.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_AMOUNT_ADJUSTED',
      severity: 'warning'
    });

    const originalRow = db
      .prepare('SELECT amount_cents, status FROM transactions WHERE id = ?')
      .get(originalId) as { amount_cents: number; status: string };
    expect(originalRow).toEqual({ amount_cents: 7000, status: 'confirmed' });

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    expect(after.expenseCents).toBe(before.expenseCents - 3000);
  });

  it('退款大于原账单：作废原单，超出部分计入收入', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-exceed-orig', rawText: '买鞋 100', amount: 100 })
    ]);
    const originalId = original.body.results[0].transactionId as string;
    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;

    const refund = await send([
      record({
        idempotencyKey: 'k-exceed-refund',
        rawText: '退款 150',
        amount: 150,
        originalTransactionId: originalId
      })
    ]);
    const item = refund.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'REFUND_EXCESS_AS_INCOME',
      severity: 'warning'
    });

    const originalRow = db
      .prepare('SELECT status FROM transactions WHERE id = ?')
      .get(originalId) as { status: string };
    expect(originalRow.status).toBe('void');

    const excessRow = db
      .prepare('SELECT amount_cents, direction, entry_type FROM transactions WHERE idempotency_key = ?')
      .get('k-exceed-refund#excess') as {
      amount_cents: number;
      direction: string;
      entry_type: string;
    };
    expect(excessRow).toEqual({ amount_cents: 5000, direction: 'income', entry_type: 'normal' });

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    expect(after.expenseCents).toBe(before.expenseCents - 10000);
    expect(after.incomeCents).toBe(before.incomeCents + 5000);
  });

  it('等额还款：保留原贷款账单、写 settled_at 并记中性', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-loan', rawText: '贷款 5000 到账', amount: 5000, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;
    expect(loan.body.results[0].category).toMatchObject({ id: 12, name: '贷款' });

    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;

    const repayment = await send([
      record({
        idempotencyKey: 'k-repayment-matched',
        rawText: '还款 5000',
        amount: 5000,
        originalTransactionId: loanId
      })
    ]);
    const item = repayment.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.direction).toBe('expense');
    expect(item.matchedTransactionId).toBe(loanId);
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'REPAYMENT_RECORDED_NEUTRAL',
      severity: 'warning'
    });

    const loanRow = db
      .prepare('SELECT status, settled_at FROM transactions WHERE id = ?')
      .get(loanId) as { status: string; settled_at: string | null };
    expect(loanRow.status).toBe('confirmed');
    expect(loanRow.settled_at).not.toBeNull();

    const repaymentRow = db
      .prepare(
        'SELECT entry_type, amount_cents, principal_cents FROM transactions WHERE idempotency_key = ?'
      )
      .get('k-repayment-matched') as {
      entry_type: string;
      amount_cents: number;
      principal_cents: number;
    };
    expect(repaymentRow).toEqual({
      entry_type: 'repayment',
      amount_cents: 500000,
      principal_cents: 500000
    });

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    // v1.5 保留原贷款与中性还款，收入与支出都不再变化。
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.expenseCents).toBe(before.expenseCents);
  });

  it('还款金额大于剩余本金且未拆分：AMBIGUOUS_LOAN_PAYMENT，不猜测本金/利息', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-loan-excess', rawText: '贷款 1000 到账', amount: 1000, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;
    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    const beforeCount = transactionCount();

    const payload = record({
      idempotencyKey: 'k-repayment-excess',
      rawText: '还款 1100',
      amount: 1100,
      originalTransactionId: loanId
    });
    const first = await send([payload]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'principalCents',
      code: 'AMBIGUOUS_LOAN_PAYMENT',
      severity: 'blocking'
    });
    expect(transactionCount()).toBe(beforeCount);

    await send([payload]);
    const third = await send([payload]);
    expect(third.body.results[0].status).toBe('rejected');
    expect(third.body.results[0].feedback).toContainEqual({
      field: 'principalCents',
      code: 'AMBIGUOUS_LOAN_PAYMENT',
      severity: 'blocking'
    });

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.expenseCents).toBe(before.expenseCents);
  });

  it('显式本金超过剩余本金：整批 400 INVALID_BATCH', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-loan-over', rawText: '贷款 1000 到账', amount: 1000, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;

    const response = await send([
      record({
        idempotencyKey: 'k-repayment-over',
        rawText: '还款 1100',
        amount: 1100,
        originalTransactionId: loanId,
        repaymentPart: 'principal',
        principalCents: 110000
      })
    ]);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'INVALID_BATCH', field: 'records[0].principalCents' }
    });
  });

  it('部分退款重发：duplicate 且不重复累加', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-dup-partial-orig', rawText: '买书 100', amount: 100 })
    ]);
    const originalId = original.body.results[0].transactionId as string;
    const payload = record({
      idempotencyKey: 'k-dup-partial-refund',
      rawText: '退款 30',
      amount: 30,
      originalTransactionId: originalId
    });

    await send([payload]);
    const before = transactionCount();
    const again = await send([payload]);
    expect(again.body.results[0].status).toBe('duplicate');
    expect(transactionCount()).toBe(before);
  });

  it('还款小于贷款：保留原贷款金额并记部分还款', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-loan-partial', rawText: '贷款 1000 到账', amount: 1000, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;
    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;

    const repayment = await send([
      record({
        idempotencyKey: 'k-repayment-partial',
        rawText: '还款 400',
        amount: 400,
        originalTransactionId: loanId
      })
    ]);
    const item = repayment.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'PARTIAL_REPAYMENT_RECORDED',
      severity: 'warning'
    });

    const loanRow = db
      .prepare('SELECT amount_cents, status, settled_at FROM transactions WHERE id = ?')
      .get(loanId) as { amount_cents: number; status: string; settled_at: string | null };
    expect(loanRow).toEqual({ amount_cents: 100000, status: 'confirmed', settled_at: null });

    const repaymentRow = db
      .prepare('SELECT principal_cents FROM transactions WHERE idempotency_key = ?')
      .get('k-repayment-partial') as { principal_cents: number };
    expect(repaymentRow.principal_cents).toBe(40000);

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.expenseCents).toBe(before.expenseCents);
  });

  it('已作废的原账单不可匹配', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-void-orig', rawText: '买鞋 100', amount: 100 })
    ]);
    const originalId = original.body.results[0].transactionId as string;
    db.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(originalId);

    const refund = await send([
      record({
        idempotencyKey: 'k-void-refund',
        rawText: '退款 100',
        amount: 100,
        originalTransactionId: originalId
      })
    ]);
    expect(refund.body.results[0].status).toBe('pending_followup');
    expect(refund.body.results[0].feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_NOT_FOUND',
      severity: 'blocking'
    });
  });

  it('跨用户的原账单不可匹配', async () => {
    db.prepare("INSERT OR IGNORE INTO users (id, nickname, created_at) VALUES ('u_002', 'u_002', ?)").run(
      '2026-11-14T12:00:00+08:00'
    );
    db.prepare(
      `INSERT INTO transactions
         (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
          time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
          source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
       VALUES ('tx_other_user', 'u_002', 'expense', 'explicit', 1000, '他人', NULL, '2026-11-14T12:00:00+08:00',
               '2026-11-14', 'explicit', NULL, 1, 'rule', 0.9, 'confirmed', 'text', NULL, 0, 'key_other',
               '2026-11-14T12:00:00+08:00', '2026-11-14T12:00:00+08:00')`
    ).run();

    const refund = await send([
      record({
        idempotencyKey: 'k-cross-user',
        rawText: '退款 10',
        amount: 10,
        originalTransactionId: 'tx_other_user'
      })
    ]);
    expect(refund.body.results[0].status).toBe('pending_followup');
    expect(refund.body.results[0].feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_NOT_FOUND',
      severity: 'blocking'
    });
  });

  it('entryType=repayment 返回还款中性记录', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-filter-loan', rawText: '贷款 200 到账', amount: 200, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;
    await send([
      record({
        idempotencyKey: 'k-filter-repayment',
        rawText: '还款 200',
        amount: 200,
        originalTransactionId: loanId
      })
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/transactions?entryType=repayment' });
    const body = response.json() as { items: Array<{ entryType: string }>; summary: { count: number } };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.entryType === 'repayment')).toBe(true);
    expect(body.summary.count).toBe(0);
  });

  it('中性记录重发：duplicate 保留 matchedTransactionId', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-dup-orig', rawText: '买书 100', amount: 100, merchant: '书店' })
    ]);
    const originalId = original.body.results[0].transactionId as string;
    const payload = record({
      idempotencyKey: 'k-dup-refund',
      rawText: '退款 100',
      amount: 100,
      originalTransactionId: originalId
    });

    await send([payload]);
    const again = await send([payload]);
    expect(again.body.results[0].status).toBe('duplicate');
    expect(again.body.results[0].matchedTransactionId).toBe(originalId);
  });

  it('中性记录未来时间次轮回退聊天时间，time_source/chat_at 与响应一致', async () => {
    const original = await send([
      record({ idempotencyKey: 'k-future-orig', rawText: '买书 100', amount: 100, merchant: '书店' })
    ]);
    const originalId = original.body.results[0].transactionId as string;
    const payload = record({
      idempotencyKey: 'k-future-refund',
      rawText: '退款 100',
      amount: 100,
      originalTransactionId: originalId,
      occurredAt: '2030-01-01T12:00:00+08:00'
    });

    const first = await send([payload]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'occurredAt',
      code: 'FUTURE_TIME',
      severity: 'blocking'
    });

    const second = await send([payload]);
    const item = second.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.occurredAt).toBe(SENT_AT);

    const row = db
      .prepare('SELECT time_source, chat_at FROM transactions WHERE id = ?')
      .get(item.transactionId) as { time_source: string; chat_at: string | null };
    expect(row).toEqual({ time_source: 'chat_time', chat_at: SENT_AT });
  });

  it('退款没带原账单 id：首轮追问，次轮归入其他且不计收支', async () => {
    const key = 'k-refund-no-original';
    const first = await send([record({ idempotencyKey: key, rawText: '退款 50', amount: 50 })]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'MISSING_ORIGINAL_TRANSACTION',
      severity: 'blocking'
    });

    const second = await send([record({ idempotencyKey: key, rawText: '退款 50', amount: 50 })]);
    const item = second.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.matchedTransactionId).toBeNull();
    expect(item.category).toMatchObject({ name: '其他收入', kind: 'income' });
    expect(item.direction).toBe('income');
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_NOT_FOUND_RECORDED',
      severity: 'warning'
    });
  });

  it('带了无效原账单 id：首轮 ORIGINAL_NOT_FOUND，次轮兜底且 matchedTransactionId 为 null', async () => {
    const key = 'k-invalid-original';
    const payload = record({
      idempotencyKey: key,
      rawText: '退款 60',
      amount: 60,
      originalTransactionId: 'tx_not_exist'
    });

    const first = await send([payload]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_NOT_FOUND',
      severity: 'blocking'
    });

    const second = await send([payload]);
    const item = second.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.matchedTransactionId).toBeNull();
    expect(item.category).toMatchObject({ name: '其他收入', kind: 'income' });
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_NOT_FOUND_RECORDED',
      severity: 'warning'
    });
  });

  it('原账单超过 30 天仍可匹配（v1.5 取消匹配窗口）', async () => {
    const original = await send([
      record({
        idempotencyKey: 'k-old-orig',
        rawText: '买鞋 100',
        amount: 100,
        occurredAt: '2026-09-01T12:00:00+08:00'
      })
    ]);
    const oldId = original.body.results[0].transactionId as string;

    const refund = await send([
      record({
        idempotencyKey: 'k-old-refund',
        rawText: '退款 100',
        amount: 100,
        originalTransactionId: oldId
      })
    ]);
    const item = refund.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.matchedTransactionId).toBe(oldId);
    expect(item.feedback).toContainEqual({
      code: 'REFUND_RECORDED_NEUTRAL',
      severity: 'warning',
      field: 'originalTransactionId'
    });
  });

  it('原账单超过 365 天：仍匹配但提示 ORIGINAL_TRANSACTION_AGED', async () => {
    const original = await send([
      record({
        idempotencyKey: 'k-aged-orig',
        rawText: '买鞋 100',
        amount: 100,
        occurredAt: '2025-01-01T12:00:00+08:00'
      })
    ]);
    const agedId = original.body.results[0].transactionId as string;

    const refund = await send([
      record({
        idempotencyKey: 'k-aged-refund',
        rawText: '退款 100',
        amount: 100,
        originalTransactionId: agedId
      })
    ]);
    const item = refund.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.matchedTransactionId).toBe(agedId);
    expect(item.feedback).toContainEqual({
      code: 'ORIGINAL_TRANSACTION_AGED',
      severity: 'warning',
      field: 'originalTransactionId'
    });
  });

  it('已结清的贷款再次还款：ORIGINAL_ALREADY_SETTLED，第三轮 rejected', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-settled-loan', rawText: '贷款 300 到账', amount: 300, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;
    await send([
      record({
        idempotencyKey: 'k-settled-first',
        rawText: '还款 300',
        amount: 300,
        originalTransactionId: loanId
      })
    ]);

    const payload = record({
      idempotencyKey: 'k-settled-again',
      rawText: '还款 100',
      amount: 100,
      originalTransactionId: loanId
    });
    const first = await send([payload]);
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'ORIGINAL_ALREADY_SETTLED',
      severity: 'blocking'
    });
    await send([payload]);
    const third = await send([payload]);
    expect(third.body.results[0].status).toBe('rejected');
  });

  it('混合还款：本金中性记录 + 类别 13 利息支出，重发回显 interestTransactionId', async () => {
    const loan = await send([
      record({ idempotencyKey: 'k-mixed-loan', rawText: '贷款 1000 到账', amount: 1000, merchant: '某银行' })
    ]);
    const loanId = loan.body.results[0].transactionId as string;
    const before = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;

    const payload = record({
      idempotencyKey: 'k-mixed-repayment',
      rawText: '还款 1100',
      amount: 1100,
      merchant: '某银行',
      originalTransactionId: loanId,
      repaymentPart: 'mixed',
      principalCents: 100000,
      interestCents: 10000
    });
    const repayment = await send([payload]);
    const item = repayment.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.matchedTransactionId).toBe(loanId);
    expect(item.interestTransactionId).toMatch(/^tx_/);
    expect(item.feedback).toContainEqual({
      field: 'originalTransactionId',
      code: 'REPAYMENT_RECORDED_NEUTRAL',
      severity: 'warning'
    });

    const neutralRow = db
      .prepare('SELECT entry_type, principal_cents FROM transactions WHERE idempotency_key = ?')
      .get('k-mixed-repayment') as { entry_type: string; principal_cents: number };
    expect(neutralRow).toEqual({ entry_type: 'repayment', principal_cents: 100000 });

    const interestRow = db
      .prepare(
        'SELECT entry_type, direction, amount_cents, category_id, principal_cents FROM transactions WHERE idempotency_key = ?'
      )
      .get('k-mixed-repayment#interest') as {
      entry_type: string;
      direction: string;
      amount_cents: number;
      category_id: number;
      principal_cents: number | null;
    };
    expect(interestRow).toEqual({
      entry_type: 'normal',
      direction: 'expense',
      amount_cents: 10000,
      category_id: 13,
      principal_cents: null
    });

    const loanRow = db
      .prepare('SELECT settled_at FROM transactions WHERE id = ?')
      .get(loanId) as { settled_at: string | null };
    expect(loanRow.settled_at).not.toBeNull();

    const after = (
      await app.inject({ method: 'GET', url: '/api/stats?dimension=month&month=2026-11' })
    ).json().summary;
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(after.expenseCents).toBe(before.expenseCents + 10000);

    const again = await send([payload]);
    expect(again.body.results[0].status).toBe('duplicate');
    expect(again.body.results[0].interestTransactionId).toBe(item.interestTransactionId);
  });

  it('纯利息还款：只记类别 13 支出，不产生中性还款记录', async () => {
    const beforeCount = transactionCount();
    const payload = record({
      idempotencyKey: 'k-interest-only',
      rawText: '还贷款利息 50',
      amount: 50,
      merchant: '某银行',
      repaymentPart: 'interest',
      interestCents: 5000
    });
    const response = await send([payload]);
    const item = response.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.direction).toBe('expense');
    expect(item.matchedTransactionId).toBeNull();
    expect(item.interestTransactionId).toBe(item.transactionId);
    expect(transactionCount()).toBe(beforeCount + 1);

    const row = db
      .prepare(
        'SELECT entry_type, direction, amount_cents, category_id, principal_cents FROM transactions WHERE idempotency_key = ?'
      )
      .get('k-interest-only#interest') as {
      entry_type: string;
      direction: string;
      amount_cents: number;
      category_id: number;
      principal_cents: number | null;
    };
    expect(row).toEqual({
      entry_type: 'normal',
      direction: 'expense',
      amount_cents: 5000,
      category_id: 13,
      principal_cents: null
    });
  });

  it('缺商家时写默认值并给 warning', async () => {
    const result = await send([record({ idempotencyKey: 'k-merchant', merchant: null })]);
    const item = result.body.results[0];
    expect(item.status).toBe('confirmed');
    expect(item.feedback).toContainEqual({
      field: 'merchant',
      code: 'MERCHANT_DEFAULTED',
      severity: 'warning'
    });
  });

  it('缺 sentAt 整批 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      payload: { version: 1, batchId: 'b1', records: [record({ idempotencyKey: 'k-sent' })] }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_BATCH', field: 'sentAt' } });
  });

  it('连续追问达到上限后 rejected，且不再复活', async () => {
    const key = 'k-limit';
    const payload = record({ idempotencyKey: key, amount: null });
    const before = transactionCount();

    const round1 = await send([payload]);
    expect(round1.body.results[0].status).toBe('pending_followup');
    const round2 = await send([payload]);
    expect(round2.body.results[0].status).toBe('pending_followup');
    const round3 = await send([payload]);
    expect(round3.body.results[0].status).toBe('rejected');
    const round4 = await send([payload]);
    expect(round4.body.results[0].status).toBe('rejected');
    expect(transactionCount()).toBe(before);
  });

  it('近未来（+2 小时）首轮追问 FUTURE_TIME，次轮按聊天时间兜底', async () => {
    const key = 'k-near-future';
    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '+00:00');

    const first = await send([record({ idempotencyKey: key, occurredAt: twoHoursLater })]);
    expect(first.body.results[0].status).toBe('pending_followup');
    expect(first.body.results[0].feedback).toContainEqual({
      field: 'occurredAt',
      code: 'FUTURE_TIME',
      severity: 'blocking'
    });

    const second = await send([record({ idempotencyKey: key, occurredAt: twoHoursLater })]);
    expect(second.body.results[0].status).toBe('confirmed');
    expect(second.body.results[0].occurredAt).toBe(SENT_AT);
  });

  it('5 分钟容差内（+1 分钟）不判未来，超过容差（+6 分钟）判未来', async () => {
    const inOneMinute = new Date(Date.now() + 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '+00:00');
    const withinTolerance = await send([
      record({ idempotencyKey: 'k-tolerance-in', occurredAt: inOneMinute, rawText: '瑞幸 1' })
    ]);
    expect(withinTolerance.body.results[0].status).toBe('confirmed');
    expect(withinTolerance.body.results[0].feedback).not.toContainEqual(
      expect.objectContaining({ code: 'FUTURE_TIME' })
    );

    const inSixMinutes = new Date(Date.now() + 6 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '+00:00');
    const beyondTolerance = await send([
      record({ idempotencyKey: 'k-tolerance-out', occurredAt: inSixMinutes })
    ]);
    expect(beyondTolerance.body.results[0].status).toBe('pending_followup');
    expect(beyondTolerance.body.results[0].feedback).toContainEqual({
      field: 'occurredAt',
      code: 'FUTURE_TIME',
      severity: 'blocking'
    });
  });

  it('rejected 重发时保留原 feedback 的 field 与 severity', async () => {
    const key = 'k-reject-replay';
    const payload = record({ idempotencyKey: key, amount: null });

    await send([payload]);
    await send([payload]);
    const third = await send([payload]);
    expect(third.body.results[0].status).toBe('rejected');
    expect(third.body.results[0].feedback[0]).toMatchObject({ field: 'amount', severity: 'blocking' });

    const fourth = await send([payload]);
    expect(fourth.body.results[0].status).toBe('rejected');
    expect(fourth.body.results[0].feedback[0]).toMatchObject({
      field: 'amount',
      code: 'MISSING_AMOUNT',
      severity: 'blocking'
    });
  });

  it('冲突强制分支的 direction_source 记为 category', async () => {
    const key = 'k-forced-source';
    const payload = record({
      idempotencyKey: key,
      direction: 'expense',
      amount: 5000,
      rawText: '工资 5000'
    });

    await send([payload]);
    const second = await send([payload]);
    const item = second.body.results[0];
    expect(item.status).toBe('confirmed');

    const row = db
      .prepare('SELECT direction, direction_source FROM transactions WHERE id = ?')
      .get(item.transactionId) as { direction: string; direction_source: string };
    expect(row).toEqual({ direction: 'income', direction_source: 'category' });
  });

  it('入站 userId 与 DEMO_USER_ID 不一致时整批拒收', async () => {
    const result = await send([record({ idempotencyKey: 'k-bad-user', userId: 'u_other' })]);
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: { code: 'INVALID_BATCH', field: 'records[0].userId' }
    });
  });

  it('已落库但缺 intake 记录时自愈为 duplicate', async () => {
    const key = 'k-wedge';
    const before = transactionCount();
    db.prepare(
      `INSERT INTO transactions
         (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
          time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
          source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
       VALUES ('tx_wedge', 'u_001', 'expense', 'explicit', 1000, '某商户', '历史账单',
               '2026-11-14T12:00:00+08:00', '2026-11-14', 'explicit', NULL, 1, 'rule', 0.9, 'confirmed',
               'text', NULL, 0, ?, '2026-11-14T12:00:00+08:00', '2026-11-14T12:00:00+08:00')`
    ).run(key);

    const response = await send([record({ idempotencyKey: key, amount: 10, rawText: '瑞幸 10' })]);
    expect(response.body.results[0].status).toBe('duplicate');
    expect(response.body.results[0].transactionId).toBe('tx_wedge');
    expect(transactionCount()).toBe(before + 1);

    const intake = db.prepare('SELECT status FROM intake_log WHERE idempotency_key = ?').get(key) as {
      status: string;
    };
    expect(intake.status).toBe('confirmed');
  });
});
