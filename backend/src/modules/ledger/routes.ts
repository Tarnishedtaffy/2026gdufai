import type { FastifyInstance } from 'fastify';
import { AppError } from '../../shared/errors.ts';
import { invalidBatch } from '../../shared/errors.ts';
import { processBatch } from './intake.ts';
import { buildStats, type StatsDirection, type StatsDimension, type StatsOrder } from './stats.ts';
import { listTransactions, type TransactionListQuery } from './transactions.ts';
import { listCategoryItems } from './repository.ts';
import { parseBatch } from './validation.ts';
import {
  patchTransaction,
  voidTransactionById,
  type PatchTransactionInput
} from './transaction-edit.ts';

function invalid(message: string): never {
  throw new AppError('INVALID_QUERY_PARAM', 422, message);
}

function firstValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function parseDimension(value: string | undefined): StatsDimension {
  if (value === 'day' || value === 'month' || value === 'year' || value === 'recent7') {
    return value;
  }
  return invalid('dimension 必须是 day / month / year / recent7');
}

function parseDirection(value: string | undefined): StatsDirection {
  if (value === undefined) {
    return 'all';
  }
  if (value === 'all' || value === 'expense' || value === 'income') {
    return value;
  }
  return invalid('direction 必须是 all / expense / income');
}

function parseOrder(value: string | undefined): StatsOrder {
  if (value === undefined) {
    return 'asc';
  }
  if (value === 'asc' || value === 'desc') {
    return value;
  }
  return invalid('order 必须是 asc / desc');
}

function parseCategoryIds(value: string | undefined): number[] | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parts = value.split(',').map((item) => Number(item.trim()));
  if (parts.some((item) => !Number.isInteger(item) || item <= 0)) {
    return invalid('categoryIds 必须是逗号分隔的正整数');
  }
  return parts;
}

/** 注册 M2 的读取路由：类别字典、统计与账单一览。 */
export async function registerLedgerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/transactions/import', async (request, reply) => {
    const parsed = parseBatch(request.body);
    if (!parsed.ok) {
      throw invalidBatch(parsed.message, parsed.field);
    }
    // 契约 §0.1：单用户演示，入站 userId 必须等于 DEMO_USER_ID，否则整批拒收。
    const mismatchIndex = parsed.batch.records.findIndex(
      (item) => item.userId !== app.config.demoUserId
    );
    if (mismatchIndex !== -1) {
      throw invalidBatch(
        `records[${mismatchIndex}].userId 必须等于 DEMO_USER_ID`,
        `records[${mismatchIndex}].userId`
      );
    }
    const result = processBatch(app.db, parsed.batch);
    return reply.status(201).send(result);
  });

  app.get('/api/categories', async (_request, reply) => {
    return reply.send(listCategoryItems(app.db));
  });

  app.get('/api/stats', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const breakdownBy = firstValue(query.breakdownBy);
    if (breakdownBy !== undefined && breakdownBy !== 'category') {
      invalid('breakdownBy 目前只支持 category');
    }
    const result = buildStats(app.db, app.config.demoUserId, {
      dimension: parseDimension(firstValue(query.dimension)),
      date: firstValue(query.date),
      month: firstValue(query.month),
      year: firstValue(query.year),
      breakdownBy: breakdownBy === 'category' ? 'category' : undefined,
      direction: parseDirection(firstValue(query.direction)),
      categoryIds: parseCategoryIds(firstValue(query.categoryIds)),
      order: parseOrder(firstValue(query.order))
    });
    return reply.send(result);
  });

  app.get('/api/transactions', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const categoryIdText = firstValue(query.categoryId);
    const limitText = firstValue(query.limit);
    const directionText = firstValue(query.direction);
    const entryTypeText = firstValue(query.entryType);

    const listQuery: TransactionListQuery = {
      categoryId: categoryIdText === undefined ? undefined : Number(categoryIdText),
      from: firstValue(query.from),
      to: firstValue(query.to),
      direction:
        directionText === undefined
          ? undefined
          : directionText === 'expense' || directionText === 'income'
            ? directionText
            : invalid('direction 必须是 expense / income'),
      limit: limitText === undefined ? undefined : Number(limitText),
      cursor: firstValue(query.cursor),
      entryType:
        entryTypeText === undefined
          ? undefined
          : entryTypeText === 'all' ||
              entryTypeText === 'normal' ||
              entryTypeText === 'refund' ||
              entryTypeText === 'repayment'
            ? entryTypeText
            : invalid('entryType 必须是 all / normal / refund / repayment')
    };
    if (listQuery.categoryId !== undefined && (!Number.isInteger(listQuery.categoryId) || listQuery.categoryId <= 0)) {
      invalid('categoryId 必须是正整数');
    }
    if (listQuery.limit !== undefined && !Number.isInteger(listQuery.limit)) {
      invalid('limit 必须是整数');
    }
    return reply.send(listTransactions(app.db, app.config.demoUserId, listQuery));
  });

  app.patch('/api/transactions/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const result = patchTransaction(
      app.db,
      id,
      app.config.demoUserId,
      (request.body ?? {}) as PatchTransactionInput
    );
    return reply.send(result);
  });

  app.post('/api/transactions/:id/void', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    return reply.send(voidTransactionById(app.db, id, app.config.demoUserId));
  });
}
