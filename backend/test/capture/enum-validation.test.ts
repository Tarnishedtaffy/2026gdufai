import { describe, expect, it, vi } from 'vitest';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { CaptureDraft, ImportBatch } from '../../src/modules/capture/index.ts';
import { context, draft, idGenerator, response } from './helpers.ts';

describe('M1 枚举边界不执行字符串强制转换', () => {
  it.each([
    ['confirmed'], ['duplicate'], ['pending_followup'], ['rejected'], [['confirmed']],
    [], null, 1, true, {}, 'unknown',
  ].map(status => ({ status })))('拒绝非法 status $status，整批不应用并保留原载荷重试', async ({ status }) => {
    const importBatch = vi.fn(async (batch: ImportBatch): Promise<unknown> => response(batch));
    importBatch.mockImplementationOnce(async batch => {
      const valid = response(batch);
      return JSON.parse(JSON.stringify({ ...valid, results: [valid.results[0], {
        ...valid.results[1], status, transactionId: null,
      }] }));
    });
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    session.prepare(context, [draft(), draft()]);
    const failed = await session.submit();
    expect(failed.phase).toBe('retry');
    expect(failed.records.every(row => row.result === null && row.messages.length === 0)).toBe(true);
    expect(failed.error).toContain('M2 处理结果无效');
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch).toHaveBeenCalledTimes(2);
    expect(importBatch.mock.calls[1]![0]).toEqual(importBatch.mock.calls[0]![0]);
  });

  it.each([
    ['text'], ['voice'], ['image'], [['text']], [], null, 1, true, {}, 'unknown',
  ].map(modality => ({ modality })))('拒绝非法 modality $modality，准备和修改均不污染旧草稿', ({ modality }) => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    const original = session.prepare(context, [draft()]);
    const invalid = JSON.parse(JSON.stringify({ ...draft(), modality })) as CaptureDraft;
    expect(() => session.prepare(context, [invalid])).toThrow('输入形态无效');
    expect(session.getSnapshot()).toEqual(original);
    expect(() => session.update(original.records[0]!.record.recordId, { modality: invalid.modality }))
      .toThrow('输入形态无效');
    expect(session.getSnapshot()).toEqual(original);
    expect(importBatch).not.toHaveBeenCalled();
  });

  it.each(['confirmed', 'duplicate', 'pending_followup', 'rejected'] as const)(
    '合法字符串状态 %s 保持原有处理行为', async status => {
      const session = createCaptureSession({ newId: idGenerator(), importBatch: async batch => response(batch, [{
        status, transactionId: status === 'confirmed' || status === 'duplicate' ? 'tx_demo' : null,
      }]) });
      session.prepare(context, [draft()]);
      const snapshot = await session.submit();
      expect(snapshot.records[0]!.result?.status).toBe(status);
      expect(snapshot.phase).toBe(status === 'pending_followup' ? 'pending_followup' : 'complete');
    },
  );

  it.each(['confirmed', 'duplicate'] as const)('%s 仍必须携带账单标识', async status => {
    const session = createCaptureSession({ newId: idGenerator(), importBatch: async batch =>
      response(batch, [{ status, transactionId: null }]) });
    session.prepare(context, [draft()]);
    expect(await session.submit()).toMatchObject({ phase: 'retry', error: 'M2 成功结果缺少账单标识。' });
    expect(session.getSnapshot().records[0]!.result).toBeNull();
  });

  it.each(['text', 'voice', 'image'] as const)('合法输入形态 %s 原样提交', async modality => {
    const importBatch = vi.fn(async (batch: ImportBatch) => response(batch));
    const session = createCaptureSession({ importBatch, newId: idGenerator() });
    session.prepare(context, [draft({ modality })]);
    expect((await session.submit()).phase).toBe('complete');
    expect(importBatch.mock.calls[0]![0].records[0]!.modality).toBe(modality);
  });
});
