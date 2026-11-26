import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { allNodes, dispatch, findNode, mountUi, visibleText } from './test-support/app-renderer';
import type { BudgetItem, CategoryItem } from './src/types/contract';

vi.mock('./src/api/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./src/api/index')>()),
  getBudgets: vi.fn(),
  getCategories: vi.fn(),
  putBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

import { deleteBudget, getBudgets, getCategories, putBudget } from './src/api/index';
import BudgetForm from './src/components/BudgetForm.vue';
import BudgetView from './src/views/BudgetView.vue';
import { mockDeleteBudget, mockGetBudgets, mockPutBudget } from './src/mock/db';

const categories: CategoryItem[] = [
  { id: 1, name: '餐饮', kind: 'expense', color: '#f97316', icon: 'food', isPreset: true, isActive: true },
  { id: 2, name: '工资', kind: 'income', color: '#16a34a', icon: 'money', isPreset: true, isActive: true },
];

const novemberBudget: BudgetItem = {
  id: 11,
  scope: 'total',
  category: null,
  amountCents: 150000,
  spentCents: 117000,
  remainingCents: 33000,
  usageRatio: 0.78,
  level: 'normal',
  alertThresholds: [80, 100],
};

/** 等待 onMounted 中的异步加载完成。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

function buttonByText(root: Parameters<typeof visibleText>[0], text: string) {
  const button = allNodes(root).find((node) => node.kind === 'button' && visibleText(node).includes(text));
  if (!button) {
    throw new Error(`找不到按钮 ${text}`);
  }
  return button;
}

beforeEach(() => {
  vi.stubGlobal('Document', class Document {});
  vi.stubGlobal('ShadowRoot', class ShadowRoot {});
  vi.stubGlobal('document', { activeElement: null });
  vi.mocked(getCategories).mockReset().mockResolvedValue(categories);
  vi.mocked(getBudgets).mockReset().mockImplementation(async (month) => (month === '2026-11' ? [novemberBudget] : []));
  vi.mocked(putBudget).mockReset().mockResolvedValue(novemberBudget);
  vi.mocked(deleteBudget).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('切换月份时退出编辑态，不会把旧预算保存到新月份', async () => {
  const mounted = mountUi(BudgetView, {});
  try {
    await settle();
    const monthInput = findNode(mounted.root, 'budget-month-input');
    await dispatch(monthInput, 'input', '2026-11');
    await dispatch(monthInput, 'change');
    await settle();
    expect(visibleText(mounted.root)).toContain('月度总预算');

    await dispatch(buttonByText(mounted.root, '编辑'), 'click');
    expect(visibleText(mounted.root)).toContain('保存修改');
    expect(findNode(mounted.root, 'budget-amount').value).toBe('1500.00');

    await dispatch(monthInput, 'input', '2026-12');
    await dispatch(monthInput, 'change');
    await settle();

    expect(visibleText(mounted.root)).not.toContain('保存修改');
    expect(visibleText(mounted.root)).toContain('新增预算');
    expect(findNode(mounted.root, 'budget-amount').value).toBe('');
    expect(vi.mocked(getBudgets)).toHaveBeenLastCalledWith('2026-12');
  } finally {
    mounted.unmount();
  }
});

it('校验预算金额与阈值，合法输入按分提交', async () => {
  const mounted = mountUi(BudgetForm, { month: '2026-11', categories, editing: null });
  try {
    const form = allNodes(mounted.root).find((node) => node.kind === 'form');
    if (!form) {
      throw new Error('找不到预算表单');
    }
    await dispatch(findNode(mounted.root, 'budget-amount'), 'input', '0');
    await dispatch(form, 'submit');
    expect(visibleText(mounted.root)).toContain('请输入大于 0 的预算金额');
    expect(putBudget).not.toHaveBeenCalled();

    await dispatch(findNode(mounted.root, 'budget-amount'), 'input', '1200.50');
    await dispatch(findNode(mounted.root, 'budget-thresholds'), 'input', '100,80,80');
    await dispatch(form, 'submit');
    await settle();

    expect(putBudget).toHaveBeenCalledWith({
      month: '2026-11',
      scope: 'total',
      categoryId: null,
      amountCents: 120050,
      alertThresholds: [80, 100],
    });
  } finally {
    mounted.unmount();
  }
});

it('mock 预算按 key 幂等覆盖并可删除', () => {
  const first = mockPutBudget({
    month: '2030-01',
    scope: 'total',
    categoryId: null,
    amountCents: 10000,
    alertThresholds: [80],
  });
  const second = mockPutBudget({
    month: '2030-01',
    scope: 'total',
    categoryId: null,
    amountCents: 20000,
    alertThresholds: [],
  });

  expect(second.id).toBe(first.id);
  expect(mockGetBudgets('2030-01')).toEqual([second]);
  expect(second.remainingCents).toBe(20000);

  mockDeleteBudget(second.id);
  expect(mockGetBudgets('2030-01')).toEqual([]);
});
