import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** 托管构建后的 Vue 页面；只为已有页面注册回退，保留 API 和资源的 404。 */
export async function registerFrontend(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, maxAge: 0 });
  for (const path of ['/transactions', '/stats', '/budget']) {
    app.get(path, (_request, reply) => reply.sendFile('index.html'));
  }
}
