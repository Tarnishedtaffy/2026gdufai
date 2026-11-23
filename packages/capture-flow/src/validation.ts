import type { CaptureContext, CaptureDraft, CaptureFeedback, CaptureResult, ImportBatch } from './types.ts';

const DIRECTIONS = ['expense', 'income'];
const STATUSES = ['confirmed', 'pending_followup', 'duplicate', 'rejected'];

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('数据必须是对象。');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 不能为空。`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field);
}

function direction(value: unknown): CaptureDraft['direction'] {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !DIRECTIONS.includes(value)) throw new Error('收支方向无效。');
  return value as 'expense' | 'income';
}

function confidence(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('抽取置信度必须在 0 到 1 之间。');
  }
  return value;
}

/** 只检查明确时间的格式与日期有效性，不推断或换算相对时间。 */
function timestamp(value: unknown, field: string): string {
  const text = requiredText(value, field);
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?\+08:00$/.exec(text);
  if (!match) throw new Error(`${field} 需要带 +08:00 的完整时间。`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)) {
    throw new Error(`${field} 的日期无效。`);
  }
  return text;
}

function nullableTime(value: unknown, field: string): string | null {
  return value === undefined || value === null || value === '' ? null : timestamp(value, field);
}

/** 白名单读取可防止识别输出夹带 userId、recordId 或幂等键。 */
export function readDraft(value: unknown): CaptureDraft {
  const data = object(value);
  const amount = data.amount ?? null;
  if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount)
    || !/^-?\d+(?:\.\d{1,2})?$/.test(String(amount)))) {
    throw new Error('金额必须是最多两位小数的元数值，缺失时使用 null。');
  }
  // 这里只校验安全表示范围，不转换或改写元金额；0/负数仍由 M2 按契约 §1.3 返回 MISSING_AMOUNT。
  if (amount !== null && !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error('金额超出可处理范围，请核对。');
  }
  if (typeof data.modality !== 'string' || !['text', 'voice', 'image'].includes(data.modality)) {
    throw new Error('输入形态无效。');
  }
  const sourceRef = nullableText(data.sourceRef, '源文件引用');
  if (sourceRef !== null && /^\s*data:/i.test(sourceRef)) throw new Error('源文件引用不能内联文件内容。');
  return {
    amount, merchant: nullableText(data.merchant, '商户'),
    occurredAt: nullableTime(data.occurredAt, '发生时间'), direction: direction(data.direction),
    confidence: confidence(data.confidence), rawText: requiredText(data.rawText, '原始文本'),
    modality: data.modality as CaptureDraft['modality'], sourceRef,
  };
}

/** 原消息身份与时间单独校验，不接受模型填入这些字段。 */
export function readContext(value: CaptureContext): CaptureContext {
  return {
    sessionId: requiredText(value.sessionId, '会话标识'), userId: requiredText(value.userId, '用户标识'),
    sentAt: timestamp(value.sentAt, '发送时间'), chatAt: nullableTime(value.chatAt, '聊天时间'),
  };
}

/** 修改只读取识别字段；undefined 表示未修改，显式 null 保留为清空操作。 */
export function readPatch(value: Partial<CaptureDraft>): Partial<CaptureDraft> {
  const data = object(value);
  const allowed = ['amount', 'merchant', 'occurredAt', 'direction', 'confidence', 'rawText', 'modality', 'sourceRef'];
  return Object.fromEntries(Object.entries(data).filter(([key, fieldValue]) => allowed.includes(key) && fieldValue !== undefined));
}

function readFeedback(value: unknown): CaptureFeedback {
  const data = object(value);
  if (data.severity !== 'blocking' && data.severity !== 'warning') throw new Error('M2 反馈严重度无效。');
  const feedback: CaptureFeedback = {
    field: nullableText(data.field, '反馈字段'), code: requiredText(data.code, '反馈码'), severity: data.severity,
  };
  if (data.candidates !== undefined) {
    if (feedback.code !== 'LOW_CONFIDENCE_CATEGORY' || !Array.isArray(data.candidates) || data.candidates.length > 3) {
      throw new Error('M2 分类候选无效。');
    }
    feedback.candidates = data.candidates.map(value => {
      const item = object(value);
      if (!Number.isInteger(item.id) || Number(item.id) <= 0) throw new Error('M2 分类候选标识无效。');
      return { id: Number(item.id), name: requiredText(item.name, '候选类别名称') };
    });
  }
  return feedback;
}

function readResult(value: unknown): CaptureResult {
  const data = object(value);
  if (typeof data.status !== 'string' || !STATUSES.includes(data.status) || !Array.isArray(data.feedback)) {
    throw new Error('M2 处理结果无效。');
  }
  const transactionId = nullableText(data.transactionId, '账单标识');
  if ((data.status === 'confirmed' || data.status === 'duplicate') && !transactionId) {
    throw new Error('M2 成功结果缺少账单标识。');
  }
  let category: CaptureResult['category'] = null;
  if (data.category !== null && data.category !== undefined) {
    const item = object(data.category), kind = direction(item.kind);
    if (!Number.isInteger(item.id) || Number(item.id) <= 0 || !kind) throw new Error('M2 类别数据无效。');
    category = { id: Number(item.id), name: requiredText(item.name, '类别名称'), kind };
  }
  return {
    recordId: requiredText(data.recordId, '记录标识'), status: data.status as CaptureResult['status'],
    transactionId, category, direction: direction(data.direction),
    occurredAt: nullableTime(data.occurredAt, 'M2 发生时间'), confidence: confidence(data.confidence),
    feedback: data.feedback.map(readFeedback),
  };
}

/** 整批检查完成才应用结果，防止错批、漏项或重复项把回执配给另一笔。 */
export function readResponse(value: unknown, batch: ImportBatch): CaptureResult[] {
  const data = object(value);
  if (data.error !== undefined) {
    const error = object(data.error);
    throw new Error(`${requiredText(error.code, '错误码')}: ${requiredText(error.message, '错误信息')}`);
  }
  if (data.batchId !== batch.batchId || !Array.isArray(data.results) || data.results.length !== batch.records.length) {
    throw new Error('M2 响应批次或记录数量不匹配，请重试原提交。');
  }
  const expected = new Set(batch.records.map(record => record.recordId));
  const results = data.results.map(readResult);
  for (const result of results) {
    if (!expected.delete(result.recordId)) throw new Error('M2 响应包含未知或重复记录，请重试原提交。');
  }
  return results;
}

/** 显示 M2 已给出的错误码和信息；不把网络故障伪装成某个业务错误码。 */
export function importFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
  }
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const value = (error as { error: unknown }).error;
    if (typeof value === 'object' && value !== null && 'code' in value && 'message' in value
      && typeof value.code === 'string' && typeof value.message === 'string') {
      return `${value.code}: ${value.message}`;
    }
  }
  return '导入结果尚未确认，请重试原提交。';
}
