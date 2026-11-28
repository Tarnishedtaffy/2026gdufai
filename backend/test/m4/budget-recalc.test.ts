import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/config/index.ts';
import { openDatabase } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';
import { seedDemoUser } from '../../src/db/seed/users.ts';
import { listBudgetAlerts } from '../../src/modules/budget/repository.ts';

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

let sequence = 0;

afterAll(async () => {
  await app.close();
  db.close();
});

beforeEach(() => {
  db.exec(
    'DELETE FROM budget_alerts; DELETE FROM budgets; DELETE FROM transactions; DELETE FROM user_category_rules;'
  );
});

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = ++sequence;
  return {
    recordId: `recalc_r_${id}`,
    userId: 'u_001',
    direction: null,
    amount: 32.5,
    merchant: '瑞幸',
    occurredAt: '2026-11-14T09:12:00+08:00',
    chatAt: null,
    rawText: '瑞幸 32.5',
    modality: 'text',
    sourceRef: null,
    confidence: 0.9,
    idempotencyKey: `recalc_k_${id}`,
    ...overrides
  };
}

async function sendImport(records: Record<string, unknown>[]) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/transactions/import',
    payload: {
      version: 1,
      batchId: `recalc_b_${++sequence}`,
      sentAt: '2026-11-15T21:00:00+08:00',
      records
    }
  });
  return { status: response.statusCode, body: response.json() };
}

async function putBudget(payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'PUT', url: '/api/budgets', payload });
  return { status: response.statusCode, body: response.json() };
}

async function getBudgets(month = '2026-11') {
  const response = await app.inject({ method: 'GET', url: `/api/budgets?month=${month}` });
  return { status: response.statusCode, body: response.json() };
}

function insertTransaction(options: {
  amountCents: number;
  categoryId: number;
  date?: string;
}): string {
  const id = `tx_recalc_${++sequence}`;
  const date = options.date ?? '2026-11-15';
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
        time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
        source_ref, anomaly_flag, idempotency_key, created_at, updated_at, entry_type)
     VALUES (?, 'u_001', 'expense', 'explicit', ?, '测试商户', NULL, ?, ?, 'explicit', NULL, ?, 'rule', 0.9,
             'confirmed', 'text', NULL, 0, ?, '2026-11-15T12:00:00+08:00',
             '2026-11-15T12:00:00+08:00', 'normal')`
  ).run(id, options.amountCents, `${date}T12:00:00+08:00`, date, options.categoryId, `key_${id}`);
  return id;
}

async function createCategory(name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/categories',
    payload: { name, kind: 'expense', color: '#0EA5E9' }
  });
  return response.json() as { id: number };
}

function totalBudget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    month: '2026-11',
    scope: 'total',
    categoryId: null,
    amountCents: 10000,
    alertThresholds: [80, 100],
    ...overrides
  };
}

describe('#38 预算告警重算', () => {
  it('批量导入后按整月重算并补写跨过的阈值', async () => {
    const created = await putBudget(totalBudget());
    const categoryBudget = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 1,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    expect(created.status).toBe(200);

    const imported = await sendImport([record({ amount: 85 }), record({ amount: 20 })]);
    expect(imported.status).toBe(201);
    expect(listBudgetAlerts(db, created.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 10500 },
      { threshold: 100, spent_cents: 10500 }
    ]);
    expect(listBudgetAlerts(db, categoryBudget.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 10500 },
      { threshold: 100, spent_cents: 10500 }
    ]);

    const budgets = await getBudgets();
    expect(budgets.body[0]).toMatchObject({ spentCents: 10500, level: 'over' });
  });

  it('导入还款与利息后只把利息计入支出预算', async () => {
    const budget = await putBudget(totalBudget({ amountCents: 1000, alertThresholds: [80, 100] }));
    const loan = await sendImport([
      record({
        idempotencyKey: `recalc_loan_${++sequence}`,
        rawText: '贷款 1000 到账',
        amount: 1000,
        merchant: '某银行'
      })
    ]);
    const loanId = loan.body.results[0].transactionId as string;

    const repayment = await sendImport([
      record({
        idempotencyKey: `recalc_repayment_${++sequence}`,
        rawText: '还款 1100',
        amount: 1100,
        merchant: '某银行',
        originalTransactionId: loanId,
        repaymentPart: 'mixed',
        principalCents: 100000,
        interestCents: 10000
      })
    ]);
    expect(repayment.status).toBe(201);
    expect(repayment.body.results[0].interestTransactionId).toMatch(/^tx_/);
    expect(listBudgetAlerts(db, budget.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 10000 },
      { threshold: 100, spent_cents: 10000 }
    ]);

    const budgets = await getBudgets();
    expect(budgets.body[0]).toMatchObject({ spentCents: 10000, level: 'over' });
  });

  it('PATCH 金额后重算预算告警', async () => {
    const created = await putBudget(totalBudget({ alertThresholds: [80] }));
    const imported = await sendImport([record({ amount: 50 })]);
    const transactionId = imported.body.results[0].transactionId as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transactionId}`,
      payload: { amountCents: 8500 }
    });
    expect(patched.statusCode).toBe(200);
    expect(listBudgetAlerts(db, created.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 8500 }
    ]);
  });

  it('PATCH 类别后同时重算旧类别与新类别预算', async () => {
    const categoryBudget = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 2,
      amountCents: 1000,
      alertThresholds: [80]
    });
    const imported = await sendImport([record({ amount: 5 })]);
    const transactionId = imported.body.results[0].transactionId as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transactionId}`,
      payload: { categoryId: 2, amountCents: 900 }
    });
    expect(patched.statusCode).toBe(200);
    expect(listBudgetAlerts(db, categoryBudget.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);
  });

  it('PATCH 跨 kind 后把原收入计入支出预算', async () => {
    const created = await putBudget(totalBudget({ amountCents: 1000, alertThresholds: [80] }));
    const imported = await sendImport([
      record({ amount: 9, direction: 'income', merchant: '工资', rawText: '工资 9' })
    ]);
    const transactionId = imported.body.results[0].transactionId as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transactionId}`,
      payload: { categoryId: 1 }
    });
    expect(patched.statusCode).toBe(200);
    expect(listBudgetAlerts(db, created.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);
  });

  it('PATCH 改月份后重算新旧两个月的预算', async () => {
    const november = await putBudget(totalBudget({ amountCents: 1000, alertThresholds: [80] }));
    const december = await putBudget(
      totalBudget({ month: '2026-12', amountCents: 1000, alertThresholds: [80] })
    );
    const imported = await sendImport([record({ amount: 9 })]);
    const transactionId = imported.body.results[0].transactionId as string;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${transactionId}`,
      payload: { occurredAt: '2026-12-15T10:00:00+08:00' }
    });
    expect(patched.statusCode).toBe(200);
    expect(listBudgetAlerts(db, november.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);
    expect(listBudgetAlerts(db, december.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);
  });

  it('作废账单后预算支出归零且不新增告警', async () => {
    const created = await putBudget(totalBudget({ amountCents: 1000, alertThresholds: [80] }));
    const imported = await sendImport([record({ amount: 9 })]);
    const transactionId = imported.body.results[0].transactionId as string;
    expect(listBudgetAlerts(db, created.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);

    const voided = await app.inject({ method: 'POST', url: `/api/transactions/${transactionId}/void` });
    expect(voided.statusCode).toBe(200);
    expect(listBudgetAlerts(db, created.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);

    const budgets = await getBudgets();
    expect(budgets.body[0]).toMatchObject({ spentCents: 0, level: 'normal' });
  });

  it('类别 reassign 后按目标类别重算预算', async () => {
    const source = await createCategory(`预算迁移源_${++sequence}`);
    const target = await createCategory(`预算迁移目标_${++sequence}`);
    const transactionId = insertTransaction({ amountCents: 900, categoryId: source.id });
    const budget = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: target.id,
      amountCents: 1000,
      alertThresholds: [80]
    });

    const reassigned = await app.inject({
      method: 'POST',
      url: `/api/categories/${source.id}/reassign`,
      payload: { targetCategoryId: target.id }
    });
    expect(reassigned.statusCode).toBe(200);
    expect(listBudgetAlerts(db, budget.body.id as number)).toEqual([
      { threshold: 80, spent_cents: 900 }
    ]);

    const moved = db
      .prepare('SELECT category_id FROM transactions WHERE id = ?')
      .get(transactionId) as { category_id: number };
    expect(moved.category_id).toBe(target.id);
  });
});

function failAlertInsert(): void {
  db.exec("CREATE TEMP TRIGGER fail_alert BEFORE INSERT ON budget_alerts BEGIN SELECT RAISE(ABORT, 'test alert failure'); END");
}

it('重算失败时回滚导入，同一记录可重试', async () => {
  const budget = await putBudget(totalBudget({ amountCents: 1000 }));
  const rows = [record({ amount: 9 })];
  failAlertInsert();
  try {
    expect((await sendImport(rows)).status).toBe(500);
    expect(db.prepare('SELECT count(*) AS n FROM transactions').get()).toEqual({ n: 0 });
  } finally { db.exec('DROP TRIGGER fail_alert'); }
  expect((await sendImport(rows)).body.results[0].status).toBe('confirmed');
  expect(listBudgetAlerts(db, budget.body.id)).toHaveLength(1);
});

it('预算重算失败回滚类别迁移，重试后更新预算', async () => {
  const source = await createCategory('回滚源类别');
  const target = await createCategory('回滚目标类别');
  const id = insertTransaction({ amountCents: 900, categoryId: source.id });
  const budget = await putBudget({ month: '2026-11', scope: 'category', categoryId: target.id, amountCents: 1000, alertThresholds: [80] });
  const move = () => app.inject({ method: 'POST', url: '/api/categories/' + source.id + '/reassign', payload: { targetCategoryId: target.id } });
  failAlertInsert();
  try {
    expect((await move()).statusCode).toBe(500);
    expect(db.prepare('SELECT category_id FROM transactions WHERE id=?').get(id)).toEqual({ category_id: source.id });
  } finally { db.exec('DROP TRIGGER fail_alert'); }
  expect((await move()).statusCode).toBe(200);
  expect(listBudgetAlerts(db, budget.body.id)).toHaveLength(1);
});
