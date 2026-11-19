import { afterEach, expect, it, vi } from 'vitest';
import { createCaptureSession } from '@gduf/capture-flow';
import CaptureDraftCard from './src/components/capture/CaptureDraftCard.vue';
import { allNodes, mountUi, visibleText } from './test-support/app-renderer';

afterEach(() => vi.unstubAllGlobals());

it('按 v1.2 原样展示低置信反馈的候选名称，成功回执不新增分类修改入口', async () => {
  vi.stubGlobal('document', { activeElement: null });
  let serial = 0;
  const candidates = [{ id: 1, name: '餐饮' }, { id: 3, name: '购物' }];
  const session = createCaptureSession({ newId: () => `candidate-${++serial}`, importBatch: async batch => ({
    batchId: batch.batchId, results: batch.records.map(record => ({ recordId: record.recordId,
      status: 'confirmed', transactionId: 'tx_candidate_demo', direction: 'expense',
      occurredAt: record.occurredAt, category: { id: 8, name: '其他', kind: 'expense' }, confidence: 0.5,
      feedback: [{ field: 'category', code: 'LOW_CONFIDENCE_CATEGORY', severity: 'warning', candidates }],
    })),
  }) });
  session.prepare({ sessionId: 'candidate-session', userId: 'u_001', sentAt: '2026-11-17T12:00:00+08:00', chatAt: null }, [{
    rawText: '虚构待分类消费', amount: 12, merchant: null, occurredAt: '2026-11-17T12:00:00+08:00',
    direction: 'expense', confidence: null, modality: 'text', sourceRef: null,
  }]);
  const snapshot = await session.submit();
  const mounted = mountUi(CaptureDraftCard, { row: snapshot.records[0], locked: false, index: 0 });
  try {
    const text = visibleText(mounted.root);
    expect(text).toContain('参考类别：餐饮、购物');
    expect(text).toContain('返回类别：其他');
    expect(allNodes(mounted.root).filter(node => node.kind === 'button')).toHaveLength(0);
    expect(allNodes(mounted.root).find(node => node.kind === 'fieldset')?.props.disabled).toBe(true);
  } finally { mounted.unmount(); }
});

it('duplicate 回执展示已记过并沿用原账单', () => {
  vi.stubGlobal('document', { activeElement: null });
  const record = { recordId: 'r_duplicate', userId: 'u_001', idempotencyKey: 'demo-key', chatAt: null,
    rawText: '虚构重复消费', amount: 12, merchant: null, occurredAt: null, direction: null,
    confidence: null, modality: 'text', sourceRef: null };
  const mounted = mountUi(CaptureDraftCard, { row: { record, messages: [], result: {
    recordId: record.recordId, status: 'duplicate', transactionId: 'tx_original', direction: 'expense',
    occurredAt: null, category: null, confidence: null, feedback: [],
  } }, locked: false, index: 0 });
  try { expect(visibleText(mounted.root)).toContain('已记过，沿用原账单'); }
  finally { mounted.unmount(); }
});

it.each([
  ['REFUND_RECORDED_NEUTRAL', '退款已记录且不计入收支，原账单已自动作废或调整。'],
  ['REPAYMENT_RECORDED_NEUTRAL', '还款已记录且不计入收支，原贷款账单已自动作废或调整。'],
  ['ORIGINAL_AMOUNT_ADJUSTED', '原账单金额已自动调整为剩余金额。'],
  ['REFUND_EXCESS_AS_INCOME', '原账单已自动作废，退款超出部分已计入收入。'],
  ['REPAYMENT_EXCESS_AS_EXPENSE', '原贷款账单已自动作废，还款超出部分已计入支出。'],
] as const)('%s 回执卡片展示自动处理后的实际语义，不再指示用户重复作废', async (code, expected) => {
  vi.stubGlobal('document', { activeElement: null });
  let serial = 0;
  const session = createCaptureSession({ newId: () => `v14-${++serial}`, importBatch: async batch => ({
    batchId: batch.batchId, results: batch.records.map(record => ({ recordId: record.recordId,
      status: 'confirmed', transactionId: 'tx_v14_demo', direction: 'expense',
      occurredAt: record.occurredAt, category: null, confidence: null,
      feedback: [{ field: 'amount', code, severity: 'warning' }],
    })),
  }) });
  session.prepare({ sessionId: 'v14-session', userId: 'u_001', sentAt: '2026-11-19T12:00:00+08:00', chatAt: null }, [{
    rawText: '虚构 v1.4 回执', amount: 12, merchant: null, occurredAt: '2026-11-19T12:00:00+08:00',
    direction: 'expense', confidence: null, modality: 'text', sourceRef: null,
  }]);
  const snapshot = await session.submit();
  const mounted = mountUi(CaptureDraftCard, { row: snapshot.records[0], locked: false, index: 0 });
  try {
    const text = visibleText(mounted.root);
    expect(text).toContain(expected);
    expect(text).not.toContain('请到账单一览作废');
    expect(text).not.toContain(`（${code}）`);
  } finally { mounted.unmount(); }
});
