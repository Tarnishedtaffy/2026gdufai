import { describe, it, expect } from 'vitest';
import { mockImportBatch } from './src/mock/import';
import { mockGetStats } from './src/mock/stats';
import { getMockTransactions, mockListTransactions, mockGetBudgets, mockGetCategories } from './src/mock/db';
import type { ImportRecord, FeedbackCode } from './src/types/contract';
import { contractFeedbackCodes } from './test-support/feedback-contract';

const base = {
  userId: 'u_demo', amount: 30, merchant: null,
  chatAt: '2026-11-16T20:00:00+08:00', rawText: '午饭 30 元',
  modality: 'text' as const, sourceRef: null, confidence: 0.9,
};
function rec(id: string, key: string, patch: Partial<ImportRecord> = {}): ImportRecord {
  return { ...base, recordId: id, idempotencyKey: key, direction: 'expense', occurredAt: '2026-11-16T12:00:00+08:00', ...patch };
}
const batch = (id: string, key: string, patch: Partial<ImportRecord> = {}) => ({
  version: 1 as const, batchId: 'b-' + id, sentAt: '2026-11-16T20:00:00+08:00', records: [rec(id, key, patch)],
});

describe('B1 反馈码对齐契约', () => {
  it('反馈码集合', async () => {
    const contractCodes = contractFeedbackCodes();
    expect(contractCodes.length).toBeGreaterThan(0);
    const { feedbackText } = await import('./src/types/contract');
    const keys = Object.keys(feedbackText).sort();
    expect(keys).toEqual(expect.arrayContaining(contractCodes));
  });
});

describe('B2 统计/账单/预算结构', () => {
  it('统计字段形状', () => {
    const s = mockGetStats({ dimension: 'recent7' });
    console.log('STATS range=', JSON.stringify(s.range));
    console.log('STATS summary keys=', Object.keys(s.summary).join(','));
    console.log('STATS summary=', JSON.stringify(s.summary));
    console.log('STATS bucket keys=', Object.keys(s.buckets[0]).join(','));
    console.log('STATS categories[0]=', JSON.stringify(s.buckets.find(b => b.categories.length)?.categories[0]));
    console.log('STATS meta=', JSON.stringify(s.meta));
    expect('start' in s.range && 'end' in s.range).toBe(true);
    expect('netCents' in s.summary).toBe(true);
    expect('period' in s.buckets[0]).toBe(true);
    expect(s.meta.unit).toBe('cent');
  });
  it('账单 filter 字段', () => {
    const r = mockListTransactions({ categoryId: 1, from: '2026-11-01', to: '2026-11-30' });
    console.log('TX filter=', JSON.stringify(r.filter));
    console.log('TX item keys=', Object.keys(r.items[0]).join(','));
    console.log('TX filter 条数=', r.items.length);
  });
  it('预算字段', () => {
    const list = mockGetBudgets('2026-11');
    console.log('BUDGET[0]=', JSON.stringify(list[0]));
  });
});

describe('B3 入站类型', () => {
  it('direction=null 触发 MISSING_DIRECTION，version 为数字', async () => {
    const r = (await mockImportBatch(batch('x1', 'k-null-dir', { direction: null }))).results[0];
    console.log('B3 null方向=', r.status, JSON.stringify(r.feedback.map(f => f.code)));
    expect(r.feedback.some(f => f.code === 'MISSING_DIRECTION')).toBe(true);
  });
  it('duplicate 反馈码为 DUPLICATE_RECORD', async () => {
    const r1 = (await mockImportBatch(batch('d1', 'k-dup'))).results[0];
    const r2 = (await mockImportBatch(batch('d2', 'k-dup'))).results[0];
    console.log('B3 duplicate=', r2.status, r2.transactionId === r1.transactionId, JSON.stringify(r2.feedback));
    expect(r2.feedback[0].code).toBe('DUPLICATE_RECORD');
  });
});

describe('B4 色值', () => {
  it('13 个色值逐字对齐契约', () => {
    const contract = ['#F97316','#3B82F6','#EC4899','#10B981','#8B5CF6','#EF4444','#F59E0B','#6B7280','#22C55E','#F472B6','#9CA3AF','#0EA5E9','#14B8A6'];
    const cats = mockGetCategories();
    const actual = cats.map(c => c.color);
    expect(cats).toHaveLength(13);
    expect(actual).toEqual(contract);
    expect(cats.every(c => 'isPreset' in c && 'isActive' in c)).toBe(true);
  });
});

describe('N5-N8', () => {
  it('N5 第4轮不复活', async () => {
    for (let i = 1; i <= 5; i++) {
      const r = (await mockImportBatch(batch('f' + i, 'k-follow', { amount: null }))).results[0];
      console.log('N5 轮', i, r.status, JSON.stringify(r.feedback.map(f => f.code)));
    }
  });
  it('N5 退款分支首轮追问新码', async () => {
    const r = (await mockImportBatch(batch('r1', 'k-refund', { rawText: '退款 30 元' }))).results[0];
    console.log('N5 退款=', r.status, JSON.stringify(r.feedback));
    expect(r.status).toBe('pending_followup');
    expect(r.feedback[0].code).toBe('MISSING_ORIGINAL_TRANSACTION');
    expect(r.feedback[0].field).toBe('originalTransactionId');
  });
  it('N8 收入类别推断（工资）', async () => {
    const r = (await mockImportBatch(batch('i1', 'k-income', { direction: 'income' }))).results[0];
    console.log('N8 收入类别=', JSON.stringify(r.category));
  });
});

it.each(['refund', 'repayment'] as const)('中性筛选 %s 的汇总为零', entryType => {
  expect(mockListTransactions({entryType}).summary).toEqual({count: 0, expenseCents: 0, incomeCents: 0});
});

it('已结清原单退款持续追问直至拒绝，原单及条数不变', async () => {
  const rows = getMockTransactions();
  const original = rows.find(x => x.status === 'confirmed' && (x.entryType ?? 'normal') === 'normal')!;
  const previous = original.settledAt;
  original.settledAt = original.occurredAt;
  const before = { ...original };
  const count = rows.length;
  try {
    for (const status of ['pending_followup', 'pending_followup', 'rejected']) {
      const result = await mockImportBatch(batch('settled', 'settled-key', { rawText: '退款 30 元', originalTransactionId: original.id }));
      expect(result.results[0]).toMatchObject({ status, transactionId: null, feedback: [{code: 'ORIGINAL_ALREADY_SETTLED'}] });
    }
    expect(original).toEqual(before);
    expect(rows).toHaveLength(count);
  } finally { original.settledAt = previous; }
});
