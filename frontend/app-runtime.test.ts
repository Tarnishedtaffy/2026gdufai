import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { buildApp } from '../backend/src/app.ts';
import { openDatabase } from '../backend/src/db/client.ts';
import { seedCategories } from '../backend/src/db/seed/categories.ts';
import { seedDemoUser } from '../backend/src/db/seed/users.ts';
import { mountCaptureApp, visibleText, allNodes, dispatch, findNode } from './test-support/app-renderer';
import { getCategories } from './src/api/index';
import { getAccessToken, setAccessToken } from './src/api/access-token';

afterEach(() => { setAccessToken(''); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('真实 App 提供单用户身份，401 后输入内存令牌并原样重试，文字/语音/图片均经 HTTP 写入 SQLite', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubEnv('VITE_DEMO_USER_ID', '');
  vi.stubGlobal('document', { activeElement: null });
  const persist = vi.fn();
  vi.stubGlobal('localStorage', { setItem: persist }); vi.stubGlobal('sessionStorage', { setItem: persist });
  const db = openDatabase(':memory:'); seedCategories(db); seedDemoUser(db, 'u_001');
  const server = buildApp({ db, config: { port: 0, nodeEnv: 'test', databasePath: ':memory:',
    uploadDir: './uploads', authToken: 'demo-test-access', demoUserId: 'u_001' } });
  let mounted: Awaited<ReturnType<typeof mountCaptureApp>> | null = null;
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    vi.stubEnv('VITE_API_BASE_URL', address);
    const nativeFetch = globalThis.fetch;
    const calls: { path: string; body: string | null; authorization: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? new URL(url, address) : url;
      calls.push({ path: String(target), body: typeof init?.body === 'string' ? init.body : null,
        authorization: new Headers(init?.headers).get('Authorization') });
      // 补全同源相对路径以模拟浏览器 fetch；传输仍使用 Node 原生 HTTP。
      return nativeFetch(target, init);
    });
    mounted = await mountCaptureApp();
    const attachment = findNode(mounted.root, 'cap-file');
    Object.assign(attachment, { files: [{ name: 'local-receipt.png', type: 'image/png' }] });
    await dispatch(attachment, 'change');
    expect(visibleText(mounted.root)).toContain('local-receipt.png（尚未识别）');
    expect(visibleText(mounted.root)).toContain('暂不上传或生成可提交草稿');
    expect(calls).toHaveLength(0);
    mounted.view.value!.acceptDrafts([{ rawText: '演示午饭 24.5 元', amount: 24.5, merchant: '演示商户',
      direction: 'expense', occurredAt: '2026-11-17T12:00:00+08:00', modality: 'text', sourceRef: null, confidence: null }]);
    await nextTick();
    expect(visibleText(mounted.root)).not.toContain('真实记账尚未接入登录会话');
    const button = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
    expect(button.props.disabled).toBe(false);
    await dispatch(button, 'click');
    expect(visibleText(mounted.root)).toContain('UNAUTHORIZED');
    expect(db.prepare('SELECT id FROM transactions').all()).toEqual([]);
    const tokenInput = findNode(mounted.root, 'api-access-token');
    expect(tokenInput.props.type).toBe('password'); expect(tokenInput.props.autocomplete).toBe('off');
    await dispatch(tokenInput, 'input', 'demo-test-access');
    await dispatch(findNode(mounted.root, 'api-access-form'), 'submit');
    expect(getAccessToken()).toBe('demo-test-access');
    expect(tokenInput.value).toBe(''); expect(persist).not.toHaveBeenCalled();
    const retry = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node) === '重试原提交')!;
    await dispatch(retry, 'click');
    expect(visibleText(mounted.root)).toContain('已入库');
    expect(db.prepare('SELECT user_id, amount_cents FROM transactions').all()).toEqual([{ user_id: 'u_001', amount_cents: 2450 }]);
    expect(calls[0]!.body).toBe(calls[1]!.body);
    expect(calls.map(call => call.authorization)).toEqual([null, 'Bearer demo-test-access']);
    const firstKey = JSON.parse(calls[0]!.body!).records[0].idempotencyKey as string;

    await mounted.router.push('/stats'); await mounted.router.push('/'); await nextTick();
    mounted.view.value!.acceptDrafts([
      { rawText: '演示语音：午饭 18.5 元', amount: 18.5, merchant: '演示商户', direction: 'expense',
        occurredAt: '2026-11-17T12:00:00+08:00', modality: 'voice', sourceRef: 'uploads/2026/11/recognized.webm', confidence: 0.9 },
      { rawText: '演示小票：午饭 29 元', amount: 29, merchant: '演示商户', direction: 'expense',
        occurredAt: '2026-11-17T12:00:00+08:00', modality: 'image', sourceRef: 'uploads/2026/11/recognized.jpg', confidence: 0.9 },
    ]);
    await nextTick();
    expect(calls).toHaveLength(2);
    const confirm = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
    await dispatch(confirm, 'click');
    expect(visibleText(mounted.root)).toContain('已入库');
    const batch = JSON.parse(calls[2]!.body!);
    expect(batch.records.every((record: { userId: string; idempotencyKey: string }) => record.userId === 'u_001'
      && record.idempotencyKey.startsWith(firstKey.split(':')[0] + ':'))).toBe(true);
    expect(db.prepare('SELECT source_modality, source_ref FROM transactions WHERE source_ref IS NOT NULL ORDER BY amount_cents').all()).toEqual([
      { source_modality: 'voice', source_ref: 'uploads/2026/11/recognized.webm' },
      { source_modality: 'image', source_ref: 'uploads/2026/11/recognized.jpg' },
    ]);
    expect((await getCategories()).length).toBeGreaterThanOrEqual(12);
    expect(calls.at(-1)!.authorization).toBe('Bearer demo-test-access');
    const clear = allNodes(mounted.root).find(node => node.kind === 'button' && visibleText(node) === '清除令牌')!;
    await dispatch(clear, 'click'); expect(getAccessToken()).toBe('');
    await expect(getCategories()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(calls.at(-1)!.authorization).toBeNull(); expect(persist).not.toHaveBeenCalled();
  } finally { mounted?.unmount(); try { await server.close(); } finally { db.close(); } }
});
