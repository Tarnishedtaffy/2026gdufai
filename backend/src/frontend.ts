import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { extname, relative, sep } from 'node:path';

/** 托管构建后的 Vue 页面；只为已有页面注册回退，保留 API 和资源的 404。 */
export async function registerFrontend(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    cacheControl: false,
    setHeaders(response, path) {
      // Vite 默认产物使用 assets/<name>-<8 位 hash>.<ext>；HTML 和 public 文件需重新验证。
      const assetPath = relative(root, path).split(sep).join('/');
      const hashedAsset = /^assets\/.+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(assetPath);
      const immutable = hashedAsset && extname(path).toLowerCase() !== '.html';
      response.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  });
  for (const path of ['/transactions', '/stats', '/budget']) {
    app.get(path, (_request, reply) => reply.sendFile('index.html'));
  }
}
