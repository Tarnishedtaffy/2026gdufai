import type { Db } from '../../db/client.ts';

/** budgets 表原始行。 */
export interface BudgetRow {
  readonly id: number;
  readonly scope: 'total' | 'category';
  readonly category_id: number | null;
  readonly amount_cents: number;
  readonly alert_thresholds: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** 带类别名称的预算行，供 GET/PUT 组装响应。 */
export interface BudgetJoinedRow extends BudgetRow {
  readonly category_name: string | null;
}

/** 预算可选的类别元数据；kind 用于写入校验。 */
export interface BudgetCategoryRow {
  readonly id: number;
  readonly name: string;
  readonly kind: 'expense' | 'income';
}

/** 读取指定月份的全部预算，total 排在最前。 */
export function listBudgetRows(db: Db, userId: string, month: string): BudgetJoinedRow[] {
  return db
    .prepare(
      `SELECT b.id, b.scope, b.category_id, b.amount_cents, b.alert_thresholds,
              b.created_at, b.updated_at, c.name AS category_name
         FROM budgets b
         LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.user_id = ? AND b.month = ?
        ORDER BY CASE b.scope WHEN 'total' THEN 0 ELSE 1 END, b.id`
    )
    .all(userId, month) as BudgetJoinedRow[];
}

/** 按 (month, scope, categoryId) 查找预算；categoryId 为 null 时按 0 归一。 */
export function findBudgetByKey(
  db: Db,
  userId: string,
  month: string,
  scope: 'total' | 'category',
  categoryId: number | null
): BudgetRow | null {
  const row = db
    .prepare(
      `SELECT id, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at
         FROM budgets
        WHERE user_id = ? AND month = ? AND scope = ? AND ifnull(category_id, 0) = ?`
    )
    .get(userId, month, scope, categoryId ?? 0) as BudgetRow | undefined;
  return row ?? null;
}

/** 按 id 与用户读取预算，用于 PUT 后回显。 */
export function findBudgetById(db: Db, userId: string, id: number): BudgetRow | null {
  const row = db
    .prepare(
      `SELECT id, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at
         FROM budgets
        WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as BudgetRow | undefined;
  return row ?? null;
}

/** 查询类别是否存在以及 kind，预算只允许支出类别。 */
export function findBudgetCategory(db: Db, id: number): BudgetCategoryRow | null {
  const row = db
    .prepare('SELECT id, name, kind FROM categories WHERE id = ?')
    .get(id) as BudgetCategoryRow | undefined;
  return row ?? null;
}

/** 新增预算，返回自增 id。 */
export function insertBudget(
  db: Db,
  userId: string,
  month: string,
  scope: 'total' | 'category',
  categoryId: number | null,
  amountCents: number,
  thresholds: readonly number[],
  now: string
): number {
  const result = db
    .prepare(
      `INSERT INTO budgets
         (user_id, month, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, month, scope, categoryId, amountCents, JSON.stringify(thresholds), now, now);
  return Number(result.lastInsertRowid);
}

/** 覆盖已有预算的金额与阈值；created_at 保持不变。 */
export function updateBudget(
  db: Db,
  id: number,
  amountCents: number,
  thresholds: readonly number[],
  now: string
): void {
  db.prepare(
    `UPDATE budgets
        SET amount_cents = ?, alert_thresholds = ?, updated_at = ?
      WHERE id = ?`
  ).run(amountCents, JSON.stringify(thresholds), now, id);
}

/** 删除预算；budget_alerts 依靠外键 ON DELETE CASCADE 一并清理。 */
export function deleteBudget(db: Db, userId: string, id: number): number {
  const result = db.prepare('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes;
}

/**
 * 统计某月预算已用金额。
 * 只算支出、普通记录、已确认账单；中性退款/还款与 void 均排除。
 */
export function sumSpentCents(
  db: Db,
  userId: string,
  start: string,
  end: string,
  categoryId: number | null
): number {
  const params: Array<string | number> = [userId, start, end];
  let categoryFilter = '';
  if (categoryId !== null) {
    categoryFilter = ' AND category_id = ?';
    params.push(categoryId);
  }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS cents
         FROM transactions
        WHERE user_id = ?
          AND direction = 'expense'
          AND entry_type = 'normal'
          AND status = 'confirmed'
          AND occurred_date BETWEEN ? AND ?${categoryFilter}`
    )
    .get(...params) as { cents: number };
  return row.cents;
}

/** 读取预算已触发的告警阈值，供测试与调试使用。 */
export function listBudgetAlerts(
  db: Db,
  budgetId: number
): Array<{ threshold: number; spent_cents: number }> {
  return db
    .prepare('SELECT threshold, spent_cents FROM budget_alerts WHERE budget_id = ? ORDER BY threshold')
    .all(budgetId) as Array<{ threshold: number; spent_cents: number }>;
}

/** 写入一条阈值告警；同一 (budget_id, threshold) 已存在时保留旧记录。 */
export function insertAlertIfAbsent(
  db: Db,
  budgetId: number,
  threshold: number,
  spentCents: number,
  triggeredAt: string
): void {
  db.prepare(
    `INSERT OR IGNORE INTO budget_alerts (budget_id, threshold, spent_cents, channel, delivered, triggered_at)
     VALUES (?, ?, ?, 'log', 0, ?)`
  ).run(budgetId, threshold, spentCents, triggeredAt);
}

/** 只删除被移出 alertThresholds 的告警；保留仍配置的旧告警。 */
export function deleteAlertsNotIn(db: Db, budgetId: number, thresholds: readonly number[]): void {
  if (thresholds.length === 0) {
    db.prepare('DELETE FROM budget_alerts WHERE budget_id = ?').run(budgetId);
    return;
  }
  const placeholders = thresholds.map(() => '?').join(', ');
  db.prepare(`DELETE FROM budget_alerts WHERE budget_id = ? AND threshold NOT IN (${placeholders})`).run(
    budgetId,
    ...thresholds
  );
}

/** 当前月份内需要重算的预算：总预算 + 指定类别预算。 */
export function listBudgetsForRecalc(
  db: Db,
  userId: string,
  month: string,
  categoryId: number | null
): BudgetRow[] {
  if (categoryId === null) {
    return db
      .prepare(
        `SELECT id, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at
           FROM budgets WHERE user_id = ? AND month = ? AND scope = 'total'`
      )
      .all(userId, month) as BudgetRow[];
  }
  return db
    .prepare(
      `SELECT id, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at
         FROM budgets
        WHERE user_id = ? AND month = ? AND (scope = 'total' OR category_id = ?)`
    )
    .all(userId, month, categoryId) as BudgetRow[];
}

/** 按类别集合读取需要重算的预算，供批量导入后一次重算。 */
export function listBudgetsForRecalcMany(
  db: Db,
  userId: string,
  month: string,
  categoryIds: readonly number[]
): BudgetRow[] {
  if (categoryIds.length === 0) {
    return db
      .prepare(
        `SELECT id, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at
           FROM budgets WHERE user_id = ? AND month = ? AND scope = 'total'`
      )
      .all(userId, month) as BudgetRow[];
  }
  const placeholders = categoryIds.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, scope, category_id, amount_cents, alert_thresholds, created_at, updated_at
         FROM budgets
        WHERE user_id = ? AND month = ? AND (scope = 'total' OR category_id IN (${placeholders}))`
    )
    .all(userId, month, ...categoryIds) as BudgetRow[];
}
