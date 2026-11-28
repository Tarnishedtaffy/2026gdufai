import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { answerQuestion, parseQuestion } from './src/query';
import { getStats } from './src/api';
import { mockGetStats } from './src/mock/stats';
import { MOCK_CATEGORIES } from './src/mock/data';
import QueryPanel from './src/components/QueryPanel.vue';
import { allNodes, dispatch, findNode, mountUi, visibleText } from './test-support/app-renderer';

it('跨年解析相对月份，使用当前类别字典中的 ID', () => {
  const cats = [{...MOCK_CATEGORIES[0], id: 91}];
  expect(parseQuestion('请问上个月吃饭花了多少钱？', cats, '2026-01-03').query)
    .toEqual({dimension:'month', month:'2025-12', direction:'expense', categoryIds:[91]});
  expect(() => parseQuestion('本月火星花了多少', cats, '2026-01-03')).toThrow('类别');
  expect(() => parseQuestion('本月和上月吃饭花了多少', cats, '2026-01-03')).toThrow();
});

it('单日、近七天和年度均使用契约维度，空区间与只有中性记录可区分', () => {
  const parse = (q: string) => parseQuestion(q, MOCK_CATEGORIES, '2026-11-26');
  expect(parse('今天支出多少').query.date).toBe('2026-11-26');
  expect(parse('去年收入多少').query.year).toBe('2025');
  const question = parse('近七天哪类花得最多');
  expect(question.query).toEqual({dimension:'recent7',direction:'expense'});
  const stats = mockGetStats({dimension:'year',year:'2040'});
  expect(answerQuestion(question, stats)).toContain('没有符合条件的记录');
  expect(answerQuestion(question, {...stats,meta:{...stats.meta,isEmpty:false}})).toContain('计入收支的有 0 笔');
});

it.each([
  { question: '2026年11月吃饭花了多少', categoryId: 1, label: '餐饮' },
  { question: '2026年11月 Coffee Budget 花了多少', categoryId: 91, label: 'Coffee Budget' },
])('通过网页向统计客户端传递类别和月份（$label）', async ({ question, categoryId, label }) => {
  const result = mockGetStats({dimension:'month', month:'2026-11', categoryIds:[1]});
  const categories = [...MOCK_CATEGORIES,
    { ...MOCK_CATEGORIES[0], name: 'Coffee Budget', id: 91 },
    { ...MOCK_CATEGORIES[0], name: 'CoffeeBudget', id: 92 },
  ];
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes('/categories') ? categories : result));
  vi.stubEnv('VITE_USE_MOCK','false');
  vi.stubGlobal('fetch',fetcher);
  vi.stubGlobal('Document',class {});
  vi.stubGlobal('ShadowRoot',class {});
  vi.stubGlobal('document',{activeElement:null});
  const mounted = mountUi(QueryPanel,{});
  try {
    await dispatch(findNode(mounted.root,'ledger-question'),'input',question);
    const form = allNodes(mounted.root).find(node => node.kind === 'form')!;
    await dispatch(form,'submit');
    await new Promise(resolve=>setTimeout(resolve,0));
    await nextTick();
    expect(fetcher.mock.calls.some(([url]) => new URLSearchParams(url.split('?')[1]).get('categoryIds') === String(categoryId) && url.includes('month=2026-11'))).toBe(true);
    expect(visibleText(mounted.root)).toContain(`2026年11月${label}支出为`);
    expect((await getStats({dimension:'recent7'})).summary).toEqual(result.summary);
  } finally {
    mounted.unmount();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it('同名的收入和支出类别按方向选择，收支净额纳入两侧', () => {
  const categories = [
    { ...MOCK_CATEGORIES[8], name: '报销', id: 81, kind: 'income' as const },
    { ...MOCK_CATEGORIES[0], name: '报销', id: 82, kind: 'expense' as const },
  ];
  const parse = (question: string) => parseQuestion(question, categories, '2026-11-26');
  expect(parse('本月报销花了多少').query.categoryIds).toEqual([82]);
  expect(parse('本月报销收入多少').query.categoryIds).toEqual([81]);
  expect(parse('本月报销净收支多少').query.categoryIds).toEqual([81, 82]);
  expect(parse('本月报销有几笔').query.categoryIds).toEqual([81, 82]);
});

it('类别包含空格时，优先匹配原名并保留问句中其他位置的空格容忍', () => {
  const categories = [
    { ...MOCK_CATEGORIES[0], name: 'Coffee Budget', id: 91 },
    { ...MOCK_CATEGORIES[0], name: 'CoffeeBudget', id: 92 },
  ];
  expect(parseQuestion('请 问 2026 年 11 月 我的 Coffee Budget 花了多少？', categories, '2026-11-28'))
    .toMatchObject({ query: { month: '2026-11', categoryIds: [91] }, label: '2026年11月Coffee Budget' });
  expect(parseQuestion(' 本月 CoffeeBudget 花了多少 ', categories, '2026-11-28').query.categoryIds).toEqual([92]);
});

it('精确匹配以“的”结尾的类别，也能识别类别后作为语法助词的“的”', () => {
  const categories = [
    { ...MOCK_CATEGORIES[0], name: '家用的', id: 93 },
    { ...MOCK_CATEGORIES[0], name: '旅行', id: 94 },
  ];
  expect(parseQuestion('本月家用的花了多少', categories, '2026-11-28').query.categoryIds).toEqual([93]);
  expect(parseQuestion('本月旅行的支出多少', categories, '2026-11-28').query.categoryIds).toEqual([94]);
});

it('忽略多余空格时遇到多个不同类别，提示按原名输入', () => {
  const categories = [
    { ...MOCK_CATEGORIES[0], name: '出行 费用', id: 95 },
    { ...MOCK_CATEGORIES[0], name: '出 行费用', id: 96 },
  ];
  const parse = (q: string) => parseQuestion(q, categories, '2026-11-28');
  expect(() => parse('本月出行费用花了多少')).toThrow('按类别原名');
  expect(parse('本月出行 费用花了多少').query.categoryIds).toEqual([95]);
});
