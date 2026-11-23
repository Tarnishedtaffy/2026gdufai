import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/config/index.ts';
import { openDatabase } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';

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
const app = buildApp({ config, db });

afterAll(async () => {
  await app.close();
  db.close();
});

const response = await app.inject({ method: 'GET', url: '/api/categories' });

describe('GET /api/categories', () => {
  it('返回全部预设类别及收支分布', () => {
    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<{ id: number; kind: string; isPreset: boolean; color: string }>;
    expect(items).toHaveLength(13);
    expect(items.filter((item) => item.kind === 'expense')).toHaveLength(9);
    expect(items.filter((item) => item.kind === 'income')).toHaveLength(4);
    expect(items.every((item) => item.isPreset)).toBe(true);
    expect(items[0]).toMatchObject({ id: 1, color: '#F97316' });
    expect(items.find((item) => item.id === 12)).toMatchObject({ name: '贷款', kind: 'income' });
  });
});
