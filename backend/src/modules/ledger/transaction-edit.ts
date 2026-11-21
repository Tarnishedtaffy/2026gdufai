import type { Db } from '../../db/client.ts';
import { AppError } from '../../shared/errors.ts';
import { nowIsoShanghai, toShanghaiDate } from '../../shared/time.ts';

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

interface EditRow {
  id: string;
  direction: 'expense' | 'income';
  amount_cents: number;
  merchant: string | null;
  occurred_at: string;
  category_id: number | null;
  status: string;
  entry_type: string;
}

function invalid(message: string, field: string): never {
  throw new AppError('INVALID_QUERY_PARAM', 422, message, { field });
}

function transactionNotFound(id: string): AppError {
  return new AppError('TRANSACTION_NOT_FOUND', 404, `账单 ${id} 不存在`, { field: 'id' });
}

function findTransaction(db: Db, id: string, userId: string): EditRow | null {
  const row = db
    .prepare(
      `SELECT id, direction, amount_cents, merchant, occurred_at, category_id, status, entry_type
         FROM transactions WHERE id = ? AND user_id = ?`
    )
    .get(id, userId) as EditRow | undefined;
  return row ?? null;
}

function isRealCalendarDate(value: string): boolean {
  const match = ISO_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day, hour, minute, second, , , , offsetHour, offsetMinute] = match;
  const [y, mo, d, h, mi, s] = [year, month, day, hour, minute, second].map((part) =>
    Number(part)
  ) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== mo ||
    date.getUTCDate() !== d
  ) {
    return false;
  }
  if (h > 23 || mi > 59 || s > 59) {
    return false;
  }
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

export interface PatchTransactionInput {
  readonly categoryId?: unknown;
  readonly amountCents?: unknown;
  readonly merchant?: unknown;
  readonly occurredAt?: unknown;
}

const EDITABLE_FIELDS = ['categoryId', 'amountCents', 'merchant', 'occurredAt'] as const;

/** 校验 PATCH body 是普通对象且至少包含一个可编辑字段。 */
function assertEditableBody(input: unknown): asserts input is PatchTransactionInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    invalid('请求体必须是包含可编辑字段的对象', 'body');
  }
  if (!EDITABLE_FIELDS.some((field) => field in (input as Record<string, unknown>))) {
    invalid('至少需要提供 categoryId / amountCents / merchant / occurredAt 之一', 'body');
  }
}

export interface PatchedTransaction {
  readonly id: string;
  readonly direction: 'expense' | 'income';
  readonly amountCents: number;
  readonly merchant: string | null;
  readonly occurredAt: string;
  readonly status: string;
  readonly category: { id: number; name: string; kind: 'expense' | 'income' } | null;
}

/** 修改账单：分类 / 金额 / 商户 / 时间；改分类时同步学习规则。 */
export function patchTransaction(
  db: Db,
  id: string,
  userId: string,
  input: PatchTransactionInput
): PatchedTransaction {
  assertEditableBody(input);
  const current = findTransaction(db, id, userId);
  if (current === null) {
    throw transactionNotFound(id);
  }
  if (current.status !== 'confirmed') {
    invalid('已作废的账单不可修改', 'status');
  }
  if (current.entry_type !== 'normal') {
    invalid('中性记录不允许直接修改', 'entryType');
  }

  let categoryId = current.category_id;
  let direction: 'expense' | 'income' = current.direction;
  let amountCents = current.amount_cents;
  let merchant = current.merchant;
  let occurredAt = current.occurred_at;
  let changedCategory = false;

  if (input.categoryId !== undefined) {
    if (!Number.isInteger(input.categoryId) || (input.categoryId as number) <= 0) {
      invalid('categoryId 必须是正整数', 'categoryId');
    }
    const category = db
      .prepare('SELECT id, kind FROM categories WHERE id = ?')
      .get(input.categoryId as number) as { id: number; kind: 'expense' | 'income' } | undefined;
    if (category === undefined) {
      throw new AppError('CATEGORY_NOT_FOUND', 404, `类别 ${input.categoryId} 不存在`, {
        field: 'categoryId'
      });
    }
    categoryId = category.id;
    direction = category.kind;
    changedCategory = category.id !== current.category_id;
  }

  if (input.amountCents !== undefined) {
    if (!Number.isSafeInteger(input.amountCents) || (input.amountCents as number) <= 0) {
      invalid('amountCents 必须是正整数', 'amountCents');
    }
    amountCents = input.amountCents as number;
  }

  if (input.merchant !== undefined) {
    if (typeof input.merchant !== 'string' || input.merchant.trim() === '') {
      invalid('merchant 必须是非空字符串', 'merchant');
    }
    const trimmedMerchant = input.merchant.trim();
    // 按 Unicode 码点计数，避免 emoji 被算作两个字符。
    if ([...trimmedMerchant].length > 100) {
      invalid('merchant 最长 100 字符', 'merchant');
    }
    merchant = trimmedMerchant;
  }

  if (input.occurredAt !== undefined) {
    if (typeof input.occurredAt !== 'string' || !isRealCalendarDate(input.occurredAt)) {
      invalid('occurredAt 必须是合法日期时间', 'occurredAt');
    }
    occurredAt = input.occurredAt;
  }

  const now = nowIsoShanghai();
  db.transaction(() => {
    const assignments: string[] = [];
    const values: Array<string | number | null> = [];

    if (input.categoryId !== undefined) {
      assignments.push('category_id = ?', 'direction = ?', "direction_source = 'category'", "category_source = 'manual'");
      values.push(categoryId, direction);
    }
    if (input.amountCents !== undefined) {
      assignments.push('amount_cents = ?');
      values.push(amountCents);
    }
    if (input.merchant !== undefined) {
      assignments.push('merchant = ?');
      values.push(merchant);
    }
    if (input.occurredAt !== undefined) {
      assignments.push('occurred_at = ?', 'occurred_date = ?', "time_source = 'explicit'", 'chat_at = NULL');
      values.push(occurredAt, toShanghaiDate(occurredAt));
    }
    assignments.push('updated_at = ?');
    values.push(now, id, userId);

    db.prepare(
      `UPDATE transactions SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...values);

    if (changedCategory && categoryId !== null && merchant !== null && merchant.trim() !== '') {
      db.prepare(
        `INSERT INTO user_category_rules (user_id, pattern, category_id, hit_count, last_used_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(user_id, pattern) DO UPDATE SET
           category_id = excluded.category_id,
           hit_count = hit_count + 1,
           last_used_at = excluded.last_used_at`
      ).run(userId, merchant.trim(), categoryId, now);
    }
  })();

  const row = db
    .prepare(
      `SELECT t.id, t.direction, t.amount_cents, t.merchant, t.occurred_at, t.status,
              c.id AS category_id, c.name AS category_name, c.kind AS category_kind
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?`
    )
    .get(id) as
    | {
        id: string;
        direction: 'expense' | 'income';
        amount_cents: number;
        merchant: string | null;
        occurred_at: string;
        status: string;
        category_id: number | null;
        category_name: string | null;
        category_kind: 'expense' | 'income' | null;
      }
    | undefined;

  if (row === undefined) {
    throw transactionNotFound(id);
  }
  return {
    id: row.id,
    direction: row.direction,
    amountCents: row.amount_cents,
    merchant: row.merchant,
    occurredAt: row.occurred_at,
    status: row.status,
    category:
      row.category_id === null || row.category_name === null || row.category_kind === null
        ? null
        : { id: row.category_id, name: row.category_name, kind: row.category_kind }
  };
}

/** 软作废账单：幂等，重复调用返回当前状态。 */
export function voidTransactionById(db: Db, id: string, userId: string): { id: string; status: 'void' } {
  const current = findTransaction(db, id, userId);
  if (current === null) {
    throw transactionNotFound(id);
  }
  if (current.entry_type !== 'normal') {
    invalid('中性记录不允许直接作废', 'entryType');
  }
  if (current.status !== 'void') {
    db.prepare(
      "UPDATE transactions SET status = 'void', updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(nowIsoShanghai(), id, userId);
  }
  return { id, status: 'void' };
}
