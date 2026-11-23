import type { BudgetInput, BudgetItem } from '../types/contract';
import { MOCK_BUDGETS_BY_MONTH, MOCK_CATEGORIES } from './data';
import { storeTransactions } from './store';

const storeBudgets: Record<string, BudgetItem[]> = {};
for (const [month, list] of Object.entries(MOCK_BUDGETS_BY_MONTH)) {
  storeBudgets[month] = list.map((item) => ({
    ...item,
    category: item.category ? { ...item.category } : null,
    alertThresholds: [...item.alertThresholds],
  }));
}

let nextBudgetId = 1;
for (const list of Object.values(storeBudgets)) {
  for (const item of list) {
    nextBudgetId = Math.max(nextBudgetId, item.id + 1);
  }
}

function spentForMonth(month: string, categoryId: number | null): number {
  let total = 0;
  for (const tx of storeTransactions) {
    if (tx.direction !== 'expense' || tx.status !== 'confirmed') continue;
    if (!tx.occurredDate.startsWith(month)) continue;
    if (categoryId !== null && tx.category?.id !== categoryId) continue;
    total += tx.amountCents;
  }
  return total;
}

function levelOf(spentCents: number, amountCents: number): BudgetItem['level'] {
  if (spentCents * 100 >= amountCents * 100) return 'over';
  if (spentCents * 100 >= amountCents * 80) return 'near';
  return 'normal';
}

function toBudgetItem(input: BudgetInput, id: number): BudgetItem {
  const spentCents = spentForMonth(input.month, input.categoryId);
  const found =
    input.categoryId === null ? null : MOCK_CATEGORIES.find((item) => item.id === input.categoryId);
  return {
    id,
    scope: input.scope,
    category: found ? { id: found.id, name: found.name } : null,
    amountCents: input.amountCents,
    spentCents,
    remainingCents: input.amountCents - spentCents,
    usageRatio: Number((spentCents / input.amountCents).toFixed(3)),
    level: levelOf(spentCents, input.amountCents),
    alertThresholds: [...new Set(input.alertThresholds)].sort((a, b) => a - b),
  };
}

/**
 * 查询指定月份预算列表；所有预算按当前内存账单动态计算已用金额。
 * @param month 月份（YYYY-MM）
 */
export function mockGetBudgets(month: string): BudgetItem[] {
  const list = storeBudgets[month] ?? [];
  return list.map((item) => {
    const spentCents = spentForMonth(month, item.category?.id ?? null);
    return {
      ...item,
      category: item.category ? { ...item.category } : null,
      spentCents,
      remainingCents: item.amountCents - spentCents,
      usageRatio: Number((spentCents / item.amountCents).toFixed(3)),
      level: levelOf(spentCents, item.amountCents),
      alertThresholds: [...item.alertThresholds],
    };
  });
}

/**
 * 新增或幂等覆盖预算，返回与后端 PUT 相同形状的视图。
 * @param input 预算写入参数
 */
export function mockPutBudget(input: BudgetInput): BudgetItem {
  const list = storeBudgets[input.month] ?? [];
  storeBudgets[input.month] = list;
  const index = list.findIndex(
    (item) => item.scope === input.scope && (item.category?.id ?? null) === input.categoryId,
  );
  if (index >= 0) {
    const existing = list[index] as BudgetItem;
    const updated = toBudgetItem(input, existing.id);
    list[index] = updated;
    return { ...updated, category: updated.category ? { ...updated.category } : null };
  }
  const created = toBudgetItem(input, nextBudgetId);
  nextBudgetId += 1;
  list.push(created);
  return { ...created, category: created.category ? { ...created.category } : null };
}

/**
 * 删除指定 id 的预算；不存在时静默返回，沿用 mock 的宽松语义。
 * @param id 预算 id
 */
export function mockDeleteBudget(id: number): void {
  for (const list of Object.values(storeBudgets)) {
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) {
      list.splice(index, 1);
      return;
    }
  }
}
