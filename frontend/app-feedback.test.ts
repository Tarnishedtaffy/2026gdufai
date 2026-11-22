import { afterEach, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { createCaptureSession, type CaptureDraft, type ImportBatch } from '@gduf/capture-flow';
import CaptureDraftCard from './src/components/capture/CaptureDraftCard.vue';
import { allNodes, dispatch, findNode, mountUi, visibleText } from './test-support/app-renderer';

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


it('同一张待追问小票卡片显示识别补充金额，并保留未改动字段的编辑错误', async () => {
  class TestDocument { activeElement = null; }
  vi.stubGlobal('Document', TestDocument);
  vi.stubGlobal('document', new TestDocument());
  let serial = 0;
  const importBatch = vi.fn(async (batch: ImportBatch) => ({
    batchId: batch.batchId,
    results: batch.records.map(record => ({
      recordId: record.recordId, status: record.amount === null ? 'pending_followup' : 'confirmed',
      transactionId: record.amount === null ? null : 'tx_followup_demo', direction: 'expense',
      occurredAt: record.occurredAt, category: null, confidence: null,
      feedback: record.amount === null ? [{ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' }] : [],
    })),
  }));
  const session = createCaptureSession({ newId: () => `followup-${++serial}`, importBatch });
  const date = '2026-11-22T12:00:00+08:00';
  const sourceRef = 'uploads/2026/11/550e8400-e29b-41d4-a716-446655440000.jpg';
  session.prepare({ sessionId: 'followup-session', userId: 'u_001', sentAt: date, chatAt: null }, [{
    rawText: '虚构小票', amount: null, merchant: '虚构商户', occurredAt: date,
    direction: 'expense', confidence: null, modality: 'image', sourceRef,
  }]);
  const row = shallowRef((await session.submit()).records[0]!);
  const { recordId, idempotencyKey } = row.value.record;
  const change = vi.fn((id: string, patch: Partial<CaptureDraft> | null, _error: string | null) => {
    if (patch) row.value = session.update(id, patch).records[0]!;
  });
  const Harness = defineComponent({ setup: () => () => h(CaptureDraftCard, {
    key: row.value.record.recordId, row: row.value, locked: false, index: 0, onChange: change,
  }) });
  const mounted = mountUi(Harness, {});
  try {
    expect(row.value.result?.status).toBe('pending_followup');
    expect(findNode(mounted.root, 'draft-amount-0').value).toBe('');
    // 本地非法日期不是草稿补丁，应保留原输入和错误提示。
    await dispatch(findNode(mounted.root, 'draft-time-0'), 'input', '2026-02-31T12:00');
    const error = change.mock.lastCall?.[2];
    expect(error).toBeTruthy();

    row.value = session.update(recordId, { amount: 32.5 }).records[0]!;
    await nextTick();
    expect(findNode(mounted.root, 'draft-amount-0').value).toBe('32.5');
    expect(findNode(mounted.root, 'draft-time-0').value).toBe('2026-02-31T12:00');
    expect(visibleText(mounted.root)).toContain(error!);
    expect(change).toHaveBeenCalledTimes(1);
    expect(importBatch).toHaveBeenCalledTimes(1);

    for (const formattedAmount of ['33.00', '32.50']) {
      const input = findNode(mounted.root, 'draft-amount-0');
      await dispatch(input, 'input', formattedAmount);
      expect(input.value).toBe(formattedAmount);
    }
    await dispatch(findNode(mounted.root, 'draft-time-0'), 'input', '2026-11-22T12:00:00');
    expect(visibleText(mounted.root)).not.toContain(error!);
    expect(importBatch).toHaveBeenCalledTimes(1);
    expect((await session.submit()).records[0]?.result?.status).toBe('confirmed');
    expect(importBatch).toHaveBeenCalledTimes(2);
    expect(importBatch.mock.lastCall?.[0].records).toEqual([
      expect.objectContaining({ amount: 32.5, recordId, idempotencyKey, modality: 'image', sourceRef }),
    ]);
  } finally { mounted.unmount(); }
});
