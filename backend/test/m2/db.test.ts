import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.ts';
import { PRESET_CATEGORIES, seedCategories } from '../../src/db/seed/categories.ts';

describe('数据库迁移与种子', () => {
  it('首次打开会执行迁移并记录版本', () => {
    const db = openDatabase(':memory:');
    const version = Number(db.pragma('user_version', { simple: true }));
    expect(version).toBe(3);
    db.close();
  });

  it('核心表全部存在', () => {
    const db = openDatabase(':memory:');
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name);
    for (const table of [
      'users',
      'categories',
      'user_category_rules',
      'transactions',
      'budgets',
      'budget_alerts',
      'intake_log'
    ]) {
      expect(names).toContain(table);
    }
    db.close();
  });

  it('种子写入 13 个预设类别，支出 9 / 收入 4', () => {
    const db = openDatabase(':memory:');
    seedCategories(db);
    const row = db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(kind = 'expense') AS expense, SUM(kind = 'income') AS income FROM categories WHERE is_preset = 1"
      )
      .get() as { total: number; expense: number; income: number };
    expect(row.total).toBe(13);
    expect(row.expense).toBe(9);
    expect(row.income).toBe(4);
    expect(PRESET_CATEGORIES).toHaveLength(13);
    db.close();
  });

  it('种子可重复执行且不覆盖已有数据', () => {
    const db = openDatabase(':memory:');
    seedCategories(db);
    db.prepare("UPDATE categories SET color = '#000000' WHERE id = 1").run();
    seedCategories(db);
    const row = db.prepare('SELECT color FROM categories WHERE id = 1').get() as { color: string };
    expect(row.color).toBe('#000000');
    db.close();
  });
});
