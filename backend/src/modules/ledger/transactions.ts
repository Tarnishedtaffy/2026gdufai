import type { Db } from '../../db/client.ts';
import { AppError } from '../../shared/errors.ts';
import type { Direction } from './types.ts';

export interface TransactionListQuery {
  readonly categoryId?: number;
  readonly from?: string;
  readonly to?: string;
  readonly direction?: 'expense' | 'income';
  readonly limit?: number;
  readonly cursor?: string;
  /** 默认只列正常账单；all 表示包含退款/还款的中性记录。 */
  readonly entryType?: 'normal' | 'refund' | 'repayment' | 'all';
}

export interface TransactionItem {
  id: string;
  direction: Direction;
  amountCents: number;
  merchant: string;
  occurredAt: string;
  occurredDate: string;
  category: { id: number; name: string; color: string; icon: string } | null;
  categoryConfidence: number | null;
  sourceModality: string;
  sourceRef: string | null;
  status: string;
  anomalyFlag: boolean;
  entryType: 'normal' | 'refund' | 'repayment';
  settledAt: string | null;
}

export interface TransactionListResult {
  filter: {
    categoryId: number | null;
    from: string | null;
    to: string | null;
    direction: 'expense' | 'income' | null;
    entryType: 'normal' | 'refund' | 'repayment' | 'all';
  };
  summary: { count: number; expenseCents: number; incomeCents: number };
  items: TransactionItem[];
  page: { limit: number; hasMore: boolean; nextCursor: string | null };
  meta: { unit: 'cent'; isEmpty: boolean };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 100;

/** 校验 YYYY-MM-DD 是真实日历日期，拒绝 2026-02-31 这类会被 Date 滚动的输入。 */
function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function invalid(message: string): never {
  throw new AppError('INVALID_QUERY_PARAM', 422, message);
}

function encodeCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { date: string; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    invalid('cursor 无效');
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0) {
    invalid('cursor 无效');
  }
  const date = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!DATE_RE.test(date) || id === '') {
    invalid('cursor 无效');
  }
  return { date, id };
}

interface ListRow {
  id: string;
  direction: Direction;
  amount_cents: number;
  merchant: string;
  occurred_at: string;
  occurred_date: string;
  category_confidence: number | null;
  source_modality: string;
  source_ref: string | null;
  status: string;
  anomaly_flag: number;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  entry_type: 'normal' | 'refund' | 'repayment';
  settled_at: string | null;
}

/** 按契约 §2.3 返回账单一览：游标分页 + 整个筛选集汇总。 */
export function listTransactions(db: Db, userId: string, query: TransactionListQuery): TransactionListResult {
  const limit = query.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    invalid(`limit 必须是 1–${MAX_LIMIT} 的整数`);
  }
  for (const value of [query.from, query.to]) {
    if (value !== undefined && !isCalendarDate(value)) {
      invalid('from/to 必须是真实日历日期 YYYY-MM-DD');
    }
  }
  if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
    invalid('from 不能晚于 to');
  }

  const filterConditions: string[] = [];
  const filterParams: Array<string | number> = [];
  if (query.categoryId !== undefined) {
    filterConditions.push('t.category_id = ?');
    filterParams.push(query.categoryId);
  }
  if (query.from !== undefined) {
    filterConditions.push('t.occurred_date >= ?');
    filterParams.push(query.from);
  }
  if (query.to !== undefined) {
    filterConditions.push('t.occurred_date <= ?');
    filterParams.push(query.to);
  }
  if (query.direction !== undefined) {
    filterConditions.push('t.direction = ?');
    filterParams.push(query.direction);
  }

  const entryType = query.entryType ?? 'normal';
  const baseConditions = ['t.user_id = ?', "t.status = 'confirmed'", ...filterConditions];
  const baseParams: Array<string | number> = [userId, ...filterParams];
  if (entryType !== 'all') {
    baseConditions.push('t.entry_type = ?');
    baseParams.push(entryType);
  }

  const summaryConditions = [
    't.user_id = ?',
    "t.status = 'confirmed'",
    "t.entry_type = 'normal'",
    ...filterConditions
  ];
  const summaryParams: Array<string | number> = [userId, ...filterParams];
  if (entryType !== 'all' && entryType !== 'normal') {
    // 筛选集与 normal 的交集为空（例如 entryType=refund），summary 计 0。
    summaryConditions.push('t.entry_type = ?');
    summaryParams.push(entryType);
  }

  const conditions = [...baseConditions];
  const params = [...baseParams];
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    conditions.push('(t.occurred_date < ? OR (t.occurred_date = ? AND t.id < ?))');
    params.push(cursor.date, cursor.date, cursor.id);
  }

  const rows = db
    .prepare(
      `SELECT t.id, t.direction, t.amount_cents, t.merchant, t.occurred_at, t.occurred_date,
              t.category_confidence, t.source_modality, t.source_ref, t.status, t.anomaly_flag, t.entry_type,
              t.settled_at,
              c.id AS category_id, c.name AS category_name, c.color AS category_color, c.icon AS category_icon
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.occurred_date DESC, t.id DESC
        LIMIT ?`
    )
    .all(...params, limit + 1) as ListRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  const summaryRow = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN direction = 'expense' THEN amount_cents END), 0) AS expense_cents,
              COALESCE(SUM(CASE WHEN direction = 'income' THEN amount_cents END), 0) AS income_cents
         FROM transactions t
        WHERE ${summaryConditions.join(' AND ')}`
    )
    .get(...summaryParams) as { count: number; expense_cents: number; income_cents: number };

  const items: TransactionItem[] = pageRows.map((row) => ({
    id: row.id,
    direction: row.direction,
    amountCents: row.amount_cents,
    merchant: row.merchant,
    occurredAt: row.occurred_at,
    occurredDate: row.occurred_date,
    category:
      row.category_id === null || row.category_name === null
        ? null
        : {
            id: row.category_id,
            name: row.category_name,
            color: row.category_color ?? '#6B7280',
            icon: row.category_icon ?? ''
          },
    categoryConfidence: row.category_confidence,
    sourceModality: row.source_modality,
    sourceRef: row.source_ref,
    status: row.status,
    anomalyFlag: row.anomaly_flag === 1,
    entryType: row.entry_type,
    settledAt: row.settled_at
  }));

  const anyRow = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM transactions t WHERE ${baseConditions.join(' AND ')}
       ) AS present`
    )
    .get(...baseParams) as { present: number };

  return {
    filter: {
      categoryId: query.categoryId ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      direction: query.direction ?? null,
      entryType
    },
    summary: {
      count: summaryRow.count,
      expenseCents: summaryRow.expense_cents,
      incomeCents: summaryRow.income_cents
    },
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && lastRow !== undefined ? encodeCursor(lastRow.occurred_date, lastRow.id) : null
    },
    meta: { unit: 'cent', isEmpty: anyRow.present === 0 }
  };
}
