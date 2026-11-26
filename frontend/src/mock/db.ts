import type {
  CategoryItem,
  TransactionItem,
  TransactionListResponse,
  TransactionQuery,
} from '../types/contract';
import { MOCK_CATEGORIES } from './data';
import { storeTransactions } from './store';

export { mockDeleteBudget, mockGetBudgets, mockPutBudget } from './budget';

/**
 * 读取当前内存账单列表供统计模块聚合使用。
 */
export function getMockTransactions(): readonly TransactionItem[] {
  return storeTransactions;
}

/**
 * 向本地 mock 账单库追加一条已确认记录。
 * @param item 账单条目
 */
export function appendMockTransaction(item: TransactionItem): void {
  storeTransactions.unshift(item);
}

/**
 * 返回全量预设类别字典。
 */
export function mockGetCategories(): CategoryItem[] {
  const list: CategoryItem[] = [];
  for (const cat of MOCK_CATEGORIES) {
    list.push({ ...cat });
  }
  return list;
}

/**
 * 模拟游标分页查询账单明细（对齐契约 §2.3：默认只列 normal，summary 恒只统计 normal）。
 * @param query 查询筛选参数
 */
export function mockListTransactions(query: TransactionQuery): TransactionListResponse {
  const limit = query.limit ?? 10;
  const entryType = query.entryType ?? 'normal';
  const filtered: TransactionItem[] = [];
  let summaryExpenseCents = 0;
  let summaryIncomeCents = 0;
  let summaryCount = 0;

  for (const tx of storeTransactions) {
    if (tx.status !== 'confirmed') {
      continue;
    }
    if (query.categoryId !== null && query.categoryId !== undefined && tx.category?.id !== query.categoryId) {
      continue;
    }
    if (query.direction && tx.direction !== query.direction) {
      continue;
    }
    if (query.from && tx.occurredDate < query.from) {
      continue;
    }
    if (query.to && tx.occurredDate > query.to) {
      continue;
    }
    if (entryType !== 'all' && (tx.entryType ?? 'normal') !== entryType) {
      continue;
    }
    if ((tx.entryType ?? 'normal') === 'normal') {
      summaryCount += 1;
      if (tx.direction === 'expense') {
        summaryExpenseCents += tx.amountCents;
      } else {
        summaryIncomeCents += tx.amountCents;
      }
    }
    filtered.push(tx);
  }

  const startIdx = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0;
  // 对齐真实列表：每条必回 entryType 与 matchedTransactionId（缺省视为 normal / null）。
  const items = filtered.slice(startIdx, startIdx + limit).map((tx) => ({
    ...tx,
    entryType: tx.entryType ?? 'normal',
    matchedTransactionId: tx.matchedTransactionId ?? null,
  }));
  const nextIdx = startIdx + items.length;
  const hasMore = nextIdx < filtered.length;

  return {
    filter: {
      categoryId: query.categoryId ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      direction: query.direction ?? null,
      entryType: query.entryType ?? 'normal',
    },
    summary: {
      expenseCents: summaryExpenseCents,
      incomeCents: summaryIncomeCents,
      count: summaryCount,
    },
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? String(nextIdx) : null,
    },
    meta: {
      unit: 'cent',
      isEmpty: filtered.length === 0,
    },
  };
}
