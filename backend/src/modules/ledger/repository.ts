import type { Db } from '../../db/client.ts';
import { nowIsoShanghai } from '../../shared/time.ts';
import type { CategoryRow, Direction, UserCategoryRule } from './types.ts';

interface CategoryDbRow {
  id: number;
  name: string;
  kind: Direction;
  keywords: string;
  is_preset: number;
}

interface RuleDbRow {
  pattern: string;
  category_id: number;
}

/** 读取启用中的类别字典，供分类引擎匹配。 */
export function listCategories(db: Db): CategoryRow[] {
  const rows = db
    .prepare(
      'SELECT id, name, kind, keywords, is_preset FROM categories WHERE is_active = 1 ORDER BY sort_order, id'
    )
    .all() as CategoryDbRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    keywords: JSON.parse(row.keywords) as string[],
    isPreset: row.is_preset === 1
  }));
}

/** 读取某用户的历史修正规则。 */
export function listUserRules(db: Db, userId: string): UserCategoryRule[] {
  const rows = db
    .prepare('SELECT pattern, category_id FROM user_category_rules WHERE user_id = ?')
    .all(userId) as RuleDbRow[];

  return rows.map((row) => ({ pattern: row.pattern, categoryId: row.category_id }));
}

export interface StoredFeedback {
  readonly field: string | null;
  readonly code: string;
  readonly severity: 'blocking' | 'warning';
}

export interface IntakeRow {
  readonly status: 'confirmed' | 'pending_followup' | 'rejected' | 'duplicate';
  readonly followupRound: number;
  readonly transactionId: string | null;
  /** 完整 feedback（field/code/severity）；旧数据只存 code 时按 blocking/null 兜底。 */
  readonly feedback: StoredFeedback[];
}

export interface TransactionInput {
  readonly id: string;
  readonly userId: string;
  readonly direction: Direction;
  readonly directionSource: 'explicit' | 'category';
  readonly amountCents: number;
  readonly merchant: string;
  readonly note: string;
  readonly occurredAt: string;
  readonly occurredDate: string;
  readonly timeSource: 'explicit' | 'chat_time';
  readonly chatAt: string | null;
  readonly categoryId: number | null;
  readonly categorySource: string;
  readonly categoryConfidence: number;
  readonly sourceModality: string;
  readonly sourceRef: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly entryType: 'normal' | 'refund' | 'repayment';
  readonly matchedTransactionId: string | null;
  /** 还款本金（分）；非还款记录为 null。 */
  readonly principalCents: number | null;
  /** 原贷款结清时间；仅原贷款可能非空。 */
  readonly settledAt: string | null;
}

export interface TransactionView {
  readonly direction: Direction;
  readonly occurredAt: string;
  readonly category: { id: number; name: string; kind: Direction } | null;
  readonly matchedTransactionId: string | null;
}

/** 查询幂等键对应的入站记录。 */
export function findIntake(db: Db, idempotencyKey: string): IntakeRow | null {
  const row = db
    .prepare(
      'SELECT status, followup_round, transaction_id, last_codes FROM intake_log WHERE idempotency_key = ?'
    )
    .get(idempotencyKey) as
    | { status: IntakeRow['status']; followup_round: number; transaction_id: string | null; last_codes: string }
    | undefined;

  if (row === undefined) {
    return null;
  }
  const raw = JSON.parse(row.last_codes) as Array<string | StoredFeedback>;
  return {
    status: row.status,
    followupRound: row.followup_round,
    transactionId: row.transaction_id,
    feedback: raw.map((item) =>
      typeof item === 'string'
        ? { field: null, code: item, severity: 'blocking' as const }
        : { field: item.field ?? null, code: item.code, severity: item.severity ?? 'blocking' }
    )
  };
}

/** 写入或更新入站记录，轮次与状态用于跨进程的追问控制。 */
export function saveIntake(
  db: Db,
  input: {
    idempotencyKey: string;
    recordId: string;
    batchId: string;
    status: IntakeRow['status'];
    followupRound: number;
    transactionId: string | null;
    feedback: StoredFeedback[];
  }
): void {
  const now = nowIsoShanghai();
  db.prepare(
    `INSERT INTO intake_log
       (idempotency_key, record_id, batch_id, status, followup_round, transaction_id, last_codes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET
       status = excluded.status,
       followup_round = excluded.followup_round,
       transaction_id = excluded.transaction_id,
       last_codes = excluded.last_codes,
       updated_at = excluded.updated_at`
  ).run(
    input.idempotencyKey,
    input.recordId,
    input.batchId,
    input.status,
    input.followupRound,
    input.transactionId,
    JSON.stringify(input.feedback),
    now,
    now
  );
}

/** 写入一笔已确认的账单。 */
export function insertTransaction(db: Db, input: TransactionInput): void {
  db.prepare(
    `INSERT INTO transactions
       (id, user_id, direction, direction_source, amount_cents, merchant, note,
        occurred_at, occurred_date, time_source, chat_at, category_id, category_source,
        category_confidence, status, source_modality, source_ref, idempotency_key, created_at, updated_at,
        entry_type, matched_transaction_id, principal_cents, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.userId,
    input.direction,
    input.directionSource,
    input.amountCents,
    input.merchant,
    input.note,
    input.occurredAt,
    input.occurredDate,
    input.timeSource,
    input.chatAt,
    input.categoryId,
    input.categorySource,
    input.categoryConfidence,
    input.sourceModality,
    input.sourceRef,
    input.idempotencyKey,
    input.createdAt,
    input.updatedAt,
    input.entryType,
    input.matchedTransactionId,
    input.principalCents,
    input.settledAt
  );
}

/** 按幂等键读取已落库的账单，用于唯一冲突自愈。 */
export function findTransactionByIdempotencyKey(
  db: Db,
  idempotencyKey: string
): (TransactionView & { id: string }) | null {
  const row = db
    .prepare(
      `SELECT t.id, t.direction, t.occurred_at, t.matched_transaction_id,
              c.id AS category_id, c.name AS category_name, c.kind AS category_kind
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.idempotency_key = ?`
    )
    .get(idempotencyKey) as
    | {
        id: string;
        direction: Direction;
        occurred_at: string;
        matched_transaction_id: string | null;
        category_id: number | null;
        category_name: string | null;
        category_kind: Direction | null;
      }
    | undefined;

  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    direction: row.direction,
    occurredAt: row.occurred_at,
    matchedTransactionId: row.matched_transaction_id,
    category:
      row.category_id === null || row.category_name === null || row.category_kind === null
        ? null
        : { id: row.category_id, name: row.category_name, kind: row.category_kind }
  };
}

export interface OriginalTransaction {
  readonly id: string;
  readonly occurredAt: string;
  readonly direction: Direction;
  readonly amountCents: number;
  readonly entryType: string;
  readonly settledAt: string | null;
}

/**
 * 作废原账单（软删除，统计排除）。
 *
 * 仅供 intake 内部退款/还款流程调用：只把 `status='confirmed'` 的记录置为 `void`，
 * 不校验 `entry_type`，也不返回 404/422。外部 API 的作废请走
 * `transaction-edit.ts` 的 `voidTransactionById`（含幂等与错误码）。
 */
export function voidTransaction(db: Db, id: string, userId: string, updatedAt: string): void {
  db.prepare(
    "UPDATE transactions SET status = 'void', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'confirmed'"
  ).run(updatedAt, id, userId);
}

/** 调整原账单金额（部分退款/部分还款时把原单金额改为剩余金额）。 */
export function adjustTransactionAmount(
  db: Db,
  id: string,
  userId: string,
  amountCents: number,
  updatedAt: string
): void {
  db.prepare(
    "UPDATE transactions SET amount_cents = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'confirmed'"
  ).run(amountCents, updatedAt, id, userId);
}

/** 按 id 读取用户自己的原账单，用于退款/还款匹配。 */
export function getTransactionById(db: Db, id: string, userId: string): OriginalTransaction | null {
  const row = db
    .prepare(
      'SELECT id, occurred_at, direction, amount_cents, entry_type, settled_at FROM transactions WHERE id = ? AND user_id = ? AND status != ?'
    )
    .get(id, userId, 'void') as
    | {
        id: string;
        occurred_at: string;
        direction: Direction;
        amount_cents: number;
        entry_type: string;
        settled_at: string | null;
      }
    | undefined;

  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    direction: row.direction,
    amountCents: row.amount_cents,
    entryType: row.entry_type,
    settledAt: row.settled_at
  };
}

/** 统计某笔原贷款已归还的本金合计（只计有效的中性还款记录）。 */
export function sumRepaidPrincipal(db: Db, originalTransactionId: string, userId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(principal_cents), 0) AS total
         FROM transactions
        WHERE matched_transaction_id = ? AND user_id = ?
          AND entry_type = 'repayment' AND status = 'confirmed'`
    )
    .get(originalTransactionId, userId) as { total: number };
  return row.total;
}

/** 标记原贷款已结清（保留原单金额不变）。 */
export function settleLoan(db: Db, id: string, userId: string, settledAt: string): void {
  db.prepare(
    "UPDATE transactions SET settled_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'confirmed'"
  ).run(settledAt, settledAt, id, userId);
}

/** 按 id 读取账单视图，用于幂等重复时回显已有结果。 */
export function getTransactionView(db: Db, transactionId: string): TransactionView | null {
  const row = db
    .prepare(
      `SELECT t.direction, t.occurred_at, t.matched_transaction_id,
              c.id AS category_id, c.name AS category_name, c.kind AS category_kind
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?`
    )
    .get(transactionId) as
    | {
        direction: Direction;
        occurred_at: string;
        matched_transaction_id: string | null;
        category_id: number | null;
        category_name: string | null;
        category_kind: Direction | null;
      }
    | undefined;

  if (row === undefined) {
    return null;
  }
  return {
    direction: row.direction,
    occurredAt: row.occurred_at,
    matchedTransactionId: row.matched_transaction_id,
    category:
      row.category_id === null || row.category_name === null || row.category_kind === null
        ? null
        : { id: row.category_id, name: row.category_name, kind: row.category_kind }
  };
}

export interface CategoryItem {
  readonly id: number;
  readonly name: string;
  readonly kind: Direction;
  readonly color: string;
  readonly icon: string;
  readonly isPreset: boolean;
  readonly isActive: boolean;
}

/** 类别字典（契约 §2.4），包含停用类别以便前端展示历史账单。 */
export function listCategoryItems(db: Db): CategoryItem[] {
  const rows = db
    .prepare(
      'SELECT id, name, kind, color, icon, is_preset, is_active FROM categories ORDER BY sort_order, id'
    )
    .all() as Array<{
    id: number;
    name: string;
    kind: Direction;
    color: string;
    icon: string;
    is_preset: number;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    icon: row.icon,
    isPreset: row.is_preset === 1,
    isActive: row.is_active === 1
  }));
}
