import type {
  BudgetInput,
  BudgetItem,
  CategoryItem,
  ImportBatch,
  ImportResult,
  StatsQuery,
  StatsResponse,
  TransactionListResponse,
  TransactionQuery,
} from '../types/contract';
import { createApiError, isMockEnabled, request } from './request';
import { nowIso } from '../utils/datetime';
import {
  mockDeleteBudget,
  mockGetBudgets,
  mockGetCategories,
  mockListTransactions,
  mockPutBudget,
} from '../mock/db';
import { mockGetStats } from '../mock/stats';
import { mockImportBatch } from '../mock/import';

/**
 * 获取全量预设类别字典（裸数组）。
 */
export async function getCategories(): Promise<CategoryItem[]> {
  if (isMockEnabled()) {
    return mockGetCategories();
  }
  return request<CategoryItem[]>('/api/categories', { expectArray: true });
}

/**
 * 按维度获取收支统计与桶分布数据。
 * @param query 统计维度与可选时间参数
 */
export async function getStats(query: StatsQuery): Promise<StatsResponse> {
  if (isMockEnabled()) {
    return mockGetStats(query);
  }
  const params = new URLSearchParams();
  params.set('dimension', query.dimension);
  if (query.categoryIds?.length) params.set('categoryIds', query.categoryIds.join(','));
  if (query.direction) {
    params.set('direction', query.direction);
  }
  if (query.dimension !== 'recent7') {
    const today = nowIso().slice(0, 10);
    if (query.dimension === 'day') {
      params.set('date', query.date ?? today);
    } else if (query.dimension === 'month') {
      params.set('month', query.month ?? today.slice(0, 7));
    } else if (query.dimension === 'year') {
      params.set('year', query.year ?? today.slice(0, 4));
    }
  }
  return request<StatsResponse>(`/api/stats?${params.toString()}`);
}

/**
 * 按游标分页查询账单明细列表（严禁传 page/offset）。
 * @param query 筛选与游标参数
 */
export async function listTransactions(query: TransactionQuery = {}): Promise<TransactionListResponse> {
  if (isMockEnabled()) {
    return mockListTransactions(query);
  }
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.categoryId !== null && query.categoryId !== undefined) {
    params.set('categoryId', String(query.categoryId));
  }
  if (query.direction) params.set('direction', query.direction);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const qs = params.toString();
  return request<TransactionListResponse>(qs ? `/api/transactions?${qs}` : '/api/transactions');
}

/**
 * 获取指定月份的预算执行列表（裸数组）。
 * @param month 目标月份（YYYY-MM）
 */
export async function getBudgets(month: string): Promise<BudgetItem[]> {
  if (isMockEnabled()) {
    return mockGetBudgets(month);
  }
  const params = new URLSearchParams({ month });
  return request<BudgetItem[]>(`/api/budgets?${params.toString()}`, { expectArray: true });
}

/**
 * 新增或幂等覆盖预算。
 * @param input 预算写入参数
 */
export async function putBudget(input: BudgetInput): Promise<BudgetItem> {
  if (isMockEnabled()) {
    return mockPutBudget(input);
  }
  return request<BudgetItem>('/api/budgets', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/**
 * 删除预算；成功时后端返回 204。
 * @param id 预算 id
 */
export async function deleteBudget(id: number): Promise<void> {
  if (isMockEnabled()) {
    mockDeleteBudget(id);
    return;
  }
  await request<void>(`/api/budgets/${id}`, { method: 'DELETE' });
}

/**
 * 提交多模态记账批次并返回完整入站结果（N1：返回完整 ImportResult）。
 * @param batch 入站批次对象
 */
export async function importBatch(batch: ImportBatch): Promise<ImportResult> {
  const res = isMockEnabled()
    ? await mockImportBatch(batch)
    : await request<ImportResult>('/api/transactions/import', {
        method: 'POST',
        body: JSON.stringify(batch),
      });
  if (!Array.isArray(res.results) || res.results.length === 0) {
    throw createApiError('INVALID_RESPONSE', '入站响应缺少有效的 results 列表');
  }
  return res;
}
