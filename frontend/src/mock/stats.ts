import type {
  StatsBucket,
  StatsCategory,
  StatsQuery,
  StatsResponse,
  TopCategory,
  TransactionItem,
} from '../types/contract';
import { nowIso, recent7Keys, toDateKey } from '../utils/datetime';
import { DEMO_TODAY, MOCK_CATEGORIES } from './data';
import { getMockTransactions } from './db';

function isPresetCategory(categoryId: number): boolean {
  for (const cat of MOCK_CATEGORIES) {
    if (cat.id === categoryId) {
      return cat.isPreset;
    }
  }
  return false;
}

function buildBucketCategories(bucketTxs: TransactionItem[], totalDirCents: number): StatsCategory[] {
  const map = new Map<number, StatsCategory>();
  for (const tx of bucketTxs) {
    if (!tx.category) continue;
    const prev = map.get(tx.category.id);
    if (prev) {
      prev.totalCents += tx.amountCents;
      prev.count += 1;
    } else {
      map.set(tx.category.id, {
        categoryId: tx.category.id,
        name: tx.category.name,
        kind: tx.direction,
        color: tx.category.color,
        custom: !isPresetCategory(tx.category.id),
        totalCents: tx.amountCents,
        count: 1,
        ratio: 0,
      });
    }
  }
  const result: StatsCategory[] = [];
  for (const entry of map.values()) {
    entry.ratio = totalDirCents > 0 ? Number((entry.totalCents / totalDirCents).toFixed(4)) : 0;
    result.push(entry);
  }
  return result;
}

/**
 * 模拟按维度聚合统计，对齐契约 range/summary/buckets/meta 全部字段。
 * @param query 统计请求参数
 */
export function mockGetStats(query: StatsQuery): StatsResponse {
  const direction = query.direction ?? 'expense';
  const keys =
    query.dimension === 'recent7'
      ? recent7Keys(DEMO_TODAY)
      : [query.month ?? query.date ?? query.year ?? DEMO_TODAY.slice(0, 7)];

  const allTransactions = getMockTransactions();
  const buckets: StatsBucket[] = [];
  const overallCatMap = new Map<number, TopCategory>();
  let totalExpenseCents = 0;
  let totalIncomeCents = 0;
  let totalCount = 0;

  for (const period of keys) {
    let bucketExp = 0;
    let bucketInc = 0;
    let bucketCount = 0;
    const dirTxs: TransactionItem[] = [];

    for (const tx of allTransactions) {
      const txKey = query.dimension === 'recent7' ? toDateKey(tx.occurredAt) : tx.occurredAt.slice(0, period.length);
      if (txKey !== period) {
        continue;
      }
      bucketCount += 1;
      if (tx.direction === 'expense') bucketExp += tx.amountCents;
      if (tx.direction === 'income') bucketInc += tx.amountCents;
      if ((direction === 'all' || tx.direction === direction) && tx.category) {
        dirTxs.push(tx);
        const prevTop = overallCatMap.get(tx.category.id);
        if (prevTop) {
          prevTop.totalCents += tx.amountCents;
        } else {
          overallCatMap.set(tx.category.id, {
            categoryId: tx.category.id,
            name: tx.category.name,
            totalCents: tx.amountCents,
            ratio: 0,
          });
        }
      }
    }

    const dirTotal =
      direction === 'expense' ? bucketExp : direction === 'income' ? bucketInc : bucketExp + bucketInc;
    buckets.push({
      period,
      expenseCents: bucketExp,
      incomeCents: bucketInc,
      count: bucketCount,
      categories: buildBucketCategories(dirTxs, dirTotal),
    });
    totalExpenseCents += bucketExp;
    totalIncomeCents += bucketInc;
    totalCount += bucketCount;
  }

  const targetTotal =
    direction === 'expense' ? totalExpenseCents : direction === 'income' ? totalIncomeCents : totalExpenseCents + totalIncomeCents;
  let topCategory: TopCategory | null = null;
  for (const item of overallCatMap.values()) {
    item.ratio = targetTotal > 0 ? Number((item.totalCents / targetTotal).toFixed(4)) : 0;
    if (!topCategory || item.totalCents > topCategory.totalCents) {
      topCategory = item;
    }
  }

  return {
    dimension: query.dimension,
    range: {
      start: keys[0] ?? DEMO_TODAY,
      end: keys[keys.length - 1] ?? DEMO_TODAY,
    },
    direction,
    summary: {
      expenseCents: totalExpenseCents,
      incomeCents: totalIncomeCents,
      netCents: totalIncomeCents - totalExpenseCents,
      count: totalCount,
      topCategory,
    },
    buckets,
    meta: {
      unit: 'cent',
      basis: { dateField: 'occurred_date', timezone: 'Asia/Shanghai', includeVoid: false },
      generatedAt: nowIso(),
      isEmpty: totalCount === 0,
    },
  };
}
