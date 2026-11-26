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

const USER = 'u_001';
db.prepare('INSERT OR IGNORE INTO users (id, nickname, created_at) VALUES (?, ?, ?)').run(
  USER,
  USER,
  '2026-11-01T00:00:00+08:00'
);

function insert(id: string, date: string, amountCents: number, categoryId: number, entryType = 'normal'): void {
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
        time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
        source_ref, anomaly_flag, idempotency_key, created_at, updated_at, entry_type, matched_transaction_id)
     VALUES (?, ?, 'expense', 'explicit', ?, '测试商户', NULL, ?, ?, 'explicit', NULL, ?, 'rule', 0.9, 'confirmed',
             'text', NULL, 0, ?, ?, ?, ?, NULL)`
  ).run(
    id,
    USER,
    amountCents,
    `${date}T12:00:00+08:00`,
    date,
    categoryId,
    `key_${id}`,
    '2026-11-01T00:00:00+08:00',
    '2026-11-01T00:00:00+08:00',
    entryType
  );
}

insert('tx_a', '2026-11-14', 1000, 1);
insert('tx_b', '2026-11-13', 2000, 2);
insert('tx_c', '2026-11-12', 3000, 1);
insert('tx_refund', '2026-11-15', 500, 8, 'refund');

afterAll(async () => {
  await app.close();
  db.close();
});

async function list(query: string) {
  const response = await app.inject({ method: 'GET', url: `/api/transactions?${query}` });
  return { status: response.statusCode, body: response.json() };
}

describe('GET /api/transactions', () => {
  it('默认按发生日期倒序并带整个筛选集汇总', async () => {
    const result = await list('limit=2');
    expect(result.status).toBe(200);
    expect(result.body.items.map((item: { id: string }) => item.id)).toEqual(['tx_a', 'tx_b']);
    expect(result.body.summary).toMatchObject({ count: 3, expenseCents: 6000, incomeCents: 0 });
    expect(result.body.items[0].matchedTransactionId).toBeNull();
    expect(result.body.page.hasMore).toBe(true);
    expect(result.body.page.nextCursor).toBeTypeOf('string');
  });

  it('用游标翻页无重复无遗漏', async () => {
    const first = await list('limit=2');
    const second = await list(`limit=2&cursor=${encodeURIComponent(first.body.page.nextCursor)}`);
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual(['tx_c']);
    expect(second.body.page.hasMore).toBe(false);
    expect(second.body.page.nextCursor).toBeNull();
  });

  it('按类别筛选并统计该类别合计', async () => {
    const result = await list('categoryId=1');
    expect(result.body.summary).toMatchObject({ count: 2, expenseCents: 4000 });
    expect(result.body.items.every((item: { category: { id: number } }) => item.category.id === 1)).toBe(true);
  });

  it('中性记录列表非空时 isEmpty 为 false，summary 仍为 0', async () => {
    const result = await list('entryType=refund');
    expect(result.body.items.map((item: { id: string }) => item.id)).toEqual(['tx_refund']);
    expect(result.body.summary.count).toBe(0);
    expect(result.body.meta.isEmpty).toBe(false);
  });

  it('拒绝 2026-02-31 这类不存在的日期', async () => {
    const result = await list('from=2026-02-31&to=2026-03-01');
    expect(result.status).toBe(422);
  });

  it('空结果标记 isEmpty', async () => {
    const result = await list('from=2020-01-01&to=2020-01-31');
    expect(result.body.items).toEqual([]);
    expect(result.body.meta.isEmpty).toBe(true);
    expect(result.body.summary.count).toBe(0);
  });

  it('entryType=all 时包含中性记录，但汇总仍只算正常账单', async () => {
    const result = await list('entryType=all');
    expect(result.body.items).toHaveLength(4);
    expect(result.body.items[0]).toMatchObject({ id: 'tx_refund', entryType: 'refund' });
    expect(result.body.summary).toMatchObject({ count: 3, expenseCents: 6000 });
  });

  it('带原单关联的超额退款收入在 normal 列表中保留原单 id', async () => {
    insert('tx_excess', '2026-10-01', 1250, 11);
    try {
      db.prepare("UPDATE transactions SET direction='income', matched_transaction_id=? WHERE id=?").run('tx_a', 'tx_excess');
      const result = await list('entryType=normal&direction=income&from=2026-10-01&to=2026-10-01');
      expect(result.status).toBe(200);
      expect(result.body.items).toHaveLength(1);
      expect(result.body.items[0]).toMatchObject({ id: 'tx_excess', entryType: 'normal', matchedTransactionId: 'tx_a' });
    } finally {
      db.prepare('DELETE FROM transactions WHERE id=?').run('tx_excess');
    }
  });


  it('非法方向返回 422', async () => {
    const result = await list('direction=all');
    expect(result.status).toBe(422);
  });
});
