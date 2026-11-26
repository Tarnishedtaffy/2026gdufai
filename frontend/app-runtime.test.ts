import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import type { ImportBatch } from '@gduf/capture-flow';
import { mountCaptureApp, visibleText, allNodes, dispatch, findNode } from './test-support/app-renderer';
import { getCategories } from './src/api/index';
import { getAccessToken, setAccessToken } from './src/api/access-token';

afterEach(() => { setAccessToken(''); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** 应用级渲染与 API 边界测试；真实 HTTP 和数据库验证位于 backend 测试包。 */
it('API stub 验证 App 身份、401 令牌修正后原批次重试及图片/语音来源透传', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubEnv('VITE_DEMO_USER_ID', '');
  vi.stubGlobal('document', { activeElement: null });
  const persist = vi.fn();
  vi.stubGlobal('localStorage', { setItem: persist }); vi.stubGlobal('sessionStorage', { setItem: persist });
  const client = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (new Headers(init?.headers).get('Authorization') !== 'Bearer demo-test-access') {
      return Response.json({ error: { code: 'UNAUTHORIZED', message: '请核对访问令牌' } }, { status: 401 });
    }
    if (String(url).endsWith('/api/categories')) return Response.json([]);
    const batch = JSON.parse(String(init?.body)) as ImportBatch;
    return Response.json({ batchId: batch.batchId, results: batch.records.map(record => ({
      recordId: record.recordId, status: 'confirmed', transactionId: `tx_${record.recordId}`,
      direction: record.direction, occurredAt: record.occurredAt, category: null, confidence: null, feedback: [],
    })) });
  });
  vi.stubGlobal('fetch', client);
  const mounted = await mountCaptureApp();
  try {
    const attachment = findNode(mounted.root, 'cap-file');
    Object.assign(attachment, { files: [{ name: 'local-receipt.png', type: 'image/png' }] });
    await dispatch(attachment, 'change');
    expect(visibleText(mounted.root)).toContain('local-receipt.png（待识别）');
    expect(client).not.toHaveBeenCalled();
    mounted.view.value!.acceptDrafts([{ rawText: '演示午饭 24.5 元', amount: 24.5, merchant: '演示商户',
      direction: 'expense', occurredAt: '2026-11-17T12:00:00+08:00', modality: 'text', sourceRef: null, confidence: null }]);
    await nextTick();
    expect(visibleText(mounted.root)).not.toContain('真实记账尚未接入登录会话');
    const button = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
    expect(button.props.disabled).toBe(false);
    await dispatch(button, 'click');
    expect(visibleText(mounted.root)).toContain('UNAUTHORIZED');
    const tokenInput = findNode(mounted.root, 'api-access-token');
    await dispatch(tokenInput, 'input', 'demo-test-access');
    await dispatch(findNode(mounted.root, 'api-access-form'), 'submit');
    expect(getAccessToken()).toBe('demo-test-access');
    expect(tokenInput.value).toBe(''); expect(persist).not.toHaveBeenCalled();
    const retry = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node).trim() === '重试原提交')!;
    await dispatch(retry, 'click');
    expect(visibleText(mounted.root)).toContain('已入库');
    expect(client.mock.calls[0]![1]?.body).toBe(client.mock.calls[1]![1]?.body);
    const firstBatch = JSON.parse(String(client.mock.calls[0]![1]?.body)) as ImportBatch;
    expect(firstBatch.records[0]).toMatchObject({ userId: 'u_001', amount: 24.5, sourceRef: null });
    const firstKey = firstBatch.records[0]!.idempotencyKey;
    await mounted.router.push('/stats'); await mounted.router.push('/'); await nextTick();
    mounted.view.value!.acceptDrafts([
      { rawText: '演示语音：午饭 18.5 元', amount: 18.5, merchant: null, direction: 'expense',
        occurredAt: '2026-11-17T12:00:00+08:00', modality: 'voice', sourceRef: 'uploads/2026/11/recognized.webm', confidence: 0.9 },
      { rawText: '演示小票：午饭 29 元', amount: 29, merchant: null, direction: 'expense',
        occurredAt: '2026-11-17T12:00:00+08:00', modality: 'image', sourceRef: 'uploads/2026/11/recognized.jpg', confidence: 0.9 },
    ]);
    await nextTick(); expect(client).toHaveBeenCalledTimes(2);
    const confirm = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
    await dispatch(confirm, 'click');
    const batch = JSON.parse(String(client.mock.calls[2]![1]?.body)) as ImportBatch;
    expect(batch.records.map(record => ({ modality: record.modality, sourceRef: record.sourceRef }))).toEqual([
      { modality: 'voice', sourceRef: 'uploads/2026/11/recognized.webm' },
      { modality: 'image', sourceRef: 'uploads/2026/11/recognized.jpg' },
    ]);
    expect(batch.records.every(record => record.userId === 'u_001'
      && record.idempotencyKey.startsWith(firstKey.split(':')[0] + ':'))).toBe(true);
    expect(await getCategories()).toEqual([]);
    expect(new Headers(client.mock.calls.at(-1)![1]?.headers).get('Authorization')).toBe('Bearer demo-test-access');
    const clear = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node).trim() === '清除令牌')!;
    await dispatch(clear, 'click');
    await expect(getCategories()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(new Headers(client.mock.calls.at(-1)![1]?.headers).has('Authorization')).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  } finally { mounted.unmount(); }
});
