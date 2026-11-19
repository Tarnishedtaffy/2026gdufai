/** M1 内部接入提案，供识别与前端同学确认；外部字段遵循当前冻结的接口契约。 */
export interface CaptureDraft {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null;
  direction: 'expense' | 'income' | null;
  confidence: number | null;
  rawText: string;
  modality: 'text' | 'voice' | 'image';
  sourceRef: string | null;
}

/** 身份和原消息时间由程序提供，识别结果不能覆盖。 */
export interface CaptureContext {
  sessionId: string;
  userId: string;
  sentAt: string;
  chatAt: string | null;
}

/** 契约 §1.3 的入站记录；amount 始终使用元。 */
export interface ImportRecord extends CaptureDraft {
  recordId: string;
  userId: string;
  chatAt: string | null;
  idempotencyKey: string;
}

/** 契约 §1.2 的批次包装，不包含内部 sessionId。 */
export interface ImportBatch {
  version: 1;
  batchId: string;
  sentAt: string;
  records: ImportRecord[];
}

/** 保留 M2 实际返回的反馈码和严重度，不在 M1 重新判定。 */
export interface CaptureFeedback {
  field: string | null;
  code: string;
  severity: 'blocking' | 'warning';
  candidates?: { id: number; name: string }[];
}

/** 契约 §1.4 的单条处理结果；未知响应在进入流程前做运行时检查。 */
export interface CaptureResult {
  recordId: string;
  status: 'confirmed' | 'pending_followup' | 'duplicate' | 'rejected';
  transactionId: string | null;
  direction: CaptureDraft['direction'];
  occurredAt: string | null;
  category: { id: number; name: string; kind: 'expense' | 'income' } | null;
  confidence: number | null;
  feedback: CaptureFeedback[];
}

/** 话术只解释 M2 的反馈，不增加新的业务反馈码。 */
export interface CaptureMessage extends CaptureFeedback {
  text: string;
}

/** 可安全交给界面的独立副本，修改副本不会改变待提交数据。 */
export interface CaptureSnapshot {
  phase: 'empty' | 'draft' | 'submitting' | 'pending_followup' | 'complete' | 'retry';
  sessionId: string | null;
  batchId: string | null;
  records: { record: ImportRecord; result: CaptureResult | null; messages: CaptureMessage[] }[];
  error: string | null;
}

/** 通过注入现有 M2 导入调用和 ID 生成器，流程不依赖网络或数据库实现。 */
export interface CaptureDependencies {
  importBatch: (batch: ImportBatch) => Promise<unknown>;
  newId: () => string;
}

/** submit 是显式确认操作；prepare/update 均不会调用 M2。 */
export interface CaptureSession {
  prepare: (context: CaptureContext, drafts: CaptureDraft[]) => CaptureSnapshot;
  update: (recordId: string, patch: Partial<CaptureDraft>) => CaptureSnapshot;
  submit: () => Promise<CaptureSnapshot>;
  /** 仅放弃本地草稿和重试状态，不撤销服务端入库；提交执行中禁止调用。 */
  discard: () => CaptureSnapshot;
  getSnapshot: () => CaptureSnapshot;
}
