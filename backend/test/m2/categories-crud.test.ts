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

function insertTransaction(categoryId: number, status: 'confirmed' | 'void' = 'confirmed'): string {
  const id = `tx_cat_${++sequence}`;
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
        time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
        source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
     VALUES (?, 'u_001', 'expense', 'explicit', 1000, '测试商户', NULL, '2026-11-14T12:00:00+08:00', '2026-11-14',
             'explicit', NULL, ?, 'rule', 0.9, ?, 'text', NULL, 0, ?, '2026-11-14T12:00:00+08:00',
             '2026-11-14T12:00:00+08:00')`
  ).run(id, categoryId, status, `key_${id}`);
  return id;
}

async function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>
) {
  const response = await app.inject({ method, url, payload });
  return { status: response.statusCode, body: response.statusCode === 204 ? null : response.json() };
}

async function createCategory(name: string, kind: 'expense' | 'income' = 'expense') {
  return request('POST', '/api/categories', { name, kind, color: '#0EA5E9' });
}

describe('类别 CRUD', () => {
  it('创建自定义类别，ID 从 13 起自增', async () => {
    const result = await createCategory('宠物');
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ name: '宠物', kind: 'expense', isPreset: false, isActive: true });
    expect((result.body as { id: number }).id).toBeGreaterThanOrEqual(13);
  });

  it('同 kind 下重名返回 409', async () => {
    await createCategory('旅行');
    const duplicate = await createCategory('旅行');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'CATEGORY_NAME_TAKEN' } });
  });

  it('PATCH 可改颜色，改 kind 返回 422', async () => {
    const created = await createCategory('健身');
    const id = (created.body as { id: number }).id;

    const patched = await request('PATCH', `/api/categories/${id}`, { color: '#111111' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ color: '#111111' });

    const changedKind = await request('PATCH', `/api/categories/${id}`, { kind: 'income' });
    expect(changedKind.status).toBe(422);
    expect(changedKind.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field: 'kind' } });
  });

  it('PATCH 预设类别只允许停用，改其他字段返回 403', async () => {
    const rename = await request('PATCH', '/api/categories/1', { name: '餐饮改名' });
    expect(rename.status).toBe(403);
    expect(rename.body).toMatchObject({ error: { code: 'CATEGORY_PRESET_PROTECTED' } });

    const color = await request('PATCH', '/api/categories/1', { color: '#000000' });
    expect(color.status).toBe(403);

    const disable = await request('PATCH', '/api/categories/1', { isActive: false });
    expect(disable.status).toBe(200);
    expect(disable.body).toMatchObject({ isActive: false });

    const enable = await request('PATCH', '/api/categories/1', { isActive: true });
    expect(enable.status).toBe(200);
  });

  it('icon 传对象返回 422', async () => {
    const created = await createCategory('图标测试');
    const id = (created.body as { id: number }).id;
    const result = await request('PATCH', `/api/categories/${id}`, { icon: { a: 1 } });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'INVALID_QUERY_PARAM', field: 'icon' } });
  });

  it('删除预设类别返回 403', async () => {
    const result = await request('DELETE', '/api/categories/1');
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: 'CATEGORY_PRESET_PROTECTED' } });
  });

  it('删除被引用类别返回 409 与 counts（含 void 账单）', async () => {
    const created = await createCategory('待删');
    const id = (created.body as { id: number }).id;
    insertTransaction(id, 'void');

    const result = await request('DELETE', `/api/categories/${id}`);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: { code: 'CATEGORY_IN_USE', details: { counts: { transactions: 1, budgets: 0, rules: 0 } } }
    });
  });

  it('删除无引用类别返回 204', async () => {
    const created = await createCategory('空类别');
    const id = (created.body as { id: number }).id;
    const result = await request('DELETE', `/api/categories/${id}`);
    expect(result.status).toBe(204);

    const list = await request('GET', '/api/categories');
    expect((list.body as Array<{ id: number }>).some((item) => item.id === id)).toBe(false);
  });
});

describe('类别 reassign', () => {
  it('迁移账单（含 void）与学习规则', async () => {
    const source = await createCategory('源类别');
    const target = await createCategory('目标类别');
    const sourceId = (source.body as { id: number }).id;
    const targetId = (target.body as { id: number }).id;

    insertTransaction(sourceId, 'confirmed');
    insertTransaction(sourceId, 'void');
    db.prepare(
      'INSERT INTO user_category_rules (user_id, pattern, category_id, hit_count, last_used_at) VALUES (?, ?, ?, 1, ?)'
    ).run('u_001', '某商户', sourceId, '2026-11-14T12:00:00+08:00');

    const result = await request('POST', `/api/categories/${sourceId}/reassign`, { targetCategoryId: targetId });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      targetCategoryId: targetId,
      movedTransactions: 2,
      movedBudgets: 0,
      movedRules: 1
    });

    const remaining = db
      .prepare('SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?')
      .get(sourceId) as { total: number };
    expect(remaining.total).toBe(0);
  });

  it('方向不一致返回 409', async () => {
    const source = await createCategory('支出类');
    const sourceId = (source.body as { id: number }).id;
    insertTransaction(sourceId);

    const result = await request('POST', `/api/categories/${sourceId}/reassign`, { targetCategoryId: 9 });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: 'CATEGORY_KIND_MISMATCH' } });
  });

  it('预算同月冲突返回 409 与双方 id', async () => {
    const source = await createCategory('预算源');
    const target = await createCategory('预算目标');
    const sourceId = (source.body as { id: number }).id;
    const targetId = (target.body as { id: number }).id;

    db.prepare(
      `INSERT INTO budgets (user_id, month, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at)
       VALUES ('u_001', '2026-11', 'category', ?, 10000, '[80,100]', '2026-11-01T00:00:00+08:00', '2026-11-01T00:00:00+08:00')`
    ).run(sourceId);
    db.prepare(
      `INSERT INTO budgets (user_id, month, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at)
       VALUES ('u_001', '2026-11', 'category', ?, 20000, '[80,100]', '2026-11-01T00:00:00+08:00', '2026-11-01T00:00:00+08:00')`
    ).run(targetId);

    const result = await request('POST', `/api/categories/${sourceId}/reassign`, { targetCategoryId: targetId });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: { code: 'BUDGET_CONFLICT', details: { month: '2026-11' } }
    });
  });

  it('目标类别已停用返回 422', async () => {
    const source = await createCategory('停用源');
    const target = await createCategory('停用目标');
    const sourceId = (source.body as { id: number }).id;
    const targetId = (target.body as { id: number }).id;
    await request('PATCH', `/api/categories/${targetId}`, { isActive: false });

    const result = await request('POST', `/api/categories/${sourceId}/reassign`, { targetCategoryId: targetId });
    expect(result.status).toBe(422);
  });

  it('目标类别不存在返回 404', async () => {
    const source = await createCategory('缺失目标源');
    const sourceId = (source.body as { id: number }).id;
    const result = await request('POST', `/api/categories/${sourceId}/reassign`, { targetCategoryId: 9999 });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'CATEGORY_NOT_FOUND' } });
  });
});
