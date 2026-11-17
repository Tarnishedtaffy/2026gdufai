import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerFrontend } from '../../src/frontend.ts';

describe('生产前端托管', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('提供首页、静态资源和 Vue 路由，同时保留 API 与资源错误', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gdufai-frontend-'));
    roots.push(root);
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<html>fixture</html>');
    writeFileSync(join(root, 'assets', 'app.js'), 'export const fixture = true;');
    const app = Fastify();
    apps.push(app);
    app.get('/api/fixture', () => ({ ok: true }));
    await registerFrontend(app, root);

    for (const url of ['/', '/transactions', '/stats?month=2026-11', '/budget']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.body).toBe('<html>fixture</html>');
    }
    expect((await app.inject('/assets/app.js')).body).toContain('fixture = true');
    expect((await app.inject('/api/fixture')).json()).toEqual({ ok: true });
    for (const url of ['/api/not-found', '/assets/not-found.js', '/.env', '/unknown-page']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
    }
    expect((await app.inject({ method: 'POST', url: '/stats' })).statusCode).toBe(404);
  });

  it('只为 assets 下带 Vite hash 的资源设置长缓存', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gdufai-cache-'));
    roots.push(root);
    mkdirSync(join(root, 'assets'));
    const paths = ['assets/app-aB12_-34.js', 'assets/app-aB12_-34.css', 'assets/app.js',
      'assets/app-short.js', 'assets/page-aB12_-34.html', 'app-aB12_-34.js', 'index.html'];
    paths.forEach((path) => writeFileSync(join(root, path), 'fixture'));
    const app = Fastify();
    apps.push(app);
    await registerFrontend(app, root);

    for (const path of paths) {
      const response = await app.inject(`/${path}?v=ignored`);
      expect(response.statusCode).toBe(200);
      const hashedResource = path === paths[0] || path === paths[1];
      expect(response.headers['cache-control']).toBe(hashedResource
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  });

  it('HTML 的条件请求保留 no-cache，内容变化后返回新页面', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gdufai-revalidate-'));
    roots.push(root);
    writeFileSync(join(root, 'index.html'), '<html>before</html>');
    const app = Fastify();
    apps.push(app);
    await registerFrontend(app, root);
    const first = await app.inject('/stats');
    const etag = String(first.headers.etag);
    expect(etag).not.toBe('undefined');
    const unchanged = await app.inject({ url: '/stats', headers: { 'if-none-match': etag } });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.headers['cache-control']).toBe('no-cache');
    writeFileSync(join(root, 'index.html'), '<html>after deployment</html>');
    const changed = await app.inject({ url: '/stats', headers: { 'if-none-match': etag } });
    expect(changed.statusCode).toBe(200);
    expect(changed.body).toContain('after deployment');
    expect(changed.headers['cache-control']).toBe('no-cache');
  });
});
