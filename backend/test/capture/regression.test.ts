import { describe, expect, it, vi } from 'vitest';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { ImportBatch } from '../../src/modules/capture/index.ts';
import { context, draft, idGenerator, response } from './helpers.ts';

describe('M1 草稿合并与附件引用回归', () => {
  it.each([90071992547409.92, -90071992547409.92, Number.MAX_SAFE_INTEGER])(
    '拒绝无法用安全整数分表示的金额 %s，且不修改已有草稿或调用 M2', amount => {
      const importBatch = vi.fn();
      const session = createCaptureSession({ importBatch, newId: idGenerator() });
      const original = session.prepare(context, [draft()]);
      expect(() => session.prepare(context, [draft({ amount })])).toThrow('金额超出');
      expect(() => session.update(original.records[0]!.record.recordId, { amount })).toThrow('金额超出');
      expect(session.getSnapshot()).toEqual(original);
      expect(importBatch).not.toHaveBeenCalled();
    },
  );

  it.each([Number.MAX_SAFE_INTEGER / 100, -(Number.MAX_SAFE_INTEGER / 100), -12.5, 0, null])(
    '安全边界内金额 %s 原样传递，零与负数留给 M2 按契约处理', async amount => {
      const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
      const session = createCaptureSession({ importBatch, newId: idGenerator() });
      session.prepare(context, [draft({ amount })]);
      await session.submit();
      expect(importBatch.mock.calls[0]![0].records[0]!.amount).toBe(amount);
    },
  );

  it('补充中的 undefined 不会清除已确认字段，提交仍保留原值', async () => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const original = draft({
      merchant: '虚构商户', occurredAt: '2026-11-17T12:34:56+08:00',
      direction: 'expense', confidence: 0.91, modality: 'voice', sourceRef: 'uploads/demo-voice.wav',
    });
    const prepared = session.prepare(context, [original]);
    const recordId = prepared.records[0]!.record.recordId;
    const updated = session.update(recordId, {
      amount: 18, merchant: undefined, occurredAt: undefined, direction: undefined,
      confidence: undefined, rawText: undefined, modality: undefined, sourceRef: undefined,
    });
    expect(updated.records[0]!.record).toEqual({ ...prepared.records[0]!.record, amount: 18 });
    await session.submit();
    expect(importBatch.mock.calls[0]![0].records[0]).toEqual(updated.records[0]!.record);
  });

  it('显式 null 仍清空对应字段，不改写身份或未指定字段', () => {
    const session = createCaptureSession({ importBatch: vi.fn(), newId: idGenerator() });
    const prepared = session.prepare(context, [draft({
      merchant: '虚构商户', occurredAt: '2026-11-17T12:34:56+08:00',
      direction: 'expense', confidence: 0.91, modality: 'image', sourceRef: 'uploads/demo-receipt.png',
    })]);
    const recordId = prepared.records[0]!.record.recordId;
    const cleared = { amount: null, merchant: null, occurredAt: null, direction: null, confidence: null, sourceRef: null };
    expect(session.update(recordId, cleared).records[0]!.record).toEqual({
      ...prepared.records[0]!.record, ...cleared,
    });
  });

  const inlineSources = [
    'data:application/octet-stream;base64,AAAA',
    'DATA:application/octet-stream;base64,AAAA',
    '  data:application/octet-stream;base64,AAAA',
    '\t DaTa:application/octet-stream;base64,AAAA',
  ];
  for (const modality of ['voice', 'image'] as const) {
    it.each(inlineSources)(`${modality} 草稿拒绝内联附件 %s`, sourceRef => {
      const importBatch = vi.fn();
      const session = createCaptureSession({ importBatch, newId: idGenerator() });
      expect(() => session.prepare(context, [draft({ modality, sourceRef })])).toThrow('不能内联文件内容');
      expect(session.getSnapshot().phase).toBe('empty');
      expect(importBatch).not.toHaveBeenCalled();
    });

    it(`${modality} 保留既有文件引用，不限制为新格式`, () => {
      const session = createCaptureSession({ importBatch: vi.fn(), newId: idGenerator() });
      const sourceRef = modality === 'voice' ? 'uploads/demo-voice.wav' : 'uploads/demo-receipt.png';
      expect(session.prepare(context, [draft({ modality, sourceRef })]).records[0]!.record.sourceRef).toBe(sourceRef);
    });
  }
});
