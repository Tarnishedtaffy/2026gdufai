import type { FastifyInstance } from 'fastify';
import { listBudgets, removeBudget, upsertBudget } from './service.ts';

function firstValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

/** 注册 M4 预算读写路由；鉴权由 app.ts 的全局 onRequest 钩子统一处理。 */
export async function registerBudgetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/budgets', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    return reply.send(listBudgets(app.db, app.config.demoUserId, firstValue(query.month)));
  });

  app.put('/api/budgets', async (request, reply) => {
    return reply.send(upsertBudget(app.db, app.config.demoUserId, request.body));
  });

  app.delete('/api/budgets/:id', async (request, reply) => {
    const params = request.params as { id?: string };
    removeBudget(app.db, app.config.demoUserId, params.id);
    return reply.status(204).send();
  });
}
