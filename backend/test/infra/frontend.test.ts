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
});
