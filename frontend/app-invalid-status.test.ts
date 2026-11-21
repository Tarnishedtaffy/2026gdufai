import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { ImportBatch } from '@gduf/capture-flow';
import { mountCaptureApp, allNodes, dispatch, visibleText } from './test-support/app-renderer';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('数组状态回执不显示已入库，用户重试保持原载荷且可恢复成功', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false');
  vi.stubGlobal('document', { activeElement: null });
  const batches: ImportBatch[] = [];
  const client = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as ImportBatch;
    batches.push(batch);
    return Response.json({ batchId: batch.batchId, results: batch.records.map(record => ({
      recordId: record.recordId, status: batches.length === 1 ? ['confirmed'] : 'confirmed',
      transactionId: batches.length === 1 ? null : 'tx_demo', category: null,
      direction: 'expense', occurredAt: record.occurredAt, confidence: null, feedback: [],
    })) });
  });
  vi.stubGlobal('fetch', client);
  const app = await mountCaptureApp();
  const button = (text: string) => allNodes(app.root)
    .find(node => node.kind === 'button' && visibleText(node).includes(text))!;
  try {
    app.view.value!.acceptDrafts([{ rawText: '虚构消费 12.5 元', amount: 12.5, merchant: null,
      occurredAt: '2026-11-19T12:00:00+08:00', direction: 'expense',
      modality: 'text', sourceRef: null, confidence: null }]);
    await nextTick();
    await dispatch(button('确认并提交'), 'click');
    expect(visibleText(app.root)).toContain('M2 处理结果无效');
    expect(visibleText(app.root)).toContain('第 1 条 · 待确认草稿');
    expect(visibleText(app.root)).not.toContain('第 1 条 · 已入库');
    expect(button('重试原提交')).toBeTruthy();
    await dispatch(button('重试原提交'), 'click');
    expect(client).toHaveBeenCalledTimes(2);
    expect(batches[1]).toEqual(batches[0]);
    expect(visibleText(app.root)).toContain('第 1 条 · 已入库');
    expect(visibleText(app.root)).toContain('tx_demo');
  } finally { app.unmount(); }
});
