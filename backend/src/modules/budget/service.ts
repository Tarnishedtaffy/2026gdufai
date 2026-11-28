import type { Db } from '../../db/client.ts';
import { AppError, categoryNotFound } from '../../shared/errors.ts';
import { nowIsoShanghai } from '../../shared/time.ts';
import {
  deleteAlertsNotIn,
  deleteBudget,
  findBudgetByKey,
  findBudgetById,
  findBudgetCategory,
  insertAlertIfAbsent,
  insertBudget,
  listBudgetRows,
  listBudgetsForRecalc,
  listBudgetsForRecalcMany,
  sumSpentCents,
  updateBudget,
  type BudgetJoinedRow,
  type BudgetRow
} from './repository.ts';
import type { BudgetCategory, BudgetInput, BudgetLevel, BudgetScope, BudgetView } from './types.ts';

const MONTH_RE = /^(\d{4})-(\d{2})$/;

function invalid(message: string, field: string): never {
  throw new AppError('INVALID_QUERY_PARAM', 422, message, { field });
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] as number;
}

interface ParsedMonth {
  readonly month: string;
  readonly start: string;
  readonly end: string;
}

/** 校验 YYYY-MM 并给出当月的 occurred_date 闭区间。 */
function parseMonth(value: unknown): ParsedMonth {
  if (typeof value !== 'string') {
    invalid('month 必须是 YYYY-MM 字符串', 'month');
  }
  const match = MONTH_RE.exec(value);
  if (match === null) {
    invalid('month 必须是 YYYY-MM', 'month');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    invalid('month 的年份必须在 0001–9999 之间', 'month');
  }
  if (month < 1 || month > 12) {
    invalid('month 的月份必须在 01–12 之间', 'month');
  }
  const monthText = String(month).padStart(2, '0');
  const normalized = `${String(year).padStart(4, '0')}-${monthText}`;
  return {
    month: normalized,
    start: `${normalized}-01`,
    end: `${normalized}-${String(daysInMonth(year, month)).padStart(2, '0')}`
  };
}

function parseScope(value: unknown): BudgetScope {
  if (value !== 'total' && value !== 'category') {
    invalid('scope 必须是 total / category', 'scope');
  }
  return value;
}

function parseThresholds(value: unknown): number[] {
  if (value === undefined) {
    return [80, 100];
  }
  if (!Array.isArray(value)) {
    invalid('alertThresholds 必须是整数数组', 'alertThresholds');
  }
  const unique = new Set<number>();
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1 || item > 200) {
      invalid('alertThresholds 的元素必须是 1–200 的整数', 'alertThresholds');
    }
    unique.add(item);
  }
  const thresholds = [...unique].sort((a, b) => a - b);
  if (thresholds.length > 5) {
    invalid('alertThresholds 去重后最多 5 个', 'alertThresholds');
  }
  return thresholds;
}

function readStoredThresholds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [80, 100];
    }
    const thresholds = parsed.filter(
      (item): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 1 && item <= 200
    );
    return [...new Set(thresholds)].sort((a, b) => a - b);
  } catch {
    return [80, 100];
  }
}

function parseBudgetInput(body: unknown): BudgetInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    invalid('请求体必须是对象', 'body');
  }
  const input = body as Record<string, unknown>;
  const month = parseMonth(input.month).month;
  const scope = parseScope(input.scope);

  let categoryId: number | null = null;
  if (scope === 'total') {
    if (input.categoryId !== null) {
      invalid('scope=total 时 categoryId 必须为 null', 'categoryId');
    }
  } else {
    if (
      typeof input.categoryId !== 'number' ||
      !Number.isSafeInteger(input.categoryId) ||
      input.categoryId <= 0
    ) {
      invalid('scope=category 时必须提供正整数 categoryId', 'categoryId');
    }
    categoryId = input.categoryId;
  }

  if (
    typeof input.amountCents !== 'number' ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0
  ) {
    invalid('amountCents 必须是正整数（分）', 'amountCents');
  }

  return {
    month,
    scope,
    categoryId,
    amountCents: input.amountCents,
    alertThresholds: parseThresholds(input.alertThresholds)
  };
}

function assertCategory(db: Db, categoryId: number | null): BudgetCategory | null {
  if (categoryId === null) {
    return null;
  }
  const category = findBudgetCategory(db, categoryId);
  if (category === null) {
    throw categoryNotFound(categoryId);
  }
  if (category.kind !== 'expense') {
    invalid('预算只支持支出类别', 'categoryId');
  }
  return { id: category.id, name: category.name };
}

function resolveLevel(spentCents: number, amountCents: number): BudgetLevel {
  if (spentCents * 100 >= amountCents * 100) {
    return 'over';
  }
  if (spentCents * 100 >= amountCents * 80) {
    return 'near';
  }
  return 'normal';
}

function toView(
  db: Db,
  userId: string,
  row: BudgetRow,
  start: string,
  end: string,
  category: BudgetCategory | null
): BudgetView {
  const spentCents = sumSpentCents(db, userId, start, end, row.category_id);
  return {
    id: row.id,
    scope: row.scope,
    category,
    amountCents: row.amount_cents,
    spentCents,
    remainingCents: row.amount_cents - spentCents,
    usageRatio: Number((spentCents / row.amount_cents).toFixed(3)),
    level: resolveLevel(spentCents, row.amount_cents),
    alertThresholds: readStoredThresholds(row.alert_thresholds)
  };
}

function triggerAlerts(
  db: Db,
  budgetId: number,
  amountCents: number,
  spentCents: number,
  thresholds: readonly number[],
  now: string
): void {
  for (const threshold of thresholds) {
    if (spentCents * 100 >= amountCents * threshold) {
      insertAlertIfAbsent(db, budgetId, threshold, spentCents, now);
    }
  }
}

/** 查询某月预算执行情况；空月份返回空数组。 */
export function listBudgets(db: Db, userId: string, monthValue: unknown): BudgetView[] {
  const { month, start, end } = parseMonth(monthValue);
  const rows = listBudgetRows(db, userId, month);
  return rows.map((row: BudgetJoinedRow) => {
    const category =
      row.category_id === null || row.category_name === null
        ? null
        : { id: row.category_id, name: row.category_name };
    return toView(db, userId, row, start, end, category);
  });
}

/**
 * 新增或幂等覆盖预算，并在同一事务内维护阈值告警。
 * 保留已存在的旧告警，只删除被移出 alertThresholds 的阈值。
 */
export function upsertBudget(db: Db, userId: string, body: unknown): BudgetView {
  const input = parseBudgetInput(body);
  const category = assertCategory(db, input.categoryId);
  const { start, end } = parseMonth(input.month);
  const now = nowIsoShanghai();

  const write = db.transaction(() => {
    const existing = findBudgetByKey(db, userId, input.month, input.scope, input.categoryId);
    let budgetId: number;
    if (existing === null) {
      budgetId = insertBudget(
        db,
        userId,
        input.month,
        input.scope,
        input.categoryId,
        input.amountCents,
        input.alertThresholds,
        now
      );
    } else {
      budgetId = existing.id;
      updateBudget(db, budgetId, input.amountCents, input.alertThresholds, now);
    }

    deleteAlertsNotIn(db, budgetId, input.alertThresholds);
    const spentCents = sumSpentCents(db, userId, start, end, input.categoryId);
    triggerAlerts(db, budgetId, input.amountCents, spentCents, input.alertThresholds, now);
    return budgetId;
  });

  const budgetId = write();
  const row = findBudgetById(db, userId, budgetId) as BudgetRow;
  return toView(db, userId, row, start, end, category);
}

/** 删除预算；不存在返回 404 BUDGET_NOT_FOUND。 */
export function removeBudget(db: Db, userId: string, idValue: unknown): void {
  if (typeof idValue !== 'string' || !/^\d+$/.test(idValue)) {
    invalid('预算 id 必须是正整数', 'id');
  }
  const id = Number(idValue);
  if (!Number.isSafeInteger(id) || id <= 0) {
    invalid('预算 id 必须是正整数', 'id');
  }
  if (deleteBudget(db, userId, id) === 0) {
    throw new AppError('BUDGET_NOT_FOUND', 404, `预算 ${id} 不存在`, { field: 'id' });
  }
}

/**
 * 账单新增/修改/作废后重算受影响预算的告警。
 * 只补写新触发的告警，不回收已触发记录；由 M2 在写事务内或提交后调用。
 */
export function recalcBudgetForTransaction(
  db: Db,
  userId: string,
  occurredDate: string,
  categoryId: number | null
): void {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(occurredDate);
  if (match === null) {
    return;
  }
  const month = `${match[1]}-${match[2]}`;
  let range: ParsedMonth;
  try {
    range = parseMonth(month);
  } catch {
    return;
  }
  const rows = listBudgetsForRecalc(db, userId, month, categoryId);
  const now = nowIsoShanghai();
  for (const row of rows) {
    const spentCents = sumSpentCents(db, userId, range.start, range.end, row.category_id);
    triggerAlerts(db, row.id, row.amount_cents, spentCents, readStoredThresholds(row.alert_thresholds), now);
  }
}

/** 批量导入后按受影响月份与类别集合重算一次，避免逐条查询。 */
export function recalcBudgetsForMonth(
  db: Db,
  userId: string,
  monthValue: unknown,
  categoryIds: readonly number[]
): void {
  const range = parseMonth(monthValue);
  const rows = listBudgetsForRecalcMany(db, userId, range.month, categoryIds);
  const now = nowIsoShanghai();
  for (const row of rows) {
    const spentCents = sumSpentCents(db, userId, range.start, range.end, row.category_id);
    triggerAlerts(db, row.id, row.amount_cents, spentCents, readStoredThresholds(row.alert_thresholds), now);
  }
}

/**
 * 重算某月全部预算的告警。
 * 用于批量导入：一条批次可能同时产生普通账单、退款/还款和利息记录，
 * 仅凭 RecordResult 无法完整枚举所有受影响类别，按整月重算更稳妥。
 */
export function recalcBudgetsForMonthAll(db: Db, userId: string, monthValue: unknown): void {
  const { month } = parseMonth(monthValue);
  const rows = listBudgetRows(db, userId, month);
  if (rows.length === 0) {
    return;
  }
  const categoryIds = [
    ...new Set(rows.map((row) => row.category_id).filter((id): id is number => id !== null))
  ];
  recalcBudgetsForMonth(db, userId, month, categoryIds);
}

/** 类别迁移后按目标类别涉及的月份重算告警。 */
export function recalcBudgetsForCategory(db: Db, userId: string, categoryId: number): void {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(occurred_date, 1, 7) AS month
         FROM transactions
        WHERE user_id = ? AND category_id = ?`
    )
    .all(userId, categoryId) as Array<{ month: string }>;
  for (const row of rows) {
    recalcBudgetsForMonthAll(db, userId, row.month);
  }
}
