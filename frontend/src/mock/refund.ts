import type {
  CategoryItem,
  Direction,
  FeedbackItem,
  ImportCategoryRef,
  ImportRecord,
  ImportResultItem,
} from '../types/contract';
import { toDateKey } from '../utils/datetime';
import { yuanToCents } from '../utils/money';
import { MOCK_CATEGORIES } from './data';
import { appendMockTransaction, getMockTransactions } from './db';

/** 已确认结果按幂等键缓存，重发返回 duplicate（普通与退款共用）。 */
export const confirmedByIdempotencyKey = new Map<string, ImportResultItem>();
/** 追问轮次按幂等键维护：退款首轮追问原单，次轮兜底中性。 */
export const followupRoundByKey = new Map<string, number>();

export function findCategoryByNameAndKind(name: string, kind: Direction): CategoryItem {
  for (const cat of MOCK_CATEGORIES) {
    if (cat.name === name && cat.kind === kind) {
      return cat;
    }
  }
  for (const cat of MOCK_CATEGORIES) {
    if (cat.kind === kind) {
      return cat;
    }
  }
  return MOCK_CATEGORIES[0];
}

/** 把退款中性记录写入 mock 账单库并按 confirmed 缓存幂等键（重发返回 duplicate）。 */
function persistNeutralRefund(
  record: ImportRecord,
  amountCents: number,
  occurredAt: string,
  categoryRef: ImportCategoryRef,
  incomeCat: CategoryItem,
  feedback: FeedbackItem[],
  matchedTransactionId: string | null
): ImportResultItem {
  const txId = `tx-mock-${Date.now()}`;
  appendMockTransaction({
    id: txId,
    direction: 'income',
    amountCents,
    merchant: record.merchant,
    occurredAt,
    occurredDate: toDateKey(occurredAt),
    category: { id: incomeCat.id, name: incomeCat.name, color: incomeCat.color, icon: incomeCat.icon },
    categoryConfidence: record.confidence ?? 0.9,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    status: 'confirmed',
    anomalyFlag: null,
    entryType: 'refund',
    settledAt: null,
    matchedTransactionId,
  });
  const confirmedItem: ImportResultItem = {
    recordId: record.recordId,
    status: 'confirmed',
    transactionId: txId,
    matchedTransactionId,
    direction: 'income',
    occurredAt,
    category: categoryRef,
    confidence: record.confidence ?? 0.9,
    feedback,
  };
  confirmedByIdempotencyKey.set(record.idempotencyKey, confirmedItem);
  followupRoundByKey.delete(record.idempotencyKey);
  return confirmedItem;
}

/**
 * 模拟契约 §1.8 退款三态：首轮缺原单追问（MISSING_ORIGINAL_TRANSACTION / ORIGINAL_NOT_FOUND），
 * 次轮兜底中性（ORIGINAL_NOT_FOUND_RECORDED）；匹配成功按差额作废/调整原单（v1.4）。
 */
export function evaluateRefund(record: ImportRecord, amount: number, occurredAt: string): ImportResultItem {
  const amountCents = yuanToCents(String(amount)) ?? 0;
  const incomeCat = findCategoryByNameAndKind('其他收入', 'income');
  const categoryRef: ImportCategoryRef = { id: incomeCat.id, name: incomeCat.name, kind: incomeCat.kind };
  const round = followupRoundByKey.get(record.idempotencyKey) ?? 0;

  const original = record.originalTransactionId
    ? getMockTransactions().find(tx => tx.id === record.originalTransactionId) ?? null
    : null;
  const originalUsable =
    original !== null &&
    original.status === 'confirmed' &&
    (original.entryType ?? 'normal') === 'normal' &&
    Date.parse(original.occurredAt) <= Date.now();

  const settled = originalUsable && original.settledAt != null;
  if (!originalUsable || settled) {
    if (round < 1 || settled) {
      followupRoundByKey.set(record.idempotencyKey, round + 1);
      const code = settled ? 'ORIGINAL_ALREADY_SETTLED' : record.originalTransactionId ? 'ORIGINAL_NOT_FOUND' : 'MISSING_ORIGINAL_TRANSACTION';
      return {
        recordId: record.recordId,
        status: round >= 2 ? 'rejected' : 'pending_followup',
        transactionId: null,
        direction: 'income',
        occurredAt,
        category: categoryRef,
        confidence: record.confidence,
        feedback: [{ field: 'originalTransactionId', code, severity: 'blocking' }],
      };
    }
    followupRoundByKey.delete(record.idempotencyKey);
    return persistNeutralRefund(record, amountCents, occurredAt, categoryRef, incomeCat, [
      { field: 'originalTransactionId', code: 'ORIGINAL_NOT_FOUND_RECORDED', severity: 'warning' },
    ], null);
  }

  // 原单存在且未结清：按差额三态处理原单，再入库中性退款。
  const feedback: FeedbackItem[] = [];
  const diff = amountCents - original.amountCents;
  if (diff === 0) {
    original.status = 'void';
    feedback.push({ field: 'originalTransactionId', code: 'REFUND_RECORDED_NEUTRAL', severity: 'warning' });
  } else if (diff < 0) {
    original.amountCents -= amountCents;
    feedback.push({ field: 'originalTransactionId', code: 'ORIGINAL_AMOUNT_ADJUSTED', severity: 'warning' });
  } else {
    original.status = 'void';
    feedback.push({ field: 'originalTransactionId', code: 'REFUND_EXCESS_AS_INCOME', severity: 'warning' });
    appendMockTransaction({
      id: `tx-mock-${Date.now()}-excess`,
      direction: 'income',
      amountCents: diff,
      merchant: record.merchant,
      occurredAt,
      occurredDate: toDateKey(occurredAt),
      category: { id: incomeCat.id, name: incomeCat.name, color: incomeCat.color, icon: incomeCat.icon },
      categoryConfidence: 0.3,
      sourceModality: record.modality,
      sourceRef: record.sourceRef,
      status: 'confirmed',
      anomalyFlag: null,
      entryType: 'normal',
      matchedTransactionId: original.id,
    });
  }
  return persistNeutralRefund(record, amountCents, occurredAt, categoryRef, incomeCat, feedback, original.id);
}
