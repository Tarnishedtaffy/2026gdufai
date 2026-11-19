import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { allNodes, dispatch, findNode, mountCaptureApp, visibleText } from './test-support/app-renderer';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('未提交草稿重新填写会清除共享状态，切页返回后旧草稿不会复现，且始终零请求', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubGlobal('document', { activeElement: null });
  const client = vi.fn(); vi.stubGlobal('fetch', client);
  const app = await mountCaptureApp();
  try {
    await dispatch(findNode(app.root, 'cap-raw'), 'input', '虚构旧草稿：不应再次出现');
    await dispatch(findNode(app.root, 'cap-amount'), 'input', '18.50');
    const form = allNodes(app.root).find(node => node.kind === 'form' && node.props.id !== 'api-access-form')!;
    await dispatch(form, 'submit');
    expect(visibleText(app.root)).toContain('虚构旧草稿：不应再次出现');
    const reset = allNodes(app.root).find(node => node.kind === 'button' && visibleText(node).trim() === '重新填写')!;
    await dispatch(reset, 'click');
    expect(findNode(app.root, 'cap-raw').value).toBe('');
    await app.router.push('/stats'); await app.router.push('/'); await nextTick();
    expect(visibleText(app.root)).toContain('准备文字草稿');
    expect(visibleText(app.root)).not.toContain('虚构旧草稿：不应再次出现');
    expect(findNode(app.root, 'cap-raw').value).toBe('');
    expect(findNode(app.root, 'cap-amount').value).toBe('');
    expect(client).not.toHaveBeenCalled();
  } finally { app.unmount(); }
});

it('旧重新填写事件在提交中和 retry 时均不能绕过本地放弃二次确认', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubGlobal('document', { activeElement: null });
  let finish!: (value: Response) => void;
  const client = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', client);
  const app = await mountCaptureApp();
  let pending: Promise<void> | undefined;
  try {
    app.view.value!.acceptDrafts([{ rawText: '虚构待提交草稿', amount: 12, merchant: null, direction: 'expense',
      occurredAt: '2026-11-19T12:00:00+08:00', confidence: null, modality: 'text', sourceRef: null }]);
    await nextTick();
    const reset = allNodes(app.root).find(node => node.kind === 'button' && visibleText(node).trim() === '重新填写')!;
    const confirm = allNodes(app.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
    pending = dispatch(confirm, 'click'); await Promise.resolve();
    await dispatch(reset, 'click');
    expect(visibleText(app.root)).not.toContain('准备文字草稿');
    finish(Response.json({ message: '虚构故障' }, { status: 503 })); await pending;
    await dispatch(reset, 'click');
    expect(visibleText(app.root)).not.toContain('准备文字草稿');
    expect(visibleText(app.root)).toContain('服务端可能已入库，请先到账单一览核对');
    expect(allNodes(app.root).some(node => node.props.id === 'cap-discard-confirm')).toBe(false);
    expect(client).toHaveBeenCalledTimes(1);
  } finally {
    finish?.(Response.json({ message: '清理虚构故障' }, { status: 503 }));
    await pending; app.unmount();
  }
});
