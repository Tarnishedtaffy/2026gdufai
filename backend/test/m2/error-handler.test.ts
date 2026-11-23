import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/config/index.ts';
import { openDatabase } from '../../src/db/client.ts';
import { AppError } from '../../src/shared/errors.ts';

const config: AppConfig = {
  port: 0,
  nodeEnv: 'test',
  databasePath: ':memory:',
  uploadDir: './uploads',
  authToken: null,
  demoUserId: 'u_001'
};

const db = openDatabase(':memory:');
const app = buildApp({ config, db });

app.get('/__test/category-in-use', async () => {
  throw new AppError('CATEGORY_IN_USE', 409, '类别在用', {
    field: 'categoryId',
    details: { counts: { transactions: 3, budgets: 1 } }
  });
});

app.get('/__test/unhandled', async () => {
  throw new Error('boom');
});

afterAll(async () => {
  await app.close();
  db.close();
});

describe('错误处理器', () => {
  it('CATEGORY_IN_USE 的 counts 能透传到响应体', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/category-in-use' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: 'CATEGORY_IN_USE',
        field: 'categoryId',
        details: { counts: { transactions: 3, budgets: 1 } }
      }
    });
  });

  it('非法 JSON 保留 400，并返回契约错误码而不是 Fastify 内部码', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transactions/import',
      headers: { 'content-type': 'application/json' },
      payload: '{bad'
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_BATCH' } });
  });

  it('未知路由保留 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/not-found' });
    expect(response.statusCode).toBe(404);
  });

  it('非 AppError 统一转成 500 INTERNAL_ERROR', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test/unhandled' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR' }
    });
  });
});
