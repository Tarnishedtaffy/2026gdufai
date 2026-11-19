import { afterEach, expect, it, vi } from 'vitest';
import { request } from './src/api/request';
import { importBatch } from './src/api/index';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  ['成功响应坏 JSON', () => new Response('not-json', { status: 200 }), 'INVALID_RESPONSE'],
  ['成功响应形状错误', () => Response.json([]), 'INVALID_RESPONSE'],
  ['无业务码 HTTP 错误', () => Response.json({ message: 'gateway' }, { status: 503 }), 'HTTP_ERROR'],
  ['无 JSON HTTP 错误', () => new Response('gateway', { status: 502 }), 'HTTP_ERROR'],
] as const)('%s 使用客户端错误码，不能伪造 INVALID_BATCH', async (_name, response, code) => {
  vi.stubGlobal('fetch', vi.fn(async () => response()));
  await expect(request('/api/demo')).rejects.toMatchObject({ code });
});

it('M2 真正返回 INVALID_BATCH 时保留其业务码和字段', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: {
    code: 'INVALID_BATCH', message: '缺少发送时间', field: 'sentAt',
  } }, { status: 400 })));
  await expect(request('/api/transactions/import')).rejects.toMatchObject({ code: 'INVALID_BATCH', field: 'sentAt' });
});

it('入站响应缺少 results 时返回客户端 INVALID_RESPONSE', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'false');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ batchId: 'demo' })));
  await expect(importBatch({ version: 1, batchId: 'demo', sentAt: '2026-11-19T09:00:00+08:00', records: [] }))
    .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
