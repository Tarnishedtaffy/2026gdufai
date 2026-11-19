import { describe, expect, it } from 'vitest';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { CaptureDependencies, CaptureFeedback } from '../../src/modules/capture/index.ts';
import { context, draft } from './helpers.ts';

const migrationCases = [
  { code: 'MISSING_ORIGINAL_TRANSACTION', severity: 'blocking', status: 'pending_followup',
    text: '请确认这笔退款或还款对应的原账单。' },
  { code: 'ORIGINAL_NOT_FOUND', severity: 'blocking', status: 'pending_followup',
    text: '没找到可匹配的原账单，请到账单一览核对。' },
  { code: 'REFUND_RECORDED_NEUTRAL', severity: 'warning', status: 'confirmed',
    text: '退款已记录且不计入收支，原账单已自动作废或调整。' },
  { code: 'REPAYMENT_RECORDED_NEUTRAL', severity: 'warning', status: 'confirmed',
    text: '还款已记录且不计入收支，原贷款账单已自动作废或调整。' },
  { code: 'ORIGINAL_NOT_FOUND_RECORDED', severity: 'warning', status: 'confirmed',
    text: '没找到原账单，已归入其他或其他收入，且不计入收支。' },
  { code: 'ORIGINAL_AMOUNT_ADJUSTED', severity: 'warning', status: 'confirmed',
    text: '原账单金额已自动调整为剩余金额。' },
  { code: 'REFUND_EXCESS_AS_INCOME', severity: 'warning', status: 'confirmed',
    text: '原账单已自动作废，退款超出部分已计入收入。' },
  { code: 'REPAYMENT_EXCESS_AS_EXPENSE', severity: 'warning', status: 'confirmed',
    text: '原贷款账单已自动作废，还款超出部分已计入支出。' },
] as const;

type OutgoingBatch = Parameters<CaptureDependencies['importBatch']>[0];

function result(batch: OutgoingBatch, status: 'confirmed' | 'pending_followup' | 'rejected', feedback: CaptureFeedback[]) {
  return { batchId: batch.batchId, results: batch.records.map(record => ({
    recordId: record.recordId, status, transactionId: status === 'confirmed' ? 'tx_refund_compatibility' : null,
    direction: 'income', occurredAt: record.occurredAt, category: null, confidence: null, feedback,
    matchedTransactionId: null,
  })) };
}

describe('M1 预兼容 #17 契约 v1.4 的八个退款/还款反馈码', () => {
  it.each(migrationCases)('$code 保留 M2 的状态和严重度并给出对应话术', async item => {
    let serial = 0;
    const feedback: CaptureFeedback = { field: 'originalTransactionId', code: item.code, severity: item.severity };
    const session = createCaptureSession({ newId: () => String(++serial),
      importBatch: async batch => result(batch, item.status, [feedback]) });
    session.prepare(context, [draft({ rawText: '虚构退款兼容验证' })]);
    const snapshot = await session.submit();
    expect(snapshot.phase).toBe(item.status === 'confirmed' ? 'complete' : 'pending_followup');
    expect(snapshot.records[0]!.result).toMatchObject({ status: item.status, feedback: [feedback] });
    expect(snapshot.records[0]!.messages).toEqual([{ ...feedback, text: item.text }]);
  });

  it('原账单追问后按 M2 回执结束，保留原记录与幂等键且不自行新增关联字段', async () => {
    let serial = 0;
    const batches: OutgoingBatch[] = [];
    const session = createCaptureSession({ newId: () => String(++serial), importBatch: async batch => {
      batches.push(structuredClone(batch));
      return batches.length === 1
        ? result(batch, 'pending_followup', [{ field: 'originalTransactionId', code: 'MISSING_ORIGINAL_TRANSACTION', severity: 'blocking' }])
        : result(batch, 'confirmed', [{ field: 'originalTransactionId', code: 'ORIGINAL_NOT_FOUND_RECORDED', severity: 'warning' }]);
    } });
    session.prepare(context, [Object.assign(draft({ rawText: '虚构未匹配退款' }), { originalTransactionId: 'tx_model_injected' })]);
    expect((await session.submit()).phase).toBe('pending_followup');
    const completed = await session.submit();
    expect(completed.phase).toBe('complete');
    expect(completed.records[0]!.messages[0]?.code).toBe('ORIGINAL_NOT_FOUND_RECORDED');
    expect(batches[1]!.batchId).not.toBe(batches[0]!.batchId);
    expect(batches[1]!.records).toEqual(batches[0]!.records);
    expect(batches[0]!.records[0]).not.toHaveProperty('originalTransactionId');
    expect(batches[0]!.records[0]).not.toHaveProperty('followupRound');
  });

  it('部分退款的中性记录与原单改额反馈一并展示，不引导再次作废原单', async () => {
    let serial = 0;
    const session = createCaptureSession({ newId: () => String(++serial), importBatch: async batch => result(batch,
      'confirmed', [
        { field: 'rawText', code: 'REFUND_RECORDED_NEUTRAL', severity: 'warning' },
        { field: 'originalTransactionId', code: 'ORIGINAL_AMOUNT_ADJUSTED', severity: 'warning' },
      ]) });
    session.prepare(context, [draft({ rawText: '虚构部分退款' })]);
    const snapshot = await session.submit();
    expect(snapshot.phase).toBe('complete');
    expect(snapshot.records[0]!.messages.map(message => message.text)).toEqual([
      '退款已记录且不计入收支，原账单已自动作废或调整。',
      '原账单金额已自动调整为剩余金额。',
    ]);
    expect(snapshot.records[0]!.messages.some(message => /请.*作废/.test(message.text))).toBe(false);
  });
});

describe('历史 v1.2/v1.3 服务兼容，不作为 v1.4 当前行为断言', () => {
  it('旧 v1.2 服务的退款拒绝仍可解释，不把旧码当作已入库', async () => {
    let serial = 0;
    const session = createCaptureSession({ newId: () => String(++serial), importBatch: async batch => result(batch,
      'rejected', [{ field: 'rawText', code: 'REFUND_NOT_SUPPORTED', severity: 'blocking' }]) });
    session.prepare(context, [draft({ rawText: '虚构旧服务退款' })]);
    const snapshot = await session.submit();
    expect(snapshot.phase).toBe('complete');
    expect(snapshot.records[0]!.result).toMatchObject({ status: 'rejected', transactionId: null });
    expect(snapshot.records[0]!.messages[0]).toMatchObject({ code: 'REFUND_NOT_SUPPORTED', severity: 'blocking',
      text: '退款请到账单一览中作废原账单。' });
  });

  it('旧 v1.3 超额退款拒绝保留原状态和历史话术', async () => {
    let serial = 0;
    const session = createCaptureSession({ newId: () => String(++serial), importBatch: async batch => result(batch,
      'rejected', [{ field: 'amount', code: 'REFUND_EXCEEDS_ORIGINAL', severity: 'blocking' }]) });
    session.prepare(context, [draft({ rawText: '虚构超额退款' })]);
    const snapshot = await session.submit();
    expect(snapshot.phase).toBe('complete');
    expect(snapshot.records[0]!.result).toMatchObject({ status: 'rejected', transactionId: null });
    expect(snapshot.records[0]!.messages[0]?.text).toBe('退款金额高于原账单，尚未入库，请核对退款金额。');
  });

  it('旧 v1.3 部分退款收入反馈仍可解释', async () => {
    let serial = 0;
    const session = createCaptureSession({ newId: () => String(++serial), importBatch: async batch => result(batch,
      'confirmed', [{ field: 'rawText', code: 'PARTIAL_REFUND_AS_INCOME', severity: 'warning' }]) });
    session.prepare(context, [draft({ rawText: '虚构历史部分退款' })]);
    const snapshot = await session.submit();
    expect(snapshot.records[0]!.result?.status).toBe('confirmed');
    expect(snapshot.records[0]!.messages[0]?.text).toBe('已按部分退款计入收入。');
  });
});
