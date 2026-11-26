import { describe, expect, it } from 'vitest';
import { parseBatch } from '../../src/modules/ledger/validation.ts';

const baseRecord = {
  recordId: 'r1',
  userId: 'u1',
  direction: null,
  amount: 32.5,
  merchant: null,
  occurredAt: '2026-11-14T09:12:00+08:00',
  chatAt: null,
  rawText: '早上瑞幸花了32块5',
  modality: 'text',
  sourceRef: null,
  confidence: 0.9,
  idempotencyKey: 'k1'
};

const baseBatch = {
  version: 1,
  batchId: 'b1',
  sentAt: '2026-11-15T21:00:00+08:00',
  records: [baseRecord]
};

function withRecord(patch: Record<string, unknown>, batchPatch: Record<string, unknown> = {}) {
  return { ...baseBatch, ...batchPatch, records: [{ ...baseRecord, ...patch }] };
}

describe('parseBatch', () => {
  it('合法批次通过并规范化', () => {
    const result = parseBatch(baseBatch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batch.batchId).toBe('b1');
      expect(result.batch.records[0]?.amount).toBe(32.5);
    }
  });

  it('amount 为 null 合法（未识别）', () => {
    const result = parseBatch(withRecord({ amount: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batch.records[0]?.amount).toBeNull();
    }
  });

  it('amount 超出安全整数分范围拒收', () => {
    const unsafe = parseBatch(withRecord({ amount: Number.MAX_SAFE_INTEGER / 100 + 0.01 }));
    expect(unsafe).toMatchObject({ ok: false, field: 'records[0].amount' });

    const huge = parseBatch(withRecord({ amount: 1e20 }));
    expect(huge).toMatchObject({ ok: false, field: 'records[0].amount' });
  });

  it('amount 恰好落在安全整数分边界时通过', () => {
    const result = parseBatch(withRecord({ amount: Number.MAX_SAFE_INTEGER / 100 }));
    expect(result.ok).toBe(true);
  });

  it('amount 为非有限数或多位小数时拒收', () => {
    for (const amount of [Number.POSITIVE_INFINITY, Number.NaN, 12.345]) {
      expect(parseBatch(withRecord({ amount }))).toMatchObject({
        ok: false,
        field: 'records[0].amount'
      });
    }
  });

  it('version 非 1 拒收', () => {
    const result = parseBatch({ ...baseBatch, version: 2 });
    expect(result).toMatchObject({ ok: false, field: 'version' });
  });

  it('sentAt 缺失拒收', () => {
    const result = parseBatch({ ...baseBatch, sentAt: undefined });
    expect(result).toMatchObject({ ok: false, field: 'sentAt' });
  });

  it('sentAt 不带时区拒收', () => {
    const result = parseBatch({ ...baseBatch, sentAt: '2026-11-15T21:00:00' });
    expect(result).toMatchObject({ ok: false, field: 'sentAt' });
  });

  it('records 为空数组拒收', () => {
    const result = parseBatch({ ...baseBatch, records: [] });
    expect(result).toMatchObject({ ok: false, field: 'records' });
  });

  it('modality 非法拒收并指出字段', () => {
    const result = parseBatch(withRecord({ modality: 'video' }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].modality' });
  });

  it('direction 非法拒收', () => {
    const result = parseBatch(withRecord({ direction: 'transfer' }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].direction' });
  });

  it('金额超过两位小数拒收', () => {
    const result = parseBatch(withRecord({ amount: 12.345 }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].amount' });
  });

  it('金额为字符串拒收', () => {
    const result = parseBatch(withRecord({ amount: '32.5' }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].amount' });
  });

  it('缺 idempotencyKey 拒收', () => {
    const result = parseBatch(withRecord({ idempotencyKey: undefined }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].idempotencyKey' });
  });

  it('occurredAt 无时区拒收', () => {
    const result = parseBatch(withRecord({ occurredAt: '2026-11-14T09:12:00' }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].occurredAt' });
  });

  it('非法日历日期与 24:00 拒收', () => {
    const invalid = [
      '2026-02-31T12:00:00+08:00',
      '2026-04-31T12:00:00+08:00',
      '2025-02-29T12:00:00+08:00',
      '2026-01-01T24:00:00+08:00'
    ];
    for (const occurredAt of invalid) {
      expect(parseBatch(withRecord({ occurredAt }))).toMatchObject({
        ok: false,
        field: 'records[0].occurredAt'
      });
    }
  });

  it('闰年 2 月 29 日合法', () => {
    expect(parseBatch(withRecord({ occurredAt: '2024-02-29T12:00:00+08:00' })).ok).toBe(true);
  });

  it('超过 100 条拒收', () => {
    const records = Array.from({ length: 101 }, (_, index) => ({
      ...baseRecord,
      recordId: `r${index}`,
      idempotencyKey: `k${index}`
    }));
    const result = parseBatch({ ...baseBatch, records });
    expect(result).toMatchObject({ ok: false, field: 'records' });
  });

  it('普通消费携带还款拆分子段拒收', () => {
    const result = parseBatch(withRecord({ principalCents: 1000 }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].principalCents' });
  });

  it('退款携带还款拆分子段拒收', () => {
    const result = parseBatch(
      withRecord({ rawText: '退款 32.5', principalCents: 3250, repaymentPart: 'principal' })
    );
    expect(result).toMatchObject({ ok: false, field: 'records[0].principalCents' });
  });

  it('repaymentPart 非法拒收', () => {
    const result = parseBatch(withRecord({ rawText: '还款 32.5', repaymentPart: 'fee' }));
    expect(result).toMatchObject({ ok: false, field: 'records[0].repaymentPart' });
  });

  it('principalCents 非整数或为负拒收', () => {
    expect(parseBatch(withRecord({ rawText: '还款 32.5', principalCents: 1.5 }))).toMatchObject({
      ok: false,
      field: 'records[0].principalCents'
    });
    expect(parseBatch(withRecord({ rawText: '还款 32.5', principalCents: -1 }))).toMatchObject({
      ok: false,
      field: 'records[0].principalCents'
    });
  });

  it('mixed 缺 amount 拒收', () => {
    const result = parseBatch(
      withRecord({
        rawText: '还款 32.5',
        amount: null,
        repaymentPart: 'mixed',
        principalCents: 3000,
        interestCents: 250
      })
    );
    expect(result).toMatchObject({ ok: false, field: 'records[0].amount' });
  });

  it('mixed 本金与利息之和不等于 amount 拒收', () => {
    const result = parseBatch(
      withRecord({
        rawText: '还款 32.5',
        repaymentPart: 'mixed',
        principalCents: 3000,
        interestCents: 200
      })
    );
    expect(result).toMatchObject({ ok: false, field: 'records[0].principalCents' });
  });

  it('只给一个分字段时 amount 必须等于该字段', () => {
    expect(
      parseBatch(withRecord({ rawText: '还款 32.5', principalCents: 3000 }))
    ).toMatchObject({ ok: false, field: 'records[0].principalCents' });
    expect(
      parseBatch(withRecord({ rawText: '还款 32.5', interestCents: 3000 }))
    ).toMatchObject({ ok: false, field: 'records[0].interestCents' });
  });

  it('principal 与 interest 互斥', () => {
    expect(
      parseBatch(
        withRecord({ rawText: '还款 32.5', repaymentPart: 'principal', principalCents: 3250, interestCents: 250 })
      )
    ).toMatchObject({ ok: false, field: 'records[0].interestCents' });
    expect(
      parseBatch(
        withRecord({ rawText: '还款 32.5', repaymentPart: 'interest', principalCents: 3000, interestCents: 3250 })
      )
    ).toMatchObject({ ok: false, field: 'records[0].principalCents' });
  });

  it('合法的 mixed 与纯利息通过', () => {
    expect(
      parseBatch(
        withRecord({
          rawText: '还款 32.5',
          repaymentPart: 'mixed',
          principalCents: 3000,
          interestCents: 250
        })
      ).ok
    ).toBe(true);
    expect(
      parseBatch(
        withRecord({
          rawText: '还款 32.5',
          repaymentPart: 'interest',
          interestCents: 3250
        })
      ).ok
    ).toBe(true);
    expect(parseBatch(withRecord({ rawText: '还款 32.5', principalCents: 3250 })).ok).toBe(true);
  });
});
