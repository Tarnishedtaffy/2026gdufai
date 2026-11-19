import { feedbackMessages } from './feedback.ts';
import { importFailureMessage, readContext, readDraft, readPatch, readResponse } from './validation.ts';
import type { CaptureContext, CaptureDependencies, CaptureSession, CaptureSnapshot, ImportBatch } from './types.ts';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * M1 内部流程提案：确认前只保存草稿，submit 才调用现有 M2 契约。
 * 网络或回执不确定时冻结原批次，防止修改已可能入库的数据后复用幂等键。
 */
export function createCaptureSession(deps: CaptureDependencies): CaptureSession {
  let state: CaptureSnapshot = { phase: 'empty', sessionId: null, batchId: null, records: [], error: null };
  let context: CaptureContext | null = null;
  let pendingBatch: ImportBatch | null = null;
  let inFlight: Promise<CaptureSnapshot> | null = null;
  const identifiers = new Set<string>();
  const getSnapshot = (): CaptureSnapshot => copy(state);

  function newIdentifier(prefix: string): string {
    const value = deps.newId();
    if (typeof value !== 'string' || !value.trim()) throw new Error('ID 生成器必须返回非空字符串。');
    const identifier = `${prefix}_${value}`;
    if (identifiers.has(identifier)) throw new Error('ID 生成器返回了重复标识。');
    identifiers.add(identifier);
    return identifier;
  }

  function assertResolved(): void {
    if (pendingBatch || inFlight) throw new Error('原提交结果尚未确认，请先重试原提交。');
  }

  /** 仅清理本地状态，不向 M2 发请求或撤销账单；保留 ID 历史以防新一笔复用旧身份。 */
  const discard: CaptureSession['discard'] = () => {
    if (inFlight) throw new Error('提交仍在进行，请等待本次请求结束后再放弃本地记录。');
    context = null;
    pendingBatch = null;
    state = { phase: 'empty', sessionId: null, batchId: null, records: [], error: null };
    return getSnapshot();
  };

  const prepare: CaptureSession['prepare'] = (value, drafts) => {
    assertResolved();
    if (state.phase === 'pending_followup') throw new Error('请先处理当前待追问记录。');
    if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('至少需要一条识别草稿。');
    const nextContext = readContext(value);
    const checked = drafts.map(readDraft);
    const records = checked.map(draft => {
      const recordId = newIdentifier('r');
      return {
        record: { ...draft, recordId, userId: nextContext.userId, chatAt: nextContext.chatAt,
          idempotencyKey: `${nextContext.sessionId}:${recordId}` },
        result: null, messages: [],
      };
    });
    context = nextContext;
    state = { phase: 'draft', sessionId: context.sessionId, batchId: null, records, error: null };
    return getSnapshot();
  };

  const update: CaptureSession['update'] = (recordId, patch) => {
    assertResolved();
    const item = state.records.find(row => row.record.recordId === recordId);
    if (!item) throw new Error('找不到需要修改的记录。');
    if (item.result && item.result.status !== 'pending_followup') throw new Error('该记录已处理完成，不能再次提交。');
    const draft = readDraft({ ...item.record, ...readPatch(patch) });
    item.record = { ...item.record, ...draft };
    state.error = null;
    return getSnapshot();
  };

  const submit: CaptureSession['submit'] = () => {
    if (inFlight) return inFlight;
    if (!context || state.phase === 'empty') return Promise.reject(new Error('请先准备并确认识别草稿。'));
    if (state.phase === 'complete') return Promise.resolve(getSnapshot());
    if (!pendingBatch) {
      const records = state.records.filter(item => !item.result || item.result.status === 'pending_followup')
        .map(item => copy(item.record));
      pendingBatch = { version: 1, batchId: newIdentifier('b'), sentAt: context.sentAt, records };
    }
    const batch = pendingBatch;
    state.phase = 'submitting';
    state.batchId = batch.batchId;
    state.error = null;
    inFlight = Promise.resolve().then(() => deps.importBatch(copy(batch))).then(response => {
      const results = readResponse(response, batch);
      const byId = new Map(results.map(result => [result.recordId, result]));
      for (const item of state.records) {
        const result = byId.get(item.record.recordId);
        if (result) { item.result = result; item.messages = feedbackMessages(result); }
      }
      pendingBatch = null;
      state.phase = state.records.some(item => item.result?.status === 'pending_followup') ? 'pending_followup' : 'complete';
      return getSnapshot();
    }).catch((error: unknown) => {
      state.phase = 'retry';
      state.error = importFailureMessage(error);
      return getSnapshot();
    }).finally(() => { inFlight = null; });
    return inFlight;
  };

  return { prepare, update, submit, discard, getSnapshot };
}
