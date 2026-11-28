import { afterEach, expect, it, vi } from 'vitest';
import { stubCaptureFetch, mountCaptureApp, allNodes, dispatch, findNode, visibleText } from './test-support/app-renderer';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('未决提交仅在明确确认后放弃本地草稿，提示先核对账单，不发服务端撤销请求', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubGlobal('document', { activeElement: null });
  let finish!: (response: Response) => void;
  const client = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
  stubCaptureFetch(client);
  const app = await mountCaptureApp();
  const button = (text: string) => allNodes(app.root).find(node => node.kind === 'button' && visibleText(node).trim() === text)!;
  try {
    await dispatch(findNode(app.root, 'cap-raw'), 'input', '虚构待核对消费');
    await dispatch(findNode(app.root, 'cap-amount'), 'input', '12.50');
    const entry = allNodes(app.root).find(node => node.kind === 'form' && node.props.id !== 'api-access-form')!;
    await dispatch(entry, 'submit');
    const submit = allNodes(app.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
    const pending = dispatch(submit, 'click'); await Promise.resolve();
    expect(button('放弃本地草稿')).toBeUndefined();
    finish(Response.json({ message: '接口未就绪' }, { status: 404 })); await pending;
    expect(visibleText(app.root)).toContain('服务端可能已入库，请先到账单一览核对');
    expect(allNodes(app.root).find(node => node.kind === 'fieldset')?.props.disabled).toBe(true);
    await dispatch(button('放弃本地草稿'), 'click');
    expect(button('确认放弃本地草稿').props.disabled).toBe(true);
    await dispatch(button('继续保留'), 'click');
    expect(client).toHaveBeenCalledTimes(1);
    expect(button('重试原提交')).toBeTruthy();
    await dispatch(button('放弃本地草稿'), 'click');
    const acknowledge = findNode(app.root, 'cap-discard-confirm');
    Object.assign(acknowledge, { checked: true }); await dispatch(acknowledge, 'change');
    expect(button('确认放弃本地草稿').props.disabled).toBe(false);
    await dispatch(button('确认放弃本地草稿'), 'click');
    expect(findNode(app.root, 'cap-raw').value).toBe('');
    expect(findNode(app.root, 'cap-amount').value).toBe('');
    expect(client).toHaveBeenCalledTimes(1);
    expect(visibleText(app.root)).toContain('准备文字草稿');
  } finally { app.unmount(); }
});
