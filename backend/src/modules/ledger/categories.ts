import type { Db } from '../../db/client.ts';
import { AppError, categoryNotFound } from '../../shared/errors.ts';
import { nowIsoShanghai } from '../../shared/time.ts';
import type { Direction } from './types.ts';

export interface CategoryRecord {
  readonly id: number;
  readonly name: string;
  readonly kind: Direction;
  readonly color: string;
  readonly icon: string;
  readonly keywords: string[];
  readonly sortOrder: number;
  readonly isPreset: boolean;
  readonly isActive: boolean;
}

interface CategoryRow {
  id: number;
  name: string;
  kind: Direction;
  color: string;
  icon: string;
  keywords: string;
  sort_order: number;
  is_preset: number;
  is_active: number;
}

function toRecord(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    icon: row.icon,
    keywords: JSON.parse(row.keywords) as string[],
    sortOrder: row.sort_order,
    isPreset: row.is_preset === 1,
    isActive: row.is_active === 1
  };
}

function invalid(message: string, field: string): never {
  throw new AppError('INVALID_QUERY_PARAM', 422, message, { field });
}

export function findCategory(db: Db, id: number): CategoryRecord | null {
  const row = db
    .prepare(
      'SELECT id, name, kind, color, icon, keywords, sort_order, is_preset, is_active FROM categories WHERE id = ?'
    )
    .get(id) as CategoryRow | undefined;
  return row === undefined ? null : toRecord(row);
}

function assertName(db: Db, kind: Direction, name: string, excludeId?: number): void {
  const row = db
    .prepare('SELECT id FROM categories WHERE kind = ? AND name = ? AND id <> ?')
    .get(kind, name, excludeId ?? -1) as { id: number } | undefined;
  if (row !== undefined) {
    throw new AppError('CATEGORY_NAME_TAKEN', 409, `类别名「${name}」已存在`, {
      field: 'name',
      details: { categoryId: row.id }
    });
  }
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid('name 必须是非空字符串', 'name');
  }
  return value.trim();
}

function normalizeColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    invalid('color 必须是 #RRGGBB', 'color');
  }
  return value;
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    invalid('keywords 必须是非空字符串数组', 'keywords');
  }
  return value.map((item) => (item as string).trim());
}

function normalizeKind(value: unknown): Direction {
  if (value !== 'expense' && value !== 'income') {
    invalid('kind 必须是 expense / income', 'kind');
  }
  return value;
}

function normalizeIcon(value: unknown): string {
  if (typeof value !== 'string') {
    invalid('icon 必须是字符串', 'icon');
  }
  return value;
}

export interface CreateCategoryInput {
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly color?: unknown;
  readonly icon?: unknown;
  readonly keywords?: unknown;
  readonly sortOrder?: unknown;
}

export function createCategory(db: Db, input: CreateCategoryInput): CategoryRecord {
  const name = normalizeName(input.name);
  const kind = normalizeKind(input.kind);
  const color = input.color === undefined ? '#6B7280' : normalizeColor(input.color);
  const icon = input.icon === undefined ? '' : normalizeIcon(input.icon);
  const keywords = input.keywords === undefined ? [] : normalizeKeywords(input.keywords);
  const sortOrder =
    input.sortOrder === undefined
      ? 100
      : Number.isInteger(input.sortOrder)
        ? Number(input.sortOrder)
        : invalid('sortOrder 必须是整数', 'sortOrder');

  assertName(db, kind, name);
  const result = db
    .prepare(
      `INSERT INTO categories (name, kind, keywords, color, icon, sort_order, is_preset, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`
    )
    .run(name, kind, JSON.stringify(keywords), color, icon, sortOrder, nowIsoShanghai());

  return findCategory(db, Number(result.lastInsertRowid)) as CategoryRecord;
}

export interface UpdateCategoryInput {
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly color?: unknown;
  readonly icon?: unknown;
  readonly keywords?: unknown;
  readonly sortOrder?: unknown;
  readonly isActive?: unknown;
}

export function updateCategory(db: Db, id: number, input: UpdateCategoryInput): CategoryRecord {
  const current = findCategory(db, id);
  if (current === null) {
    throw categoryNotFound(id);
  }
  if (input.kind !== undefined) {
    invalid('kind 创建后不可变', 'kind');
  }
  if (
    current.isPreset &&
    (input.name !== undefined ||
      input.color !== undefined ||
      input.icon !== undefined ||
      input.keywords !== undefined ||
      input.sortOrder !== undefined)
  ) {
    throw new AppError('CATEGORY_PRESET_PROTECTED', 403, '预设类别只能停用，不能修改其他字段', {
      field: 'categoryId'
    });
  }

  const name = input.name === undefined ? current.name : normalizeName(input.name);
  const color = input.color === undefined ? current.color : normalizeColor(input.color);
  const icon = input.icon === undefined ? current.icon : normalizeIcon(input.icon);
  const keywords = input.keywords === undefined ? current.keywords : normalizeKeywords(input.keywords);
  const sortOrder =
    input.sortOrder === undefined
      ? current.sortOrder
      : Number.isInteger(input.sortOrder)
        ? Number(input.sortOrder)
        : invalid('sortOrder 必须是整数', 'sortOrder');
  const isActive =
    input.isActive === undefined
      ? current.isActive
      : typeof input.isActive === 'boolean'
        ? input.isActive
        : invalid('isActive 必须是布尔值', 'isActive');

  assertName(db, current.kind, name, id);
  db.prepare(
    `UPDATE categories SET name = ?, color = ?, icon = ?, keywords = ?, sort_order = ?, is_active = ?
      WHERE id = ?`
  ).run(name, color, icon, JSON.stringify(keywords), sortOrder, isActive ? 1 : 0, id);

  return findCategory(db, id) as CategoryRecord;
}

export interface CategoryCounts {
  readonly transactions: number;
  readonly budgets: number;
  readonly rules: number;
}

function countReferenced(db: Db, id: number): CategoryCounts {
  const count = (sql: string): number =>
    (db.prepare(sql).get(id) as { total: number }).total;
  return {
    transactions: count('SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?'),
    budgets: count('SELECT COUNT(*) AS total FROM budgets WHERE category_id = ?'),
    rules: count('SELECT COUNT(*) AS total FROM user_category_rules WHERE category_id = ?')
  };
}

export function deleteCategory(db: Db, id: number): void {
  const current = findCategory(db, id);
  if (current === null) {
    throw categoryNotFound(id);
  }
  if (current.isPreset) {
    throw new AppError('CATEGORY_PRESET_PROTECTED', 403, '预设类别只能停用，不能删除', {
      field: 'categoryId'
    });
  }
  const counts = countReferenced(db, id);
  if (counts.transactions > 0 || counts.budgets > 0 || counts.rules > 0) {
    throw new AppError('CATEGORY_IN_USE', 409, '该类别仍有引用，不能删除', {
      field: 'categoryId',
      details: { counts }
    });
  }
  db.transaction(() => {
    db.prepare('DELETE FROM user_category_rules WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  })();
}

export interface ReassignResult {
  readonly targetCategoryId: number;
  readonly movedTransactions: number;
  readonly movedBudgets: number;
  readonly movedRules: number;
}

export function reassignCategory(db: Db, sourceId: number, targetId: number): ReassignResult {
  const source = findCategory(db, sourceId);
  if (source === null) {
    throw categoryNotFound(sourceId);
  }
  const target = findCategory(db, targetId);
  if (target === null) {
    throw new AppError('CATEGORY_NOT_FOUND', 404, `类别 ${targetId} 不存在`, {
      field: 'targetCategoryId'
    });
  }
  if (!target.isActive) {
    invalid('目标类别已停用', 'targetCategoryId');
  }
  if (source.id === target.id) {
    return { targetCategoryId: target.id, movedTransactions: 0, movedBudgets: 0, movedRules: 0 };
  }

  const mismatch = db
    .prepare('SELECT COUNT(*) AS total FROM transactions WHERE category_id = ? AND direction <> ?')
    .get(source.id, target.kind) as { total: number };
  if (mismatch.total > 0) {
    throw new AppError('CATEGORY_KIND_MISMATCH', 409, '目标类别方向与已有账单不一致', {
      field: 'targetCategoryId'
    });
  }

  const conflict = db
    .prepare(
      `SELECT s.id AS sourceBudgetId, t.id AS targetBudgetId, s.month
         FROM budgets s
         JOIN budgets t ON t.user_id = s.user_id AND t.month = s.month AND t.category_id = ?
        WHERE s.category_id = ?
        LIMIT 1`
    )
    .get(target.id, source.id) as
    | { sourceBudgetId: number; targetBudgetId: number; month: string }
    | undefined;
  if (conflict !== undefined) {
    throw new AppError('BUDGET_CONFLICT', 409, '目标类别在同一月份已有预算', {
      field: 'targetCategoryId',
      details: {
        sourceBudgetId: conflict.sourceBudgetId,
        targetBudgetId: conflict.targetBudgetId,
        month: conflict.month
      }
    });
  }

  let result: ReassignResult = {
    targetCategoryId: target.id,
    movedTransactions: 0,
    movedBudgets: 0,
    movedRules: 0
  };
  db.transaction(() => {
    const transactions = db
      .prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?')
      .run(target.id, source.id);
    const budgets = db
      .prepare('UPDATE budgets SET category_id = ? WHERE category_id = ?')
      .run(target.id, source.id);
    const rules = db
      .prepare('SELECT id, user_id, pattern, hit_count FROM user_category_rules WHERE category_id = ?')
      .all(source.id) as Array<{ id: number; user_id: string; pattern: string; hit_count: number }>;
    for (const rule of rules) {
      const existing = db
        .prepare('SELECT id FROM user_category_rules WHERE user_id = ? AND pattern = ? AND id <> ?')
        .get(rule.user_id, rule.pattern, rule.id) as { id: number } | undefined;
      if (existing === undefined) {
        db.prepare('UPDATE user_category_rules SET category_id = ? WHERE id = ?').run(target.id, rule.id);
      } else {
        db.prepare('UPDATE user_category_rules SET hit_count = hit_count + ? WHERE id = ?').run(
          rule.hit_count,
          existing.id
        );
        db.prepare('DELETE FROM user_category_rules WHERE id = ?').run(rule.id);
      }
    }
    result = {
      targetCategoryId: target.id,
      movedTransactions: transactions.changes,
      movedBudgets: budgets.changes,
      movedRules: rules.length
    };
  })();

  return result;
}
