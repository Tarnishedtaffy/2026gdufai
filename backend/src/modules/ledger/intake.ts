import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.ts';
import { invalidBatch } from '../../shared/errors.ts';
import { yuanToCents } from '../../shared/money.ts';
import { nowIsoShanghai, toShanghaiDate } from '../../shared/time.ts';
import { classify } from './classifier.ts';
import { detectSpecialEntry, type SpecialEntry } from './intent.ts';
import {
  adjustTransactionAmount,
  findIntake,
  findTransactionByIdempotencyKey,
  getTransactionById,
  getTransactionView,
  insertTransaction,
  listCategories,
  listUserRules,
  saveIntake,
  settleLoan,
  sumRepaidPrincipal,
  voidTransaction,
  type OriginalTransaction
} from './repository.ts';
import type { CategoryRow, Direction, RawBatch, RawRecord } from './types.ts';

/** 契约 §1.5 登记的反馈码。 */
export type FeedbackCode =
  | 'MISSING_AMOUNT'
  | 'MISSING_TIME'
  | 'FUTURE_TIME'
  | 'MISSING_DIRECTION'
  | 'MISSING_ORIGINAL_TRANSACTION'
  | 'ORIGINAL_NOT_FOUND'
  | 'ORIGINAL_AMOUNT_ADJUSTED'
  | 'REFUND_EXCESS_AS_INCOME'
  | 'REPAYMENT_EXCESS_AS_EXPENSE'
  | 'CATEGORY_KIND_MISMATCH'
  | 'LOW_CONFIDENCE_CATEGORY'
  | 'MERCHANT_DEFAULTED'
  | 'TIME_DEFAULTED_TO_CHAT_TIME'
  | 'DIRECTION_FORCED_BY_CATEGORY'
  | 'DUPLICATE_RECORD'
  | 'REFUND_RECORDED_NEUTRAL'
  | 'REPAYMENT_RECORDED_NEUTRAL'
  | 'ORIGINAL_NOT_FOUND_RECORDED'
  | 'ORIGINAL_TRANSACTION_AGED'
  | 'PARTIAL_REPAYMENT_RECORDED'
  | 'AMBIGUOUS_LOAN_PAYMENT'
  | 'ORIGINAL_ALREADY_SETTLED';

export type FeedbackSeverity = 'blocking' | 'warning';

export interface FeedbackItem {
  readonly field: string | null;
  readonly code: FeedbackCode;
  readonly severity: FeedbackSeverity;
}

export interface RecordResult {
  readonly recordId: string;
  readonly status: 'confirmed' | 'pending_followup' | 'duplicate' | 'rejected';
  readonly transactionId: string | null;
  readonly direction: Direction;
  readonly occurredAt: string | null;
  readonly category: { id: number; name: string; kind: Direction } | null;
  readonly confidence: number | null;
  /** 退款/还款匹配到的原账单 id；未匹配为 null。 */
  readonly matchedTransactionId: string | null;
  /** 本次还款产生的利息记录 id；无利息为 null。 */
  readonly interestTransactionId: string | null;
  readonly feedback: FeedbackItem[];
}

export interface BatchResult {
  readonly batchId: string;
  readonly results: RecordResult[];
}

/** 追问超过该轮次仍未解决则放弃（第 3 次提交转 rejected）。 */
export const MAX_FOLLOWUP_ROUNDS = 2;
/** 分类置信度低于该值时提示用户确认。 */
const LOW_CONFIDENCE_THRESHOLD = 0.75;
/** 商户缺失时的默认值，契约 §1.5 MERCHANT_DEFAULTED。 */
const DEFAULT_MERCHANT = '未知账号';
/** 原账单距今超过该天数时提示 ORIGINAL_TRANSACTION_AGED（契约 §1.8）。 */
const AGED_MATCH_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function blocking(field: string | null, code: FeedbackCode): FeedbackItem {
  return { field, code, severity: 'blocking' };
}

function warning(field: string | null, code: FeedbackCode): FeedbackItem {
  return { field, code, severity: 'warning' };
}

function toView(category: CategoryRow | null): RecordResult['category'] {
  return category === null ? null : { id: category.id, name: category.name, kind: category.kind };
}

/** 按方向选兜底类别：支出取「其他」，收入取「其他收入」。 */
function fallbackCategory(categories: readonly CategoryRow[], direction: Direction | null): CategoryRow | null {
  const kind: Direction = direction ?? 'expense';
  const name = kind === 'expense' ? '其他' : '其他收入';
  return categories.find((item) => item.kind === kind && item.name === name) ?? null;
}

/** 未来时间容差：与契约 §1.5 一致，5 分钟。 */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function isFuture(iso: string, now: Date): boolean {
  return Date.parse(iso) > now.getTime() + FUTURE_TOLERANCE_MS;
}

/** 判断是否为幂等键唯一冲突（SQLite 错误码）。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

function rejectedResult(record: RawRecord, codes: FeedbackItem[]): RecordResult {
  return {
    recordId: record.recordId,
    status: 'rejected',
    transactionId: null,
    direction: record.direction ?? 'expense',
    occurredAt: null,
    category: null,
    confidence: null,
    matchedTransactionId: null,
    interestTransactionId: null,
    feedback: codes
  };
}

function persistPending(
  db: Db,
  batch: RawBatch,
  record: RawRecord,
  round: number,
  feedback: FeedbackItem[],
  rejected = false
): RecordResult {
  saveIntake(db, {
    idempotencyKey: record.idempotencyKey,
    recordId: record.recordId,
    batchId: batch.batchId,
    status: rejected ? 'rejected' : 'pending_followup',
    followupRound: round,
    transactionId: null,
    feedback
  });
  return rejected
    ? rejectedResult(record, feedback)
    : {
        recordId: record.recordId,
        status: 'pending_followup',
        transactionId: null,
        direction: record.direction ?? 'expense',
        occurredAt: record.occurredAt,
        category: null,
        confidence: null,
        matchedTransactionId: null,
        interestTransactionId: null,
        feedback
      };
}

interface ResolvedSpecial {
  amountCents: number;
  occurredAt: string;
  direction: Direction;
  category: CategoryRow | null;
  timeSource: 'explicit' | 'chat_time';
  chatAt: string | null;
}

/** 写入退款/还款记录；事务由调用方统一控制。 */
function persistSpecialEntry(
  db: Db,
  batch: RawBatch,
  record: RawRecord,
  round: number,
  resolved: ResolvedSpecial,
  extraFeedback: FeedbackItem[],
  matchedTransactionId: string | null,
  entryType: 'normal' | 'refund' | 'repayment',
  principalCents: number | null
): RecordResult {
  const direction = resolved.direction;
  const category = resolved.category;
  const merchant = record.merchant?.trim() === '' || record.merchant === null ? DEFAULT_MERCHANT : record.merchant;
  const feedback = [...extraFeedback];
  if (merchant === DEFAULT_MERCHANT) {
    feedback.push(warning('merchant', 'MERCHANT_DEFAULTED'));
  }

  const transactionId = `tx_${randomUUID()}`;
  const nowIso = nowIsoShanghai();

  insertTransaction(db, {
    id: transactionId,
    userId: record.userId,
    direction,
    directionSource: 'category',
    amountCents: resolved.amountCents,
    merchant,
    note: record.rawText,
    occurredAt: resolved.occurredAt,
    occurredDate: toShanghaiDate(resolved.occurredAt),
    timeSource: resolved.timeSource,
    chatAt: resolved.chatAt,
    categoryId: category?.id ?? null,
    categorySource: 'fallback',
    categoryConfidence: 0.3,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    idempotencyKey: record.idempotencyKey,
    createdAt: nowIso,
    updatedAt: nowIso,
    entryType,
    matchedTransactionId,
    principalCents,
    settledAt: null
  });

  saveIntake(db, {
    idempotencyKey: record.idempotencyKey,
    recordId: record.recordId,
    batchId: batch.batchId,
    status: 'confirmed',
    followupRound: round,
    transactionId,
    feedback
  });

  return {
    recordId: record.recordId,
    status: 'confirmed',
    transactionId,
    direction,
    occurredAt: resolved.occurredAt,
    category: toView(category),
    confidence: 0.3,
    matchedTransactionId,
    interestTransactionId: null,
    feedback
  };
}

/** 超额部分按普通收入/支出入账（部分退款、带息还款）。 */
function insertExcessEntry(
  db: Db,
  record: RawRecord,
  resolved: ResolvedSpecial,
  direction: Direction,
  category: CategoryRow | null,
  amountCents: number,
  matchedTransactionId: string
): void {
  const nowIso = nowIsoShanghai();
  insertTransaction(db, {
    id: `tx_${randomUUID()}`,
    userId: record.userId,
    direction,
    directionSource: 'category',
    amountCents,
    merchant: record.merchant?.trim() === '' || record.merchant === null ? DEFAULT_MERCHANT : record.merchant,
    note: record.rawText,
    occurredAt: resolved.occurredAt,
    occurredDate: toShanghaiDate(resolved.occurredAt),
    timeSource: resolved.timeSource,
    chatAt: resolved.chatAt,
    categoryId: category?.id ?? null,
    categorySource: 'fallback',
    categoryConfidence: 0.3,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    idempotencyKey: `${record.idempotencyKey}#excess`,
    createdAt: nowIso,
    updatedAt: nowIso,
    entryType: 'normal',
    matchedTransactionId,
    principalCents: null,
    settledAt: null
  });
}

/** 原账单匹配结果，契约 §1.8。 */
type OriginalResolution =
  | { readonly status: 'ok'; readonly original: OriginalTransaction; readonly aged: boolean }
  | { readonly status: 'not_found' }
  | { readonly status: 'settled' };

/** 按契约 §1.8 解析显式原账单：未来/不存在/跨用户/已作废 → not_found；已结清单独区分。 */
function resolveOriginal(db: Db, record: RawRecord, now: Date): OriginalResolution {
  if (record.originalTransactionId === null) {
    return { status: 'not_found' };
  }
  const original = getTransactionById(db, record.originalTransactionId, record.userId);
  if (original === null || original.entryType !== 'normal') {
    return { status: 'not_found' };
  }
  if (Date.parse(original.occurredAt) > now.getTime()) {
    return { status: 'not_found' };
  }
  if (original.settledAt !== null) {
    return { status: 'settled' };
  }
  const aged = now.getTime() - Date.parse(original.occurredAt) > AGED_MATCH_DAYS * DAY_MS;
  return { status: 'ok', original, aged };
}

/** 退款/还款兜底类别：收入取「其他收入」，支出取「其他」。 */
function specialFallbackCategory(
  categories: readonly CategoryRow[],
  direction: Direction
): CategoryRow | null {
  const name = direction === 'income' ? '其他收入' : '其他';
  return (
    categories.find((item) => item.kind === direction && item.name === name) ??
    fallbackCategory(categories, direction)
  );
}

/** 利息记录：类别 13 的普通支出，独立幂等键 `${idempotencyKey}#interest`。 */
function insertInterestEntry(
  db: Db,
  record: RawRecord,
  resolved: Omit<ResolvedSpecial, 'direction' | 'category'>,
  amountCents: number,
  loanId: string | null,
  categories: CategoryRow[]
): string {
  const nowIso = nowIsoShanghai();
  const interestCategory =
    categories.find((item) => item.id === 13 && item.kind === 'expense') ??
    specialFallbackCategory(categories, 'expense');
  const id = `tx_${randomUUID()}`;
  insertTransaction(db, {
    id,
    userId: record.userId,
    direction: 'expense',
    directionSource: 'category',
    amountCents,
    merchant:
      record.merchant?.trim() === '' || record.merchant === null ? DEFAULT_MERCHANT : record.merchant,
    note: record.rawText,
    occurredAt: resolved.occurredAt,
    occurredDate: toShanghaiDate(resolved.occurredAt),
    timeSource: resolved.timeSource,
    chatAt: resolved.chatAt,
    categoryId: interestCategory?.id ?? null,
    categorySource: 'fallback',
    categoryConfidence: 0.3,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    idempotencyKey: `${record.idempotencyKey}#interest`,
    createdAt: nowIso,
    updatedAt: nowIso,
    entryType: 'normal',
    matchedTransactionId: loanId,
    principalCents: null,
    settledAt: null
  });
  return id;
}

/** 未匹配到原账单时的兜底：中性记录 + 可能存在的利息记录，均不计收支。 */
function persistUnmatchedSpecial(
  db: Db,
  batch: RawBatch,
  record: RawRecord,
  round: number,
  kind: SpecialEntry,
  resolved: Omit<ResolvedSpecial, 'direction' | 'category'>,
  timeFeedback: FeedbackItem[],
  categories: CategoryRow[]
): RecordResult {
  const direction: Direction = kind === 'refund' ? 'income' : 'expense';
  const category = specialFallbackCategory(categories, direction);
  const principalCents = kind === 'repayment' ? (record.principalCents ?? resolved.amountCents) : null;
  let result: RecordResult | undefined;
  db.transaction(() => {
    const neutral = persistSpecialEntry(
      db,
      batch,
      record,
      round,
      { ...resolved, direction, category },
      [...timeFeedback, warning('originalTransactionId', 'ORIGINAL_NOT_FOUND_RECORDED')],
      null,
      kind,
      principalCents
    );
    const interestCents = kind === 'repayment' ? (record.interestCents ?? 0) : 0;
    if (interestCents > 0) {
      const interestId = insertInterestEntry(db, record, resolved, interestCents, null, categories);
      result = { ...neutral, interestTransactionId: interestId };
    } else {
      result = neutral;
    }
  })();
  if (result !== undefined) {
    return result;
  }
  throw new Error('persistUnmatchedSpecial 未返回结果');
}

/** 退款：显式原单匹配（1D），保持 v1.4 三态；未匹配时首轮追问、次轮兜底。 */
function handleRefund(
  db: Db,
  batch: RawBatch,
  record: RawRecord,
  round: number,
  resolved: Omit<ResolvedSpecial, 'direction' | 'category'>,
  timeFeedback: FeedbackItem[],
  now: Date,
  categories: CategoryRow[],
  askedOriginal: boolean
): RecordResult {
  const resolution = resolveOriginal(db, record, now);

  if (resolution.status !== 'ok') {
    if (!askedOriginal) {
      const code =
        record.originalTransactionId === null
          ? 'MISSING_ORIGINAL_TRANSACTION'
          : resolution.status === 'settled'
            ? 'ORIGINAL_ALREADY_SETTLED'
            : 'ORIGINAL_NOT_FOUND';
      return persistPending(db, batch, record, round, [
        ...timeFeedback,
        blocking('originalTransactionId', code)
      ]);
    }
    // 已结清算硬错误，不兜底成中性退款；不存在/已作废按契约兜底。
    if (resolution.status === 'settled') {
      return persistPending(
        db,
        batch,
        record,
        round,
        [...timeFeedback, blocking('originalTransactionId', 'ORIGINAL_ALREADY_SETTLED')],
        round >= MAX_FOLLOWUP_ROUNDS
      );
    }
    return persistUnmatchedSpecial(db, batch, record, round, 'refund', resolved, timeFeedback, categories);
  }

  // 走到这里说明原单存在且未结清；退款原单不是贷款，settled 分支不会触发。
  const original = resolution.original;
  const diff = resolved.amountCents - original.amountCents;
  const feedback = [...timeFeedback];
  if (resolution.aged) {
    feedback.push(warning('originalTransactionId', 'ORIGINAL_TRANSACTION_AGED'));
  }
  let result: RecordResult | undefined;

  db.transaction(() => {
    if (diff === 0) {
      voidTransaction(db, original.id, record.userId, nowIsoShanghai());
      feedback.push(warning('originalTransactionId', 'REFUND_RECORDED_NEUTRAL'));
    } else if (diff < 0) {
      adjustTransactionAmount(
        db,
        original.id,
        record.userId,
        original.amountCents - resolved.amountCents,
        nowIsoShanghai()
      );
      feedback.push(warning('originalTransactionId', 'ORIGINAL_AMOUNT_ADJUSTED'));
    } else {
      voidTransaction(db, original.id, record.userId, nowIsoShanghai());
      feedback.push(warning('originalTransactionId', 'REFUND_EXCESS_AS_INCOME'));
    }

    result = persistSpecialEntry(
      db,
      batch,
      record,
      round,
      { ...resolved, direction: 'income', category: specialFallbackCategory(categories, 'income') },
      feedback,
      original.id,
      'refund',
      null
    );

    if (diff > 0) {
      const excessCategory = specialFallbackCategory(categories, 'income');
      insertExcessEntry(
        db,
        record,
        { ...resolved, direction: 'income', category: excessCategory },
        'income',
        excessCategory,
        diff,
        original.id
      );
    }
  })();

  if (result !== undefined) {
    return result;
  }
  throw new Error('persistSpecialEntry 未返回结果');
}

/**
 * 贷款还款（契约 §3）：保留原单，按本金累计计算剩余本金，结清时写 `settled_at`。
 * 利息只生成类别 13 的普通支出，不参与剩余本金与结清判断。
 */
function handleRepayment(
  db: Db,
  batch: RawBatch,
  record: RawRecord,
  recordIndex: number,
  round: number,
  resolved: Omit<ResolvedSpecial, 'direction' | 'category'>,
  timeFeedback: FeedbackItem[],
  now: Date,
  categories: CategoryRow[],
  askedOriginal: boolean
): RecordResult {
  const part = record.repaymentPart;
  const effectivePrincipal =
    record.principalCents ?? (part === 'interest' ? 0 : resolved.amountCents);
  const interestCents =
    record.interestCents ?? (part === 'interest' ? resolved.amountCents : 0);

  // 纯利息：不进入中性还款流程，只生成类别 13 的普通支出。
  if (effectivePrincipal === 0) {
    let result: RecordResult | undefined;
    db.transaction(() => {
      const interestId = insertInterestEntry(db, record, resolved, interestCents, null, categories);
      const feedback = [...timeFeedback];
      if (record.merchant?.trim() === '' || record.merchant === null) {
        feedback.push(warning('merchant', 'MERCHANT_DEFAULTED'));
      }
      saveIntake(db, {
        idempotencyKey: record.idempotencyKey,
        recordId: record.recordId,
        batchId: batch.batchId,
        status: 'confirmed',
        followupRound: round,
        transactionId: interestId,
        feedback
      });
      const interestCategory = categories.find((item) => item.id === 13 && item.kind === 'expense') ?? null;
      result = {
        recordId: record.recordId,
        status: 'confirmed',
        transactionId: interestId,
        direction: 'expense',
        occurredAt: resolved.occurredAt,
        category: toView(interestCategory),
        confidence: 0.3,
        matchedTransactionId: null,
        interestTransactionId: interestId,
        feedback
      };
    })();
    if (result !== undefined) {
      return result;
    }
    throw new Error('纯利息记录未返回结果');
  }

  const resolution = resolveOriginal(db, record, now);
  if (resolution.status !== 'ok') {
    if (!askedOriginal) {
      const code =
        record.originalTransactionId === null
          ? 'MISSING_ORIGINAL_TRANSACTION'
          : resolution.status === 'settled'
            ? 'ORIGINAL_ALREADY_SETTLED'
            : 'ORIGINAL_NOT_FOUND';
      return persistPending(db, batch, record, round, [
        ...timeFeedback,
        blocking('originalTransactionId', code)
      ]);
    }
    if (resolution.status === 'settled') {
      return persistPending(
        db,
        batch,
        record,
        round,
        [...timeFeedback, blocking('originalTransactionId', 'ORIGINAL_ALREADY_SETTLED')],
        round >= MAX_FOLLOWUP_ROUNDS
      );
    }
    return persistUnmatchedSpecial(db, batch, record, round, 'repayment', resolved, timeFeedback, categories);
  }

  const original = resolution.original;
  const outstanding = original.amountCents - sumRepaidPrincipal(db, original.id, record.userId);

  // 判断顺序：先判未拆分超额（无法区分本金/利息），再判显式本金超额。
  if (record.principalCents === null && resolved.amountCents > outstanding) {
    return persistPending(
      db,
      batch,
      record,
      round,
      [...timeFeedback, blocking('principalCents', 'AMBIGUOUS_LOAN_PAYMENT')],
      round >= MAX_FOLLOWUP_ROUNDS
    );
  }
  if (record.principalCents !== null && record.principalCents > outstanding) {
    throw invalidBatch(
      `records[${recordIndex}].principalCents 不能超过贷款剩余本金`,
      `records[${recordIndex}].principalCents`
    );
  }

  const diff = effectivePrincipal - outstanding;
  if (diff > 0) {
    throw invalidBatch(
      `records[${recordIndex}].principalCents 不能超过贷款剩余本金`,
      `records[${recordIndex}].principalCents`
    );
  }

  const feedback = [...timeFeedback];
  if (resolution.aged) {
    feedback.push(warning('originalTransactionId', 'ORIGINAL_TRANSACTION_AGED'));
  }
  feedback.push(
    warning(
      'originalTransactionId',
      diff === 0 ? 'REPAYMENT_RECORDED_NEUTRAL' : 'PARTIAL_REPAYMENT_RECORDED'
    )
  );

  let result: RecordResult | undefined;
  db.transaction(() => {
    if (diff === 0) {
      settleLoan(db, original.id, record.userId, nowIsoShanghai());
    }
    const neutral = persistSpecialEntry(
      db,
      batch,
      record,
      round,
      { ...resolved, direction: 'expense', category: specialFallbackCategory(categories, 'expense') },
      feedback,
      original.id,
      'repayment',
      effectivePrincipal
    );
    if (interestCents > 0) {
      const interestId = insertInterestEntry(db, record, resolved, interestCents, original.id, categories);
      result = { ...neutral, interestTransactionId: interestId };
    } else {
      result = neutral;
    }
  })();
  if (result !== undefined) {
    return result;
  }
  throw new Error('persistSpecialEntry 未返回结果');
}

function processRecord(
  db: Db,
  batch: RawBatch,
  record: RawRecord,
  recordIndex: number,
  categories: CategoryRow[]
): RecordResult {
  const existing = findIntake(db, record.idempotencyKey);
  const round = existing === null ? 0 : existing.followupRound + 1;

  if (existing !== null && (existing.status === 'confirmed' || existing.status === 'duplicate')) {
    const view = existing.transactionId === null ? null : getTransactionView(db, existing.transactionId);
    return {
      recordId: record.recordId,
      status: 'duplicate',
      transactionId: existing.transactionId,
      direction: view?.direction ?? record.direction ?? 'expense',
      occurredAt: view?.occurredAt ?? null,
      category: view?.category ?? null,
      confidence: null,
      matchedTransactionId: view?.matchedTransactionId ?? null,
      interestTransactionId: findInterestTransactionId(db, record.idempotencyKey),
      feedback: [warning(null, 'DUPLICATE_RECORD')]
    };
  }

  if (existing !== null && existing.status === 'rejected') {
    return rejectedResult(
      record,
      existing.feedback.map((item) => ({
        field: item.field,
        code: item.code as FeedbackCode,
        severity: item.severity
      }))
    );
  }

  // 追问轮次用尽后不再反复询问，直接放弃，避免死循环。
  if (round > MAX_FOLLOWUP_ROUNDS) {
    return persistPending(db, batch, record, round, [blocking(null, 'MISSING_AMOUNT')], true);
  }

  // 金额缺失或非正数：必须追问，绝不猜。
  if (record.amount === null || record.amount <= 0) {
    const feedback = [blocking('amount', 'MISSING_AMOUNT')];
    return persistPending(db, batch, record, round, feedback, round >= MAX_FOLLOWUP_ROUNDS);
  }

  // 时间：缺失或在未来先追问；第二轮起回退到聊天时间。
  const now = new Date();
  let occurredAt = record.occurredAt;
  let timeSource: 'explicit' | 'chat_time' = 'explicit';
  let chatAt: string | null = null;
  const timeFeedback: FeedbackItem[] = [];

  if (occurredAt === null) {
    if (round === 0) {
      return persistPending(db, batch, record, round, [blocking('occurredAt', 'MISSING_TIME')]);
    }
    chatAt = record.chatAt ?? batch.sentAt;
    occurredAt = chatAt;
    timeSource = 'chat_time';
    timeFeedback.push(warning('occurredAt', 'TIME_DEFAULTED_TO_CHAT_TIME'));
  } else if (isFuture(occurredAt, now)) {
    if (round === 0) {
      return persistPending(db, batch, record, round, [blocking('occurredAt', 'FUTURE_TIME')]);
    }
    chatAt = record.chatAt ?? batch.sentAt;
    occurredAt = chatAt;
    timeSource = 'chat_time';
    timeFeedback.push(warning('occurredAt', 'TIME_DEFAULTED_TO_CHAT_TIME'));
  }

  const amountCents = yuanToCents(record.amount);

  // 退款/还款：保留记录但不计入收支。显式拆分子段视为还款声明，优先于文本识别。
  const special = detectSpecialEntry(record.rawText);
  const declaredRepayment =
    record.repaymentPart !== null || record.principalCents !== null || record.interestCents !== null;
  const kind: SpecialEntry | null = declaredRepayment ? 'repayment' : special;
  if (kind !== null) {
    const askedOriginal =
      existing?.feedback.some(
        (item) =>
          item.code === 'MISSING_ORIGINAL_TRANSACTION' ||
          item.code === 'ORIGINAL_NOT_FOUND' ||
          item.code === 'ORIGINAL_ALREADY_SETTLED'
      ) ?? false;
    const resolved = { amountCents, occurredAt, timeSource, chatAt };
    return kind === 'refund'
      ? handleRefund(db, batch, record, round, resolved, timeFeedback, now, categories, askedOriginal)
      : handleRepayment(
          db,
          batch,
          record,
          recordIndex,
          round,
          resolved,
          timeFeedback,
          now,
          categories,
          askedOriginal
        );
  }

  // 分类：先按全类别匹配，冲突检测才有依据。
  const userRules = listUserRules(db, record.userId);
  const classification = classify(
    { merchant: record.merchant, rawText: record.rawText, direction: null },
    { categories, userRules }
  );
  let category: CategoryRow | null =
    classification.source === 'fallback'
      ? fallbackCategory(categories, record.direction)
      : categories.find((item) => item.id === classification.categoryId) ?? null;

  const feedback: FeedbackItem[] = [...timeFeedback];
  let direction: Direction;
  let directionSource: 'explicit' | 'category' = record.direction !== null ? 'explicit' : 'category';

  if (record.direction !== null && category !== null && category.kind !== record.direction) {
    if (round === 0) {
      return persistPending(db, batch, record, round, [blocking('direction', 'CATEGORY_KIND_MISMATCH')]);
    }
    direction = category.kind;
    directionSource = 'category';
    feedback.push(warning('direction', 'DIRECTION_FORCED_BY_CATEGORY'));
  } else if (record.direction !== null) {
    direction = record.direction;
  } else if (category !== null) {
    direction = category.kind;
  } else {
    const missing = [blocking('direction', 'MISSING_DIRECTION')];
    return persistPending(db, batch, record, round, missing, round >= MAX_FOLLOWUP_ROUNDS);
  }

  if (category === null) {
    category = fallbackCategory(categories, direction);
  }

  if (classification.confidence < LOW_CONFIDENCE_THRESHOLD) {
    feedback.push(warning('category', 'LOW_CONFIDENCE_CATEGORY'));
  }

  const merchant = record.merchant?.trim() === '' || record.merchant === null ? DEFAULT_MERCHANT : record.merchant;
  if (merchant === DEFAULT_MERCHANT) {
    feedback.push(warning('merchant', 'MERCHANT_DEFAULTED'));
  }

  const occurredDate = toShanghaiDate(occurredAt);
  const transactionId = `tx_${randomUUID()}`;
  const nowIso = nowIsoShanghai();

  const transactionInput = {
    id: transactionId,
    userId: record.userId,
    direction,
    directionSource,
    amountCents,
    merchant,
    note: record.rawText,
    occurredAt,
    occurredDate,
    timeSource,
    chatAt,
    categoryId: category?.id ?? null,
    categorySource: classification.source,
    categoryConfidence: classification.confidence,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    idempotencyKey: record.idempotencyKey,
    createdAt: nowIso,
    updatedAt: nowIso,
    entryType: 'normal' as const,
    matchedTransactionId: null,
    principalCents: null,
    settledAt: null
  };
  const intakeInput = {
    idempotencyKey: record.idempotencyKey,
    recordId: record.recordId,
    batchId: batch.batchId,
    status: 'confirmed' as const,
    followupRound: round,
    transactionId,
    feedback
  };

  try {
    // 记录级原子性：账单与入站日志同事务提交，避免只写一半造成幂等键卡死。
    db.transaction(() => {
      insertTransaction(db, transactionInput);
      saveIntake(db, intakeInput);
    })();
  } catch (error) {
    // 唯一冲突自愈：已存在同幂等键的账单时补写入站日志并返回 duplicate。
    if (isUniqueViolation(error)) {
      const existingTransaction = findTransactionByIdempotencyKey(db, record.idempotencyKey);
      if (existingTransaction !== null) {
        const duplicateFeedback = [warning(null, 'DUPLICATE_RECORD')];
        saveIntake(db, {
          ...intakeInput,
          status: 'confirmed',
          transactionId: existingTransaction.id,
          feedback: duplicateFeedback
        });
        return {
          recordId: record.recordId,
          status: 'duplicate',
          transactionId: existingTransaction.id,
          direction: existingTransaction.direction,
          occurredAt: existingTransaction.occurredAt,
          category: existingTransaction.category,
          confidence: null,
          matchedTransactionId: null,
          interestTransactionId: findInterestTransactionId(db, record.idempotencyKey),
          feedback: duplicateFeedback
        };
      }
    }
    throw error;
  }

  return {
    recordId: record.recordId,
    status: 'confirmed',
    transactionId,
    direction,
    occurredAt,
    category: toView(category),
    confidence: classification.confidence,
    matchedTransactionId: null,
    interestTransactionId: null,
    feedback
  };
}

/** 查询本次还款的利息记录 id（派生幂等键 `${key}#interest`）。 */
function findInterestTransactionId(db: Db, idempotencyKey: string): string | null {
  return findTransactionByIdempotencyKey(db, `${idempotencyKey}#interest`)?.id ?? null;
}

/** 处理一个批次：逐条判定并入库，返回与输入 recordId 对应的结果。 */
export function processBatch(db: Db, batch: RawBatch): BatchResult {
  const categories = listCategories(db);
  const results = batch.records.map((record, index) =>
    processRecord(db, batch, record, index, categories)
  );
  return { batchId: batch.batchId, results };
}
