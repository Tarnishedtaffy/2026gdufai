import type { CaptureContext, CaptureDraft, CaptureResult, ImportBatch } from '../../src/modules/capture/index.ts';

export const context: CaptureContext = {
  sessionId: 'session_demo', userId: 'u_demo', sentAt: '2026-11-17T09:00:00+08:00', chatAt: null,
};

export function draft(patch: Partial<CaptureDraft> = {}): CaptureDraft {
  return {
    rawText: '早餐 12.50 元', modality: 'text', amount: 12.5,
    merchant: null, direction: null, occurredAt: null, sourceRef: null, confidence: null, ...patch,
  };
}

export function response(batch: ImportBatch, patches: Partial<CaptureResult>[] = []) {
  return {
    batchId: batch.batchId,
    results: batch.records.map((record, index): CaptureResult => ({
      recordId: record.recordId, status: 'confirmed', transactionId: `tx_${record.recordId}`,
      direction: 'expense', occurredAt: '2026-11-17T08:00:00+08:00', category: null,
      confidence: null, feedback: [], ...patches[index],
    })),
  };
}

export function idGenerator(): () => string {
  let serial = 0;
  return () => String(++serial);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
