import type { CategoryItem, StatsQuery, StatsResponse } from './types/contract';
import { formatCents } from './utils/money';

type Metric = 'expense' | 'income' | 'net' | 'top' | 'count';
interface Question { query: StatsQuery; metric: Metric; label: string }

const ALIASES: Record<string, string> = { 吃饭: '餐饮', 打车: '交通', 坐车: '交通', 看病: '医疗' };
const intents: [RegExp, Metric][] = [
  [/^(?:哪类花得最多|哪一类支出最多|最大支出类别)$/, 'top'],
  [/(?:项目收支净额|收支净额|净收支)(?:是多少|多少)?$/, 'net'],
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

/** 从原问句取回压缩语法时略过的类别名内空格。 */
function originalCategoryName(text: string, subject: string, compactLength: number): string {
  if (!compactLength) return '';
  const positions = Array.from(text.matchAll(/\S/g), match => match.index!);
  const start = positions.length - subject.length;
  return text.slice(positions[start], positions[start + compactLength - 1]! + 1);
}

function findNamedCategories(name: string, categories: readonly CategoryItem[]): CategoryItem[] {
  if (!name) return [];
  const withoutParticle = name.replace(/\s*的$/, '');
  const names = new Set([name, withoutParticle]);
  for (const candidate of names) {
    const exact = categories.filter(category => category.name === candidate);
    if (exact.length) return exact;
  }
  for (const candidate of names) {
    const compact = candidate.replace(/\s+/g, '');
    const matches = categories.filter(category => category.name.replace(/\s+/g, '') === compact);
    if (matches.length) return matches;
  }
  const alias = ALIASES[withoutParticle.replace(/\s+/g, '')];
  return categories.filter(category => category.name === alias);
}

/** 解析时间标签和类别字典，只向统计服务传参数。 */
export function parseQuestion(question: string, categories: readonly CategoryItem[], today: string): Question {
  const original = question.replace(/[？?。\s]+$/, '');
  const input = original.replace(/\s+/g, '').replace(/^(?:请问|帮我查一下)/, '');
  const match = /^(今天|本月|这个月|这月|上个月|上月|今年|去年|(?:最近|近)[7七]天|\d{4}年\d{1,2}月)(?:我(?:的)?)?(.+)$/.exec(input);
  if (!match) throw new Error('请指定一个时间，例如“上个月吃饭花了多少”或“近七天哪类花得最多”。');
  const [, time, subject] = match;
  const found = intents.find(([pattern]) => pattern.test(subject));
  if (!found) throw new Error('可以查支出、收入、净收支、笔数或支出最多的类别，请换个问法。');
  const [pattern, metric] = found;
  const name = originalCategoryName(original, subject, subject.replace(pattern, '').length);
  const direction = metric === 'top' ? 'expense' : metric === 'expense' || metric === 'income' ? metric : 'all';
  const matches = findNamedCategories(name, categories);
  if (name && name !== '的' && !matches.length) throw new Error(`类别列表中没有“${name}”，请核对类别名称。`);
  const selected = matches.filter(category => direction === 'all' || category.kind === direction);
  if (matches.length && !selected.length) throw new Error('这个类别与所问的收支方向不符，请核对。');
  if (new Set(selected.map(category => category.name)).size > 1) {
    throw new Error(`“${name}”与多个类别相似，请按类别原名输入。`);
  }
  const categoryIds = selected.length ? selected.map(category => category.id) : undefined;
  return {
    metric,
    label: time + (selected[0]?.name ?? ''),
    query: { ...period(time, today), direction, ...(categoryIds && { categoryIds }) },
  };
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
