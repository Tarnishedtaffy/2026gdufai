import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { listTransactions } from './src/api/index';
import { mockListTransactions } from './src/mock/db';
import type { TransactionListResponse } from './src/types/contract';
import TransactionsView from './src/views/TransactionsView.vue';
import { allNodes, dispatch, findNode, mountUi, visibleText, type TestNode } from './test-support/app-renderer';

vi.mock('./src/api/index', async importOriginal => ({
  ...(await importOriginal<typeof import('./src/api/index')>()),
  listTransactions: vi.fn(),
}));

const base = mockListTransactions({ limit: 1 });
const list = vi.mocked(listTransactions);

function page(merchant: string, nextCursor: string | null = null): TransactionListResponse {
  return { ...base, items: [{ ...base.items[0]!, id: merchant, merchant }],
    page: { ...base.page, hasMore: nextCursor !== null, nextCursor } };
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
}

function button(root: TestNode, text: string): TestNode {
  return allNodes(root).find(node => node.kind === 'button' && visibleText(node).trim() === text)!;
}

beforeEach(() => {
  vi.stubGlobal('Document', class {});
  vi.stubGlobal('ShadowRoot', class {});
  vi.stubGlobal('document', { activeElement: null });
});

afterEach(() => {
  list.mockReset();
  vi.unstubAllGlobals();
});

it.each(['成功', '失败'])('修改筛选后忽略旧分页的%s回执', async outcome => {
  const pending = Promise.withResolvers<TransactionListResponse>();
  list.mockResolvedValueOnce(page('旧类别首页', 'old-cursor'))
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(page('餐饮筛选结果', 'filtered-cursor'))
    .mockResolvedValueOnce(page('餐饮追加结果'));
  const mounted = mountUi(TransactionsView, {});
  try {
    await settle();
    const loadingOldPage = dispatch(button(mounted.root, '加载更多'), 'click');
    await nextTick();
    const filter = findNode(mounted.root, 'tx-cat-select');
    const category = filter.options.find(option => typeof option.value === 'number')!;
    for (const option of filter.options) option.selected = option === category;
    await dispatch(filter, 'change');
    expect(visibleText(mounted.root)).toContain('餐饮筛选结果');
    expect(list.mock.calls[2]?.[0]).toMatchObject({ categoryId: category.value, cursor: null });

    if (outcome === '成功') pending.resolve(page('旧类别第二页', 'stale-cursor'));
    else pending.reject(new Error('旧分页错误'));
    await loadingOldPage;
    expect(visibleText(mounted.root)).not.toContain('旧类别第二页');
    expect(visibleText(mounted.root)).not.toContain('旧分页错误');
    expect(visibleText(mounted.root)).toContain('餐饮筛选结果');

    await dispatch(button(mounted.root, '加载更多'), 'click');
    expect(list.mock.calls[3]?.[0]).toMatchObject({ categoryId: category.value, cursor: 'filtered-cursor' });
    expect(visibleText(mounted.root)).toContain('餐饮追加结果');
  } finally {
    pending.resolve(page('旧类别第二页'));
    mounted.unmount();
  }
});

it('下一页失败时保留首屏账单，重试原游标且只追加一页', async () => {
  list.mockResolvedValueOnce(page('首屏账单', 'next-cursor'))
    .mockRejectedValueOnce(new Error('下一页暂不可用'))
    .mockResolvedValueOnce(page('第二页账单'));
  const mounted = mountUi(TransactionsView, {});
  try {
    await settle();
    await dispatch(button(mounted.root, '加载更多'), 'click');
    expect(visibleText(mounted.root)).toContain('首屏账单');
    expect(visibleText(mounted.root)).toContain('下一页暂不可用');
    await dispatch(button(mounted.root, '重试加载更多'), 'click');
    expect(list.mock.calls.map(([query]) => query?.cursor)).toEqual([null, 'next-cursor', 'next-cursor']);
    const listText = visibleText(mounted.root);
    expect(listText).toContain('首屏账单');
    expect(listText).toContain('第二页账单');
    expect(listText).not.toContain('下一页暂不可用');
  } finally {
    mounted.unmount();
  }
});
