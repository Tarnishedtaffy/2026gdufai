import type { CategoryItem, StatsQuery, StatsResponse } from './types/contract';
import { formatCents } from './utils/money';

type Metric = 'expense' | 'income' | 'net' | 'top' | 'count';
interface Question { query: StatsQuery; metric: Metric; label: string }

const aliases: Record<string, string> = { 吃饭: '餐饮', 打车: '交通', 坐车: '交通', 看病: '医疗' };
const intents: [RegExp, Metric][] = [
  [/^(?:哪类花得最多|哪一类支出最多|最大支出类别)$/, 'top'],
  [/^(?:项目收支净额|收支净额|净收支)(?:是多少|多少)?$/, 'net'],
  [/(?:有几笔|有多少笔|共几笔)$/, 'count'],
  [/(?:收入了多少|收入多少|收入是多少|赚了多少)(?:钱|元)?$/, 'income'],
  [/(?:花了多少|花费多少|支出了多少|支出多少|支出是多少)(?:钱|元)?$/, 'expense'],
];

function period(word: string, today: string): StatsQuery {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (word === '今天') return { dimension: 'day', date: today };
  if (word === '今年' || word === '去年') return { dimension: 'year', year: String(word === '今年' ? y : y - 1) };
  if (/^(近|最近)/.test(word)) return { dimension: 'recent7' };
  if (/^上/.test(word)) return { dimension: 'month', month: m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` };
  if (/^\d/.test(word)) {
    const [, year, month] = /^(\d{4})年(\d{1,2})月$/.exec(word)!;
    if (+month < 1 || +month > 12) throw new Error('月份须在 1 到 12 之间。');
    return { dimension: 'month', month: `${year}-${month.padStart(2, '0')}` };
  }
  return { dimension: 'month', month: today.slice(0, 7) };
}

/** 解析时间标签和类别字典，只向统计服务传参数。 */
export function parseQuestion(question: string, categories: readonly CategoryItem[], today: string): Question {
  const input = question.trim().replace(/\s+/g, '').replace(/[？?。]+$/, '').replace(/^(?:请问|帮我查一下)/, '');
  const match = /^(今天|本月|这个月|这月|上个月|上月|今年|去年|(?:最近|近)[7七]天|\d{4}年\d{1,2}月)(?:我(?:的)?)?(.+)$/.exec(input);
  if (!match) throw new Error('请指定一个时间，例如“上个月吃饭花了多少”或“近七天哪类花得最多”。');
  const [, time, subject] = match;
  const found = intents.find(([pattern]) => pattern.test(subject));
  if (!found) throw new Error('可以查支出、收入、净收支、笔数或支出最多的类别，请换个问法。');
  const [pattern, metric] = found;
  const name = subject.replace(pattern, '').replace(/的$/, '');
  const category = name ? categories.find(c => c.name === name) ?? categories.find(c => c.name === aliases[name]) : undefined;
  if (name && !category) throw new Error(`类别列表中没有“${name}”，请核对类别名称。`);
  const direction = metric === 'top' ? 'expense' : metric === 'expense' || metric === 'income' ? metric : 'all';
  if (category && direction !== 'all' && category.kind !== direction) throw new Error('这个类别与所问的收支方向不符，请核对。');
  return { metric, label: time + (category?.name ?? ''), query: { ...period(time, today), direction, ...(category && { categoryIds: [category.id] }) } };
}

/** 所有数值均来自统计回执，金额单位只在展示时换算。 */
export function answerQuestion(question: Question, stats: StatsResponse): string {
  const { label, metric } = question;
  if (stats.meta.isEmpty) return `${label}没有符合条件的记录。`;
  const s = stats.summary;
  if (!s.count) return `${label}有记录，计入收支的有 0 笔。`;
  if (metric === 'count') return `${label}计入收支的有 ${s.count} 笔。`;
  if (metric === 'top') return s.topCategory ? `${label}支出最多的是${s.topCategory.name}，共 ${formatCents(s.topCategory.totalCents)}。` : `${label}没有可比较的支出类别。`;
  const [title, cents] = metric === 'net' ? ['项目收支净额', s.netCents] as const : metric === 'income' ? ['收入', s.incomeCents] as const : ['支出', s.expenseCents] as const;
  return `${label}${title}为 ${formatCents(cents)}。`;
}
