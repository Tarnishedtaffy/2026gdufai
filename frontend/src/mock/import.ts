import type {
  CategoryItem,
  Direction,
  FeedbackItem,
  ImportBatch,
  ImportRecord,
  ImportResult,
  ImportResultItem,
} from '../types/contract';
import { normalizeIsoOffset, toDateKey } from '../utils/datetime';
import { yuanToCents } from '../utils/money';
import { appendMockTransaction } from './db';
import {
  confirmedByIdempotencyKey,
  evaluateRefund,
  findCategoryByNameAndKind,
  followupRoundByKey,
} from './refund';

function inferCategory(record: ImportRecord, dir: Direction): CategoryItem {
  const text = `${record.merchant ?? ''} ${record.rawText}`;
  if (dir === 'income') {
    return findCategoryByNameAndKind('工资', 'income');
  }
  if (text.includes('地铁') || text.includes('打车') || text.includes('公交')) {
    return findCategoryByNameAndKind('交通', 'expense');
  }
  if (text.includes('书') || text.includes('课')) {
    return findCategoryByNameAndKind('教育', 'expense');
  }
  if (text.includes('超市') || text.includes('买')) {
    return findCategoryByNameAndKind('购物', 'expense');
  }
  return findCategoryByNameAndKind('餐饮', 'expense');
}

function evaluateRecord(record: ImportRecord): ImportResultItem {
  const existing = confirmedByIdempotencyKey.get(record.idempotencyKey);
  if (existing) {
    return {
      ...existing,
      recordId: record.recordId,
      status: 'duplicate',
      feedback: [{ field: null, code: 'DUPLICATE_RECORD', severity: 'warning' }],
    };
  }

  const normalizedOccurredAt = normalizeIsoOffset(record.occurredAt);
  const amountMissing = record.amount === null || record.amount <= 0;
  const isRefund = record.rawText.includes('退款');

  // 退款走契约 §1.8 显式原单匹配；金额/时间不全时先按普通追问补齐。
  if (isRefund && record.amount !== null && record.amount > 0 && normalizedOccurredAt) {
    return evaluateRefund(record, record.amount, normalizedOccurredAt);
  }

  const feedback: FeedbackItem[] = [];
  if (!isRefund && record.direction === null) {
    feedback.push({ field: 'direction', code: 'MISSING_DIRECTION', severity: 'blocking' });
  }
  if (amountMissing) {
    feedback.push({ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' });
  }
  if (!normalizedOccurredAt) {
    feedback.push({ field: 'occurredAt', code: 'MISSING_TIME', severity: 'blocking' });
  }

  const effectiveDirection: Direction = record.direction ?? 'expense';
  const cat = inferCategory(record, effectiveDirection);
  const categoryRef = { id: cat.id, name: cat.name, kind: cat.kind };

  if (feedback.length > 0) {
    const nextRound = (followupRoundByKey.get(record.idempotencyKey) ?? 0) + 1;
    followupRoundByKey.set(record.idempotencyKey, nextRound);
    if (nextRound >= 3) {
      return {
        recordId: record.recordId,
        status: 'rejected',
        transactionId: null,
        direction: effectiveDirection,
        occurredAt: normalizedOccurredAt,
        category: categoryRef,
        confidence: record.confidence,
        feedback,
      };
    }
    return {
      recordId: record.recordId,
      status: 'pending_followup',
      transactionId: null,
      direction: effectiveDirection,
      occurredAt: normalizedOccurredAt,
      category: categoryRef,
      confidence: record.confidence,
      feedback,
    };
  }

  const txId = `tx-mock-${Date.now()}`;
  const amountCents = yuanToCents(String(record.amount)) ?? 0;
  const finalOccurredAt = normalizedOccurredAt as string;
  appendMockTransaction({
    id: txId,
    direction: effectiveDirection,
    amountCents,
    merchant: record.merchant,
    occurredAt: finalOccurredAt,
    occurredDate: toDateKey(finalOccurredAt),
    category: { id: cat.id, name: cat.name, color: cat.color, icon: cat.icon },
    categoryConfidence: record.confidence ?? 0.9,
    sourceModality: record.modality,
    sourceRef: record.sourceRef,
    status: 'confirmed',
    anomalyFlag: null,
  });

  const confirmedItem: ImportResultItem = {
    recordId: record.recordId,
    status: 'confirmed',
    transactionId: txId,
    direction: effectiveDirection,
    occurredAt: finalOccurredAt,
    category: categoryRef,
    confidence: record.confidence ?? 0.9,
    feedback: record.merchant ? [] : [{ field: 'merchant', code: 'MERCHANT_DEFAULTED', severity: 'warning' }],
  };
  confirmedByIdempotencyKey.set(record.idempotencyKey, confirmedItem);
  followupRoundByKey.delete(record.idempotencyKey);
  return confirmedItem;
}

/**
 * 模拟多模态批次入站状态机（对齐契约反馈码、duplicate 成功复用及满 3 轮永久 rejected）。
 * @param batch 入站请求批次
 */
export async function mockImportBatch(batch: ImportBatch): Promise<ImportResult> {
  const results: ImportResultItem[] = [];
  for (const record of batch.records) {
    results.push(evaluateRecord(record));
  }
  return {
    batchId: batch.batchId,
    results,
  };
}
