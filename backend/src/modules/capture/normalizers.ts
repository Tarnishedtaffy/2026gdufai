import type { CaptureDirection, CaptureFailure, PendingFeedbackHint } from './types.ts';

/** 严格对齐当前 main 分支冻结契约 v1.4 §1.5 的 18 个现行反馈码白名单（不含已废弃历史码；待 #23 v1.5 合入后再同步新增 4 码）。 */
export const ACTIVE_CONTRACT_FEEDBACK_CODES: ReadonlySet<string> = new Set([
  'MISSING_AMOUNT',
  'MISSING_TIME',
  'FUTURE_TIME',
  'MISSING_DIRECTION',
  'CATEGORY_KIND_MISMATCH',
  'LOW_CONFIDENCE_CATEGORY',
  'MERCHANT_DEFAULTED',
  'TIME_DEFAULTED_TO_CHAT_TIME',
  'DIRECTION_FORCED_BY_CATEGORY',
  'DUPLICATE_RECORD',
  'MISSING_ORIGINAL_TRANSACTION',
  'ORIGINAL_NOT_FOUND',
  'REFUND_RECORDED_NEUTRAL',
  'REPAYMENT_RECORDED_NEUTRAL',
  'ORIGINAL_NOT_FOUND_RECORDED',
  'ORIGINAL_AMOUNT_ADJUSTED',
  'REFUND_EXCESS_AS_INCOME',
  'REPAYMENT_EXCESS_AS_EXPENSE'
]);

const DIRECTIONS: readonly CaptureDirection[] = ['expense', 'income'];
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const CONTROLLED_SOURCE_REF_PATTERN =
  /^uploads\/\d{4}\/(?:0[1-9]|1[0-2])\/[A-Za-z0-9_-]+\.(?:jpg|png|webp|webm|wav|mp3|m4a|ogg)$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const AMOUNT_TEXT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

const UNKNOWN_MERCHANT_PLACEHOLDERS = new Set([
  '未知',
  '未知商户',
  '未知商家',
  '未知账号',
  '不明',
  '暂无',
  '无',
  'null',
  'none',
  'n/a',
  'unknown'
]);

/** 判断值是否为非数组的普通对象。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验真实存在的日历日期，防止 V8 将 2 月 31 日静默滚动到 3 月。 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() + 1 === month &&
    probe.getUTCDate() === day
  );
}

/** 剥离模型可能附带的 markdown 代码块并解析 JSON。 */
export function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('模型返回内容为空。');
  }
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const jsonText = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(jsonText) as unknown;
}

/** 校验 sourceRef 为受控的相对存储路径，拒绝 data URL、浏览器裸文件名与路径穿越。 */
export function isControlledSourceRef(value: unknown): value is string {
  return typeof value === 'string' && CONTROLLED_SOURCE_REF_PATTERN.test(value);
}

/**
 * 校验并规范化发生时间到带 +08:00 的 ISO-8601 字符串。
 * 仅有 YYYY-MM-DD 时按契约 §1.3 补为当天 T12:00:00+08:00；带其他时区偏移则换算为北京时间。
 */
export function normalizeOccurredAt(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('occurredAt 必须是字符串或 null。');
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnly !== null) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isRealCalendarDate(year, month, day)) {
      throw new Error(`occurredAt 包含无效日期: ${trimmed}`);
    }
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T12:00:00+08:00`;
  }

  const match = ISO_PATTERN.exec(trimmed);
  if (match === null) {
    throw new Error(`occurredAt 必须是合法的 ISO-8601 时间: ${trimmed}`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, msText, tz, , offH, offM] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (!isRealCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`occurredAt 包含越界日期或时刻: ${trimmed}`);
  }
  if (offH !== undefined && (Number(offH) > 23 || Number(offM) > 59)) {
    throw new Error(`occurredAt 时区偏移无效: ${trimmed}`);
  }

  if (tz === '+08:00') {
    const frac = msText !== undefined ? `.${msText}` : '';
    return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${frac}+08:00`;
  }

  const instantMs = Date.parse(trimmed);
  if (Number.isNaN(instantMs)) {
    throw new Error(`occurredAt 无法解析为有效时间戳: ${trimmed}`);
  }
  const shiftedIso = new Date(instantMs + SHANGHAI_OFFSET_MS).toISOString();
  return msText !== undefined || instantMs % 1000 !== 0
    ? shiftedIso.replace(/Z$/, '+08:00')
    : shiftedIso.replace(/\.000Z$/, '+08:00');
}

/** 校验参考时间（必须是非空且带 +08:00 或合法时区的真实时间）。 */
export function normalizeReferenceTime(value: unknown): string {
  const normalized = normalizeOccurredAt(value);
  if (normalized === null) {
    throw new Error('referenceTime 不能为空。');
  }
  return normalized;
}

/**
 * 规范化入站金额（单位：元）。
 * 模型返回 0 或缺失均规整为 null，负数、非有限数、超过两位小数或溢出安全整数分均拒收。
 */
export function normalizeAmount(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('amount 必须是有限数字或 null。');
  }
  if (value === 0) {
    return null;
  }
  if (value < 0) {
    throw new Error('amount 不能为负数，退款/还款也应抽取正数金额。');
  }
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6 || !AMOUNT_TEXT_PATTERN.test(String(value))) {
    throw new Error(`amount 最多保留两位小数: ${value}`);
  }
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error('amount 超出可安全处理范围。');
  }
  return cents / 100;
}

/** 规范化商户名称，禁止把占位词当成真实商户。 */
export function normalizeMerchant(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('merchant 必须是字符串或 null。');
  }
  const trimmed = value.trim();
  if (trimmed === '' || UNKNOWN_MERCHANT_PLACEHOLDERS.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

/** 规范化收支方向，只允许 expense / income / null。 */
export function normalizeDirection(value: unknown): CaptureDirection | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value)) {
    return value as CaptureDirection;
  }
  throw new Error('direction 仅允许 expense / income / null。');
}

/** 规范化抽取置信度（0 到 1 之间或 null）。 */
export function normalizeConfidence(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence 必须是 0 到 1 之间的数字或 null。');
  }
  return value;
}

/**
 * 在调用外部 AI 前校验 pendingFeedback；
 * 未知或已废弃反馈码按 #24 契约决议返回 INVALID_CAPTURE_INPUT。
 */
export function validatePendingFeedbackHints(
  hints: readonly PendingFeedbackHint[] | undefined
): CaptureFailure | null {
  if (hints === undefined) {
    return null;
  }
  if (!Array.isArray(hints)) {
    return {
      code: 'INVALID_CAPTURE_INPUT',
      field: 'pendingFeedback',
      message: 'pendingFeedback 必须是数组。'
    };
  }
  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i];
    if (
      !isPlainObject(hint) ||
      typeof hint.code !== 'string' ||
      !ACTIVE_CONTRACT_FEEDBACK_CODES.has(hint.code)
    ) {
      return {
        code: 'INVALID_CAPTURE_INPUT',
        field: `pendingFeedback[${i}].code`,
        message: `存在未登记或已废弃的反馈码: ${String(hint?.code ?? '')}`
      };
    }
    if (hint.field !== undefined && hint.field !== null && typeof hint.field !== 'string') {
      return {
        code: 'INVALID_CAPTURE_INPUT',
        field: `pendingFeedback[${i}].field`,
        message: 'pendingFeedback field 必须是字符串或 null。'
      };
    }
    if (
      hint.severity !== undefined &&
      hint.severity !== 'blocking' &&
      hint.severity !== 'warning'
    ) {
      return {
        code: 'INVALID_CAPTURE_INPUT',
        field: `pendingFeedback[${i}].severity`,
        message: 'pendingFeedback severity 只能是 blocking 或 warning。'
      };
    }
  }
  return null;
}
