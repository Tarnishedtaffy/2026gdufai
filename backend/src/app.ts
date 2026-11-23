import Fastify, { type FastifyInstance } from 'fastify';
import { loadAiConfig, type AppConfig } from './config/index.ts';
import type { Db } from './db/client.ts';
import { registerBudgetRoutes } from './modules/budget/routes.ts';
import {
  createCaptureExtractor,
  createOpenAiCompatibleProvider,
  registerCaptureRoutes,
  type CaptureExtractor
} from './modules/capture/index.ts';
import { registerLedgerRoutes } from './modules/ledger/routes.ts';
import { AppError } from './shared/errors.ts';

export interface AppDeps {
  readonly config: AppConfig;
  readonly db: Db;
  /** 可选注入的 M1 抽取服务；测试可通过 `app.inject` 传入 stub。 */
  readonly captureExtractor?: CaptureExtractor;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
  }
}

/**
 * 创建 Fastify 实例。测试用 `app.inject` 直接调用，不监听端口。
 * M1 上传/抽取与 M2 业务路由按契约注册。
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.nodeEnv === 'development' ? 'info' : 'warn' }
  });

  app.decorate('db', deps.db);
  app.decorate('config', deps.config);

  const captureExtractor =
    deps.captureExtractor ??
    createCaptureExtractor({
      uploadDir: deps.config.uploadDir,
      provider: createOpenAiCompatibleProvider(deps.config.ai ?? loadAiConfig({}))
    });

  // 鉴权：APP_AUTH_TOKEN 已配置时，所有 /api/* 请求必须携带 Bearer Token。
  app.addHook('onRequest', async (request) => {
    if (deps.config.authToken === null || !request.url.startsWith('/api/')) {
      return;
    }
    if (request.headers.authorization !== `Bearer ${deps.config.authToken}`) {
      throw new AppError('UNAUTHORIZED', 401, '缺少或错误的鉴权头');
    }
  });

  void app.register(registerLedgerRoutes);
  void app.register(registerBudgetRoutes);
  void app.register(registerCaptureRoutes, { extractor: captureExtractor });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          field: error.field,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      });
      return;
    }
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode < 500) {
      // Fastify 自身的 4xx（如 JSON 解析失败）不能把内部错误码泄漏给客户端。
      const code =
        statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 422 ? 'INVALID_QUERY_PARAM' : 'INVALID_BATCH';
      void reply.status(statusCode).send({
        error: { code, message: '请求格式不正确' }
      });
      return;
    }
    request.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' }
    });
  });

  return app;
}
