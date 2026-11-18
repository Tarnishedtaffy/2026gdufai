import { afterEach, expect, it, vi } from 'vitest';
import { request } from './src/api/request';
import { getAccessToken, setAccessToken } from './src/api/access-token';

afterEach(() => { setAccessToken(''); vi.unstubAllGlobals(); });

it('统一请求封装为 Headers/键值对输入合并内存令牌，清除后不再发送', async () => {
  const client = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', client);
  setAccessToken(' temporary-demo-token ');
  await request('/api/categories', { headers: new Headers({ 'X-Demo': 'first' }) });
  await request('/api/transactions', { headers: [['X-Demo', 'second']] });
  const first = new Headers(client.mock.calls[0]?.[1]?.headers);
  const second = new Headers(client.mock.calls[1]?.[1]?.headers);
  expect(first.get('Authorization')).toBe('Bearer temporary-demo-token');
  expect(first.get('X-Demo')).toBe('first');
  expect(second.get('X-Demo')).toBe('second');
  setAccessToken('');
  await request('/api/stats');
  expect(new Headers(client.mock.calls[2]?.[1]?.headers).has('Authorization')).toBe(false);
});

it('无效令牌不替换当前内存值，也不发请求', () => {
  const client = vi.fn(); vi.stubGlobal('fetch', client);
  setAccessToken('previous-demo-token');
  expect(() => setAccessToken('invalid\nheader')).toThrow('换行');
  expect(getAccessToken()).toBe('previous-demo-token');
  expect(client).not.toHaveBeenCalled();
});
