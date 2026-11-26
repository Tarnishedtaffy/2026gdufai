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

it('通过网页提交问句并向真实模式的统计客户端传递类别和月份', async () => {
  const result = mockGetStats({dimension:'month', month:'2026-11', categoryIds:[1]});
  const fetcher = vi.fn(async (url: string) => Response.json(url.includes('/categories') ? MOCK_CATEGORIES : result));
  vi.stubEnv('VITE_USE_MOCK','false');
  vi.stubGlobal('fetch',fetcher);
  vi.stubGlobal('Document',class {});
  vi.stubGlobal('ShadowRoot',class {});
  vi.stubGlobal('document',{activeElement:null});
  const mounted = mountUi(QueryPanel,{});
  try {
    await dispatch(findNode(mounted.root,'ledger-question'),'input','2026年11月吃饭花了多少');
    const form = allNodes(mounted.root).find(node => node.kind === 'form')!;
    await dispatch(form,'submit');
    await new Promise(resolve=>setTimeout(resolve,0));
    await nextTick();
    expect(fetcher.mock.calls.some(([url]) => url.includes('categoryIds=1') && url.includes('month=2026-11'))).toBe(true);
    expect(visibleText(mounted.root)).toContain('2026年11月餐饮支出为');
    expect((await getStats({dimension:'recent7'})).summary).toEqual(result.summary);
  } finally {
    mounted.unmount();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
