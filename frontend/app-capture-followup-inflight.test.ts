import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { ImportBatch } from '@gduf/capture-flow';
import { allNodes, dispatch, mountCaptureApp, visibleText } from './test-support/app-renderer';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(['首次识别成功', '识别失败后重试'])('%s：识别完成前拦截重发，核对金额后保留幂等键提交', async (scenario) => {
  vi.stubEnv('VITE_USE_MOCK', 'false');
  vi.stubGlobal('Document', class {});
  vi.stubGlobal('ShadowRoot', class {});
  vi.stubGlobal('document', { activeElement: null });
  const extraction = Promise.withResolvers<Response>();
  const batches: ImportBatch[] = [];
  let extractionAttempts = 0;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/api/capture/extract')) {
      extractionAttempts += 1;
      if (scenario === '识别失败后重试' && extractionAttempts === 2) {
        return Response.json({ patch: { amount: 32.5 } });
      }
      return extraction.promise;
    }
    expect(url).toMatch(/\/api\/transactions\/import$/);
    const batch = JSON.parse(String(init.body)) as ImportBatch;
    batches.push(batch);
    const confirmed = batches.length > 1;
    return Response.json({
      batchId: batch.batchId,
      results: batch.records.map(record => ({
        recordId: record.recordId, status: confirmed ? 'confirmed' : 'pending_followup',
        transactionId: confirmed ? 'tx_fixture' : null, direction: record.direction,
        occurredAt: record.occurredAt, category: null, confidence: null,
        feedback: confirmed ? [] : [{ code: 'MISSING_AMOUNT', severity: 'blocking', field: 'amount' }],
      })),
    });
  });
  vi.stubGlobal('fetch', fetcher);

  const mounted = await mountCaptureApp();
  try {
    const findButton = (text: string) => allNodes(mounted.root)
      .find(node => node.kind === 'button' && visibleText(node).includes(text))!;
    mounted.view.value!.acceptDrafts([{
      rawText: '咖啡', amount: null, merchant: null, direction: 'expense',
      occurredAt: '2026-11-20T12:00:00+08:00', modality: 'text', sourceRef: null, confidence: null,
    }]);
    await nextTick();
    await dispatch(findButton('确认并提交'), 'click');
    expect(batches).toHaveLength(1);
    const followupForm = allNodes(mounted.root).find(node => node.kind === 'form' &&
      allNodes(node).some(child => child.kind === 'textarea'))!;
    const followupText = allNodes(followupForm).find(node => node.kind === 'textarea')!;
    const initialResendButton = findButton('确认补充并重发');
    await dispatch(followupText, 'input', '花了 32.5 元');
    const pending = dispatch(followupForm, 'submit');
    await nextTick();

    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/api/capture/extract');
    expect(initialResendButton.props.disabled).toBe(true);
    await dispatch(initialResendButton, 'click');
    expect(batches).toHaveLength(1);

    if (scenario === '识别失败后重试') {
      extraction.resolve(Response.json({ error: { code: 'AI_UPSTREAM_ERROR', message: '识别服务暂时不可用' } }, { status: 503 }));
      await pending;
      expect(visibleText(mounted.root)).toContain('识别服务暂时不可用');
      expect(findButton('确认补充并重发').props.disabled).toBe(false);
      expect(batches).toHaveLength(1);
      // 失败后保留说明，用户可以直接重试识别。
      expect(followupText.value).toBe('花了 32.5 元');
      await dispatch(followupForm, 'submit');
    } else {
      extraction.resolve(Response.json({ patch: { amount: 32.5 } }));
      await pending;
    }
    const resend = findButton('确认补充并重发');
    expect(resend.props.disabled).toBe(false);
    expect(batches).toHaveLength(1);
    await dispatch(resend, 'click');
    expect(batches).toHaveLength(2);
    expect(batches[1]!.records[0]).toMatchObject({
      recordId: batches[0]!.records[0]!.recordId,
      idempotencyKey: batches[0]!.records[0]!.idempotencyKey,
      amount: 32.5,
    });
  } finally {
    extraction.resolve(Response.json({ patch: {} }));
    mounted.unmount();
  }
});
