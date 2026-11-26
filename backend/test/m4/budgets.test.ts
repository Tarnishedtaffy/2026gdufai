import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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

let sequence = 0;

afterAll(async () => {
  await app.close();
  db.close();
});

beforeEach(() => {
  db.exec('DELETE FROM budget_alerts; DELETE FROM budgets; DELETE FROM transactions;');
});

interface TransactionOptions {
  amountCents?: number;
  date?: string;
  categoryId?: number | null;
  direction?: 'expense' | 'income';
  status?: 'confirmed' | 'void';
  entryType?: 'normal' | 'refund' | 'repayment';
}

function insertTransaction(options: TransactionOptions = {}): string {
  const id = `tx_m4_${++sequence}`;
  const amountCents = options.amountCents ?? 1000;
  const date = options.date ?? '2026-11-15';
  const categoryId = options.categoryId === undefined ? 1 : options.categoryId;
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
    amountCents,
    `${date}T12:00:00+08:00`,
    date,
    categoryId,
    status,
    `key_${id}`,
    entryType
  );
  return id;
}

async function getBudgets(month = '2026-11') {
  const response = await app.inject({ method: 'GET', url: `/api/budgets?month=${month}` });
  return { status: response.statusCode, body: response.json() };
}

async function putBudget(payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'PUT', url: '/api/budgets', payload });
  return { status: response.statusCode, body: response.json() };
}

async function deleteBudget(id: number | string) {
  const response = await app.inject({ method: 'DELETE', url: `/api/budgets/${id}` });
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
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

describe('GET /api/budgets', () => {
  it('空月份返回空数组', async () => {
    const result = await getBudgets();
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it('total 预算只统计支出、普通、已确认记录', async () => {
    insertTransaction({ amountCents: 8000 });
    insertTransaction({ amountCents: 100000, direction: 'income', categoryId: 9 });
    insertTransaction({ amountCents: 5000, status: 'void' });
    insertTransaction({ amountCents: 5000, entryType: 'refund' });
    insertTransaction({ amountCents: 5000, entryType: 'repayment' });
    insertTransaction({ amountCents: 5000, date: '2026-10-31' });

    const created = await putBudget(totalBudget());
    expect(created.status).toBe(200);
    const result = await getBudgets();
    expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({
      scope: 'total',
      category: null,
      amountCents: 10000,
      spentCents: 8000,
      remainingCents: 2000,
      usageRatio: 0.8,
      level: 'near',
      alertThresholds: [80, 100]
    });
    expect(typeof result.body[0].id).toBe('number');
  });

  it('category 预算只统计指定类别，并返回 {id,name}', async () => {
    insertTransaction({ amountCents: 6000, categoryId: 1 });
    insertTransaction({ amountCents: 3000, categoryId: 2 });

    const created = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 1,
      amountCents: 10000
    });
    expect(created.status).toBe(200);

    const result = await getBudgets();
    expect(result.body[0]).toMatchObject({
      scope: 'category',
      category: { id: 1, name: '餐饮' },
      spentCents: 6000,
      level: 'normal'
    });
    expect(result.body[0].category).not.toHaveProperty('kind');
  });

  it.each([
    [7999, 'normal'],
    [8000, 'near'],
    [9999, 'near'],
    [10000, 'over'],
    [12000, 'over']
  ])('spent=%i 时 level=%s', async (spentCents, level) => {
    insertTransaction({ amountCents: spentCents });
    await putBudget(totalBudget());
    const result = await getBudgets();
    expect(result.body[0].level).toBe(level);
  });
});

describe('PUT /api/budgets', () => {
  it('同一 (month, scope, categoryId) 幂等覆盖且保留 id', async () => {
    const first = await putBudget(totalBudget({ amountCents: 10000 }));
    const second = await putBudget(totalBudget({ amountCents: 20000 }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.amountCents).toBe(20000);

    const result = await getBudgets();
    expect(result.body).toHaveLength(1);
  });

  it('alertThresholds 去重升序且允许空数组', async () => {
    const sorted = await putBudget(totalBudget({ alertThresholds: [100, 80, 80] }));
    expect(sorted.body.alertThresholds).toEqual([80, 100]);

    const empty = await putBudget(totalBudget({ alertThresholds: [] }));
    expect(empty.status).toBe(200);
    expect(empty.body.alertThresholds).toEqual([]);
  });

  const invalidCases: Array<[string, Record<string, unknown>, string]> = [
    ['month 缺失', { month: undefined }, 'month'],
    ['month 非法', { month: '2026-13' }, 'month'],
    ['scope 非法', { scope: 'week' }, 'scope'],
    ['total 带 categoryId', { categoryId: 1 }, 'categoryId'],
    ['category 缺 categoryId', { scope: 'category', categoryId: undefined }, 'categoryId'],
    ['amountCents 为 0', { amountCents: 0 }, 'amountCents'],
    ['amountCents 非整数', { amountCents: 1.5 }, 'amountCents'],
    ['阈值越界', { alertThresholds: [0] }, 'alertThresholds'],
    ['阈值超过 200', { alertThresholds: [201] }, 'alertThresholds'],
    ['阈值非整数', { alertThresholds: [80.5] }, 'alertThresholds'],
    ['阈值超过 5 个', { alertThresholds: [1, 2, 3, 4, 5, 6] }, 'alertThresholds']
  ];

  it.each(invalidCases)('%s 返回 422', async (_name, overrides, field) => {
    const payload = totalBudget(overrides);
    if ('month' in overrides && overrides.month === undefined) {
      delete payload.month;
    }
    if ('categoryId' in overrides && overrides.categoryId === undefined) {
      delete payload.categoryId;
    }
    const result = await putBudget(payload);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field } });
  });

  it('类别不存在返回 404，收入类别返回 422', async () => {
    const missing = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 999,
      amountCents: 10000
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'CATEGORY_NOT_FOUND', field: 'categoryId' } });

    const income = await putBudget({
      month: '2026-11',
      scope: 'category',
      categoryId: 9,
      amountCents: 10000
    });
    expect(income.status).toBe(422);
    expect(income.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field: 'categoryId' } });
  });
});

describe('DELETE /api/budgets/:id', () => {
  it('删除成功后列表为空', async () => {
    const created = await putBudget(totalBudget());
    const id = created.body.id as number;
    const removed = await deleteBudget(id);
    expect(removed.status).toBe(204);
    expect((await getBudgets()).body).toEqual([]);
  });

  it('删除不存在返回 404，非法 id 返回 422', async () => {
    const missing = await deleteBudget(999);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'BUDGET_NOT_FOUND' } });

    const malformed = await deleteBudget('abc');
    expect(malformed.status).toBe(422);
    expect(malformed.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field: 'id' } });
  });
});
