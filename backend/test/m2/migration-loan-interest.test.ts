import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.ts';
import { PRESET_CATEGORIES, seedCategories } from '../../src/db/seed/categories.ts';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations/', import.meta.url));
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function insertUser(raw: Database.Database): void {
  raw
    .prepare(
      "INSERT INTO users (id, nickname, created_at) VALUES ('u_001', 'u_001', '2026-11-01T00:00:00+08:00')"
    )
    .run();
}

function insertCategory(raw: Database.Database, id: number, name: string): void {
  raw
    .prepare(
      `INSERT INTO categories (id, name, kind, keywords, color, icon, sort_order, is_preset, is_active, created_at)
       VALUES (?, ?, 'expense', '[]', '#000000', '📦', ?, 0, 1, '2026-11-01T00:00:00+08:00')`
    )
    .run(id, name, id);
}

function insertTransaction(raw: Database.Database, id: string, categoryId: number): void {
  raw
    .prepare(
      `INSERT INTO transactions
         (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
          time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
          source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
       VALUES (?, 'u_001', 'expense', 'explicit', 1000, '旧商户', NULL,
               '2026-11-02T12:00:00+08:00', '2026-11-02', 'explicit', NULL, ?, 'rule', 0.9, 'confirmed',
               'text', NULL, 0, ?, '2026-11-02T12:00:00+08:00', '2026-11-02T12:00:00+08:00')`
    )
    .run(id, categoryId, `key_${id}`);
}

function insertBudget(raw: Database.Database, categoryId: number): void {
  raw
    .prepare(
      `INSERT INTO budgets (user_id, month, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at)
       VALUES ('u_001', '2026-11', 'category', ?, 10000, '[80,100]', '2026-11-01T00:00:00+08:00', '2026-11-01T00:00:00+08:00')`
    )
    .run(categoryId);
}

function insertRule(raw: Database.Database, categoryId: number): void {
  raw
    .prepare(
      `INSERT INTO user_category_rules (user_id, pattern, category_id, hit_count, last_used_at)
       VALUES ('u_001', '旧商户', ?, 1, '2026-11-02T12:00:00+08:00')`
    )
    .run(categoryId);
}

/** 构造只应用了 001 + 002 的 v1.4 旧库。 */
function openLegacy(path: string): Database.Database {
  const raw = new Database(path);
  raw.exec(readFileSync(join(migrationsDir, '001_init.sql'), 'utf8'));
  raw.exec(readFileSync(join(migrationsDir, '002_refund_neutral.sql'), 'utf8'));
  raw.pragma('user_version = 2');
  return raw;
}

describe('迁移 003：贷款利息类别', () => {
  it('旧库自定义类别 13 迁移到 14，预设 13 可用且引用全部更新', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm2-migration-'));
    dirs.push(dir);
    const path = join(dir, 'legacy.db');

    const raw = new Database(path);
    raw.exec(readFileSync(join(migrationsDir, '001_init.sql'), 'utf8'));
    raw.exec(readFileSync(join(migrationsDir, '002_refund_neutral.sql'), 'utf8'));
    raw.pragma('user_version = 2');

    raw
      .prepare("INSERT INTO users (id, nickname, created_at) VALUES ('u_001', 'u_001', '2026-11-01T00:00:00+08:00')")
      .run();
    raw
      .prepare(
        `INSERT INTO categories (id, name, kind, keywords, color, icon, sort_order, is_preset, is_active, created_at)
         VALUES (13, '宠物', 'expense', '["狗粮"]', '#000000', '🐱', 13, 0, 1, '2026-11-01T00:00:00+08:00')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO transactions
           (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
            time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
            source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
         VALUES ('tx_legacy', 'u_001', 'expense', 'explicit', 1000, '宠物店', NULL,
                 '2026-11-02T12:00:00+08:00', '2026-11-02', 'explicit', NULL, 13, 'rule', 0.9, 'confirmed',
                 'text', NULL, 0, 'key_legacy', '2026-11-02T12:00:00+08:00', '2026-11-02T12:00:00+08:00')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO budgets (user_id, month, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at)
         VALUES ('u_001', '2026-11', 'category', 13, 10000, '[80,100]', '2026-11-01T00:00:00+08:00', '2026-11-01T00:00:00+08:00')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO user_category_rules (user_id, pattern, category_id, hit_count, last_used_at)
         VALUES ('u_001', '宠物店', 13, 1, '2026-11-02T12:00:00+08:00')`
      )
      .run();
    raw.close();

    const db = openDatabase(path);

    const preset = db.prepare('SELECT name, is_preset, keywords FROM categories WHERE id = 13').get() as {
      name: string;
      is_preset: number;
      keywords: string;
    };
    expect(preset).toMatchObject({ name: '贷款利息', is_preset: 1 });
    expect(JSON.parse(preset.keywords)).toEqual(
      expect.arrayContaining(['还利息', '付利息', '还息'])
    );

    const custom = db.prepare('SELECT id, name, is_preset FROM categories WHERE name = ?').get('宠物') as {
      id: number;
      name: string;
      is_preset: number;
    };
    expect(custom).toEqual({ id: 14, name: '宠物', is_preset: 0 });

    const tx = db.prepare('SELECT category_id, principal_cents FROM transactions WHERE id = ?').get('tx_legacy') as {
      category_id: number;
      principal_cents: number | null;
    };
    expect(tx.category_id).toBe(14);
    expect(tx.principal_cents).toBeNull();

    const budget = db.prepare('SELECT category_id FROM budgets').get() as { category_id: number };
    expect(budget.category_id).toBe(14);

    const rule = db.prepare('SELECT category_id FROM user_category_rules').get() as {
      category_id: number;
    };
    expect(rule.category_id).toBe(14);

    expect(Number(db.pragma('user_version', { simple: true }))).toBe(3);
    db.close();
  });

  it('旧库同名自定义「贷款利息」（任意 id）先重命名，不阻塞预设 13', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm2-migration-same-'));
    dirs.push(dir);
    const path = join(dir, 'legacy.db');

    const raw = new Database(path);
    raw.exec(readFileSync(join(migrationsDir, '001_init.sql'), 'utf8'));
    raw.exec(readFileSync(join(migrationsDir, '002_refund_neutral.sql'), 'utf8'));
    raw.pragma('user_version = 2');
    raw
      .prepare(
        "INSERT INTO users (id, nickname, created_at) VALUES ('u_001', 'u_001', '2026-11-01T00:00:00+08:00')"
      )
      .run();
    raw
      .prepare(
        `INSERT INTO categories (id, name, kind, keywords, color, icon, sort_order, is_preset, is_active, created_at)
         VALUES (20, '贷款利息', 'expense', '[]', '#000000', '🧾', 20, 0, 1, '2026-11-01T00:00:00+08:00')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO transactions
           (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
            time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
            source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
         VALUES ('tx_same', 'u_001', 'expense', 'explicit', 1000, '旧商户', NULL,
                 '2026-11-02T12:00:00+08:00', '2026-11-02', 'explicit', NULL, 20, 'rule', 0.9, 'confirmed',
                 'text', NULL, 0, 'key_same', '2026-11-02T12:00:00+08:00', '2026-11-02T12:00:00+08:00')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO budgets (user_id, month, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at)
         VALUES ('u_001', '2026-11', 'category', 20, 10000, '[80,100]', '2026-11-01T00:00:00+08:00', '2026-11-01T00:00:00+08:00')`
      )
      .run();
    raw
      .prepare(
        `INSERT INTO user_category_rules (user_id, pattern, category_id, hit_count, last_used_at)
         VALUES ('u_001', '旧商户', 20, 1, '2026-11-02T12:00:00+08:00')`
      )
      .run();
    raw.close();

    const db = openDatabase(path);
    const preset = db.prepare('SELECT name, is_preset FROM categories WHERE id = 13').get() as {
      name: string;
      is_preset: number;
    };
    expect(preset).toEqual({ name: '贷款利息', is_preset: 1 });

    const legacy = db
      .prepare('SELECT id, name, is_preset FROM categories WHERE id = 20')
      .get() as { id: number; name: string; is_preset: number };
    expect(legacy).toEqual({ id: 20, name: '贷款利息(旧)', is_preset: 0 });

    const tx = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get('tx_same') as {
      category_id: number;
    };
    expect(tx.category_id).toBe(20);
    const budget = db.prepare('SELECT category_id FROM budgets').get() as { category_id: number };
    expect(budget.category_id).toBe(20);
    const rule = db.prepare('SELECT category_id FROM user_category_rules').get() as {
      category_id: number;
    };
    expect(rule.category_id).toBe(20);
    db.close();
  });

  it('旧库已存在「贷款利息(旧)」时改用唯一后缀，迁移不回滚', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm2-migration-suffix-'));
    dirs.push(dir);
    const path = join(dir, 'legacy.db');

    const raw = openLegacy(path);
    insertUser(raw);
    insertCategory(raw, 30, '贷款利息');
    insertCategory(raw, 31, '贷款利息(旧)');
    raw.close();

    const db = openDatabase(path);
    const preset = db.prepare('SELECT name, is_preset FROM categories WHERE id = 13').get() as {
      name: string;
      is_preset: number;
    };
    expect(preset).toEqual({ name: '贷款利息', is_preset: 1 });

    const renamed = db.prepare('SELECT id, name FROM categories WHERE id = 30').get() as {
      id: number;
      name: string;
    };
    expect(renamed).toEqual({ id: 30, name: '贷款利息(旧2)' });

    const untouched = db.prepare('SELECT id, name FROM categories WHERE id = 31').get() as {
      id: number;
      name: string;
    };
    expect(untouched).toEqual({ id: 31, name: '贷款利息(旧)' });
    db.close();
  });

  it('旧库自定义 13 与同名自定义 14 同时存在时，先重命名再整体迁移', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm2-migration-mixed-'));
    dirs.push(dir);
    const path = join(dir, 'legacy.db');

    const raw = openLegacy(path);
    insertUser(raw);
    insertCategory(raw, 13, '宠物');
    insertCategory(raw, 14, '贷款利息');
    insertTransaction(raw, 'tx_mixed', 13);
    insertBudget(raw, 13);
    insertRule(raw, 13);
    raw.close();

    const db = openDatabase(path);

    const preset = db.prepare('SELECT name, is_preset FROM categories WHERE id = 13').get() as {
      name: string;
      is_preset: number;
    };
    expect(preset).toEqual({ name: '贷款利息', is_preset: 1 });

    const pet = db.prepare('SELECT id, name, is_preset FROM categories WHERE name = ?').get('宠物') as {
      id: number;
      name: string;
      is_preset: number;
    };
    expect(pet).toEqual({ id: 15, name: '宠物', is_preset: 0 });

    const customLoan = db
      .prepare('SELECT id, name, is_preset FROM categories WHERE id = 14')
      .get() as { id: number; name: string; is_preset: number };
    expect(customLoan).toEqual({ id: 14, name: '贷款利息(旧)', is_preset: 0 });

    const tx = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get('tx_mixed') as {
      category_id: number;
    };
    expect(tx.category_id).toBe(15);
    const budget = db.prepare('SELECT category_id FROM budgets').get() as { category_id: number };
    expect(budget.category_id).toBe(15);
    const rule = db.prepare('SELECT category_id FROM user_category_rules').get() as {
      category_id: number;
    };
    expect(rule.category_id).toBe(15);
    db.close();
  });

  it('新库种子后类别 13 关键词与 PRESET_CATEGORIES 完全一致', () => {
    const db = openDatabase(':memory:');
    seedCategories(db);
    const row = db.prepare('SELECT keywords FROM categories WHERE id = 13').get() as {
      keywords: string;
    };
    const preset = PRESET_CATEGORIES.find((category) => category.id === 13);
    expect(preset).toBeDefined();
    expect(JSON.parse(row.keywords)).toEqual(preset?.keywords);
    db.close();
  });

  it('principal_cents 拒绝负数', () => {
    const db = openDatabase(':memory:');
    insertUser(db);
    db.prepare(
      `INSERT INTO transactions
         (id, user_id, direction, direction_source, amount_cents, merchant, note, occurred_at, occurred_date,
          time_source, chat_at, category_id, category_source, category_confidence, status, source_modality,
          source_ref, anomaly_flag, idempotency_key, created_at, updated_at)
       VALUES ('tx_neg', 'u_001', 'expense', 'explicit', 1000, '旧商户', NULL,
               '2026-11-02T12:00:00+08:00', '2026-11-02', 'explicit', NULL, NULL, 'rule', 0.9, 'confirmed',
               'text', NULL, 0, 'key_neg', '2026-11-02T12:00:00+08:00', '2026-11-02T12:00:00+08:00')`
    ).run();

    expect(() =>
      db.prepare("UPDATE transactions SET principal_cents = -1 WHERE id = 'tx_neg'").run()
    ).toThrow(/CHECK/);
    db.close();
  });

  it('存在 idx_tx_matched_entry 索引', () => {
    const db = openDatabase(':memory:');
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tx_matched_entry'")
      .get() as { name: string } | undefined;
    expect(row).toEqual({ name: 'idx_tx_matched_entry' });
    db.close();
  });
});
