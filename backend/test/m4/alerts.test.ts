import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/config/index.ts';
import { openDatabase } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';
import { seedDemoUser } from '../../src/db/seed/users.ts';
import { listBudgetAlerts } from '../../src/modules/budget/repository.ts';
import { recalcBudgetForTransaction, recalcBudgetsForMonth } from '../../src/modules/budget/service.ts';

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
  db.exec('DELETE FROM budget_alerts; DELETE FROM budgets; DELETE FROM transactions;');
});

function insertTransaction(options: {
  amountCents: number;
  categoryId?: number;
  date?: string;
  direction?: 'expense' | 'income';
  status?: 'confirmed' | 'void';
  entryType?: 'normal' | 'refund' | 'repayment';
}): void {
  const id = `tx_alert_${++sequence}`;
  const date = options.date ?? '2026-11-15';
  const categoryId = options.categoryId ?? 1;
  const direction = options.direction ?? 'expense';
  const status = options.status ?? 'confirmed';
  const entryType = options.entryType ?? 'normal';
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
        time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
        source_ref, anomaly_flag, idempotency_key, created_at, updated_at, entry_type)
     VALUES (?, 'u_001', ?, 'explicit', ?, '测试商户', NULL, ?, ?, 'explicit', NULL, ?, 'rule', 0.9, ?,
             'text', NULL, 0, ?, '2026-11-15T12:00:00+08:00', '2026-11-15T12:00:00+08:00', ?)`
  ).run(
    id,
    direction,
    options.amountCents,
    `${date}T12:00:00+08:00`,
    date,
    categoryId,
    status,
    `key_${id}`,
    entryType
  );
}

async function putBudget(payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'PUT', url: '/api/budgets', payload });
  return { status: response.statusCode, body: response.json() };
}

function budgetId(result: { body: { id?: number } }): number {
  return result.body.id as number;
}

describe('预算阈值告警', () => {
  it('账单变化后 recalc 只补写已跨过的阈值', async () => {
    insertTransaction({ amountCents: 5000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    const id = budgetId(created);
    expect(created.status).toBe(200);
    expect(listBudgetAlerts(db, id)).toEqual([]);

    insertTransaction({ amountCents: 3000 });
    recalcBudgetForTransaction(db, 'u_001', '2026-11-16', 1);
    expect(listBudgetAlerts(db, id)).toEqual([{ threshold: 80, spent_cents: 8000 }]);
  });

  it('空阈值表示关闭提醒，不写任何告警', async () => {
    insertTransaction({ amountCents: 12000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: []
    });
    const id = budgetId(created);
    expect(created.status).toBe(200);
    expect(created.body.alertThresholds).toEqual([]);
    expect(listBudgetAlerts(db, id)).toEqual([]);

    recalcBudgetForTransaction(db, 'u_001', '2026-11-16', 1);
    expect(listBudgetAlerts(db, id)).toEqual([]);
  });

  it('创建预算时已超阈值会立即写入告警', async () => {
    insertTransaction({ amountCents: 12000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    const id = budgetId(created);
    expect(listBudgetAlerts(db, id)).toEqual([
      { threshold: 80, spent_cents: 12000 },
      { threshold: 100, spent_cents: 12000 }
    ]);
  });

  it('重复重算不会重复写同一阈值', async () => {
    insertTransaction({ amountCents: 9000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    const id = budgetId(created);
    recalcBudgetForTransaction(db, 'u_001', '2026-11-16', 1);
    recalcBudgetForTransaction(db, 'u_001', '2026-11-17', 1);
    expect(listBudgetAlerts(db, id)).toEqual([{ threshold: 80, spent_cents: 9000 }]);
  });

  it('移除阈值时只删对应告警，保留其他阈值', async () => {
    insertTransaction({ amountCents: 12000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    const id = budgetId(created);
    expect(listBudgetAlerts(db, id)).toHaveLength(2);

    await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80]
    });
    expect(listBudgetAlerts(db, id)).toEqual([{ threshold: 80, spent_cents: 12000 }]);
  });

  it('调高预算不删除已触发告警', async () => {
    insertTransaction({ amountCents: 12000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    const id = budgetId(created);

    await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 20000,
      alertThresholds: [80, 100]
    });
    expect(listBudgetAlerts(db, id)).toEqual([
      { threshold: 80, spent_cents: 12000 },
      { threshold: 100, spent_cents: 12000 }
    ]);
  });

  it('删除预算级联删除告警', async () => {
    insertTransaction({ amountCents: 12000 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 10000,
      alertThresholds: [80, 100]
    });
    const id = budgetId(created);
    expect(listBudgetAlerts(db, id)).toHaveLength(2);

    const removed = await app.inject({ method: 'DELETE', url: `/api/budgets/${id}` });
    expect(removed.statusCode).toBe(204);
    expect(listBudgetAlerts(db, id)).toEqual([]);
  });

  it('类别预算只响应同类别账单，不响应其他类别', async () => {
    insertTransaction({ amountCents: 9000, categoryId: 2 });
    const created = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 1,
      amountCents: 10000,
      alertThresholds: [80]
    });
    const id = budgetId(created);
    recalcBudgetForTransaction(db, 'u_001', '2026-11-16', 2);
    expect(listBudgetAlerts(db, id)).toEqual([]);

    insertTransaction({ amountCents: 9000, categoryId: 1 });
    recalcBudgetForTransaction(db, 'u_001', '2026-11-16', 1);
    expect(listBudgetAlerts(db, id)).toEqual([{ threshold: 80, spent_cents: 9000 }]);
  });

  it('批量重算按月份与类别集合一次处理', async () => {
    insertTransaction({ amountCents: 9000, categoryId: 1 });
    insertTransaction({ amountCents: 9000, categoryId: 2 });
    const food = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 1,
      amountCents: 10000,
      alertThresholds: [80]
    });
    const traffic = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 2,
      amountCents: 10000,
      alertThresholds: [80]
    });
    recalcBudgetsForMonth(db, 'u_001', '2026-11', [1, 2]);
    expect(listBudgetAlerts(db, budgetId(food))).toHaveLength(1);
    expect(listBudgetAlerts(db, budgetId(traffic))).toHaveLength(1);
  });
});
