import { afterEach, expect, it, vi } from 'vitest';
import { parseCaptureEdit } from './src/components/capture/capture-form';
import { parseDateTime } from './src/utils/datetime';
import { stubCaptureFetch, allNodes, dispatch, findNode, mountCaptureApp, visibleText } from './test-support/app-renderer';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('手工入口与草稿卡片对非法日历给出相同错误，不把坏时间改为 null 后提交', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false'); vi.stubGlobal('document', { activeElement: null });
  const client = vi.fn(); stubCaptureFetch(client);
  const app = await mountCaptureApp();
  try {
    await dispatch(findNode(app.root, 'cap-raw'), 'input', '虚构日期核对消费');
    await dispatch(findNode(app.root, 'cap-amount'), 'input', '12.50');
    const form = allNodes(app.root).find(node => node.kind === 'form' && node.props.id !== 'api-access-form')!;
    for (const invalid of ['2026-02-31T12:00', '2025-02-29T12:00', '2026-13-01T12:00', 'bad']) {
      await dispatch(findNode(app.root, 'cap-time'), 'input', invalid);
      await dispatch(form, 'submit');
      const edit = parseCaptureEdit('occurredAt', invalid);
      expect(edit.patch).toBeNull();
      expect(visibleText(app.root)).toContain(edit.error);
      expect(client).not.toHaveBeenCalled();
    }
    await dispatch(findNode(app.root, 'cap-time'), 'input', '2024-02-29T12:34:56');
    await dispatch(form, 'submit');
    expect(visibleText(app.root)).toContain('待确认草稿');
    expect(client).not.toHaveBeenCalled();
  } finally { app.unmount(); }
});

it('明确的合法时区时间可归一化，未知时间仍是 null', () => {
  expect(parseDateTime('2024-02-29T04:34:56Z')).toEqual({ value: '2024-02-29T12:34:56+08:00', error: null });
  expect(parseDateTime('2026-02-31T04:34:56Z').error).toBeTruthy();
  expect(parseDateTime('')).toEqual({ value: null, error: null });
  expect(parseCaptureEdit('occurredAt', '2024-02-29T12:34:56')).toEqual({
    patch: { occurredAt: '2024-02-29T12:34:56+08:00' }, error: null,
  });
});
