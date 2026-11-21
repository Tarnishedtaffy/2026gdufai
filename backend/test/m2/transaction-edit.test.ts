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

let sequence = 0;

function insertTransaction(categoryId = 1, status: 'confirmed' | 'void' = 'confirmed'): string {
  const id = `tx_edit_${++sequence}`;
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
        time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
        source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
     VALUES (?, 'u_001', 'expense', 'explicit', 3250, '瑞幸咖啡', NULL, '2026-11-14T12:00:00+08:00', '2026-11-14',
             'explicit', NULL, ?, 'rule', 0.9, ?, 'text', NULL, 0, ?, '2026-11-14T12:00:00+08:00',
             '2026-11-14T12:00:00+08:00')`
  ).run(id, categoryId, status, `key_${id}`);
  return id;
}

async function patch(id: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method: 'PATCH', url: `/api/transactions/${id}`, payload });
  return { status: response.statusCode, body: response.json() };
}

async function voidById(id: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/transactions/${id}/void`,
    payload: {}
  });
  return { status: response.statusCode, body: response.json() };
}

describe('PATCH /api/transactions/:id', () => {
  it('修改金额并回显', async () => {
    const id = insertTransaction();
    const result = await patch(id, { amountCents: 5000 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id, amountCents: 5000, status: 'confirmed' });

    const row = db.prepare('SELECT amount_cents FROM transactions WHERE id = ?').get(id) as {
      amount_cents: number;
    };
    expect(row.amount_cents).toBe(5000);
  });

  it('改到另一侧类别时翻转 direction 并写学习规则', async () => {
    const id = insertTransaction(1);
    const result = await patch(id, { categoryId: 9 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ direction: 'income', category: { id: 9, kind: 'income' } });

    const rule = db
      .prepare('SELECT category_id FROM user_category_rules WHERE user_id = ? AND pattern = ?')
      .get('u_001', '瑞幸咖啡') as { category_id: number } | undefined;
    expect(rule?.category_id).toBe(9);
  });

  it('金额非正整数返回 422', async () => {
    const id = insertTransaction();
    expect((await patch(id, { amountCents: 0 })).status).toBe(422);
    expect((await patch(id, { amountCents: 1.5 })).status).toBe(422);
  });

  it('非法日期返回 422', async () => {
    const id = insertTransaction();
    const result = await patch(id, { occurredAt: '2026-02-31T12:00:00+08:00' });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field: 'occurredAt' } });
  });

  it('merchant 传空串或 null 返回 422', async () => {
    const id = insertTransaction();
    expect((await patch(id, { merchant: '' })).status).toBe(422);
    expect((await patch(id, { merchant: null })).status).toBe(422);
  });

  it('类别不存在返回 404', async () => {
    const id = insertTransaction();
    const result = await patch(id, { categoryId: 9999 });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'CATEGORY_NOT_FOUND' } });
  });

  it('已作废账单不可修改', async () => {
    const id = insertTransaction(1, 'void');
    const result = await patch(id, { amountCents: 100 });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field: 'status' } });
  });

  it('中性记录不允许 PATCH 或 void', async () => {
    const id = insertTransaction();
    db.prepare("UPDATE transactions SET entry_type = 'repayment' WHERE id = ?").run(id);

    const patched = await patch(id, { amountCents: 100 });
    expect(patched.status).toBe(422);
    expect(patched.body).toMatchObject({
      error: { code: 'INVALID_QUERY_PARAM', field: 'entryType' }
    });

    const voided = await voidById(id);
    expect(voided.status).toBe(422);
    expect(voided.body).toMatchObject({
      error: { code: 'INVALID_QUERY_PARAM', field: 'entryType' }
    });
  });

  it('只改金额不丢失 time_source / chat_at', async () => {
    const id = insertTransaction();
    db.prepare(
      "UPDATE transactions SET time_source = 'chat_time', chat_at = '2026-11-14T10:00:00+08:00' WHERE id = ?"
    ).run(id);

    const result = await patch(id, { amountCents: 5000 });
    expect(result.status).toBe(200);

    const row = db.prepare('SELECT time_source, chat_at FROM transactions WHERE id = ?').get(id) as {
      time_source: string;
      chat_at: string | null;
    };
    expect(row).toEqual({ time_source: 'chat_time', chat_at: '2026-11-14T10:00:00+08:00' });
  });

  it('金额超过安全整数返回 422', async () => {
    const id = insertTransaction();
    expect((await patch(id, { amountCents: 1e20 })).status).toBe(422);
  });

  it('改类别后 category_source 记为 manual', async () => {
    const id = insertTransaction();
    const result = await patch(id, { categoryId: 9 });
    expect(result.status).toBe(200);

    const row = db.prepare('SELECT category_source FROM transactions WHERE id = ?').get(id) as {
      category_source: string;
    };
    expect(row.category_source).toBe('manual');
  });

  it('账单不存在返回 404', async () => {
    const result = await patch('tx_missing', { amountCents: 100 });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'TRANSACTION_NOT_FOUND' } });
  });

  it('空对象 body 返回 422', async () => {
    const id = insertTransaction();
    const result = await patch(id, {});
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: { code: 'INVALID_QUERY_PARAM', field: 'body' }
    });
  });

  it('数组 body 返回 422', async () => {
    const id = insertTransaction();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/transactions/${id}`,
      payload: '[]',
      headers: { 'content-type': 'application/json' }
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_QUERY_PARAM', field: 'body' }
    });
  });

  it('categoryId 与原类别相同不写入学习规则', async () => {
    const id = insertTransaction(1);
    db.prepare("UPDATE transactions SET merchant = '同类别商户' WHERE id = ?").run(id);

    const result = await patch(id, { categoryId: 1 });
    expect(result.status).toBe(200);

    const rule = db
      .prepare('SELECT category_id FROM user_category_rules WHERE user_id = ? AND pattern = ?')
      .get('u_001', '同类别商户');
    expect(rule).toBeUndefined();
  });

  it('merchant 按 Unicode 码点计算长度', async () => {
    const id = insertTransaction();
    expect((await patch(id, { merchant: '😀'.repeat(101) })).status).toBe(422);
    expect((await patch(id, { merchant: '😀'.repeat(100) })).status).toBe(200);
  });
});

describe('POST /api/transactions/:id/void', () => {
  it('作废账单并幂等返回', async () => {
    const id = insertTransaction();
    const first = await voidById(id);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ id, status: 'void' });

    const second = await voidById(id);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ id, status: 'void' });

    const row = db.prepare('SELECT status FROM transactions WHERE id = ?').get(id) as {
      status: string;
    };
    expect(row.status).toBe('void');
  });

  it('账单不存在返回 404', async () => {
    const result = await voidById('tx_missing_void');
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'TRANSACTION_NOT_FOUND' } });
  });

  it('中性记录即使已是 void 仍返回 422', async () => {
    const id = insertTransaction(1, 'void');
    db.prepare("UPDATE transactions SET entry_type = 'repayment' WHERE id = ?").run(id);

    const result = await voidById(id);
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: { code: 'INVALID_QUERY_PARAM', field: 'entryType' }
    });
  });
});
