import { detectSpecialEntry } from './intent.ts';
import type { Modality, RawBatch, RawRecord, RepaymentPart } from './types.ts';

const MODALITIES: readonly Modality[] = ['text', 'voice', 'image'];
const DIRECTIONS = ['expense', 'income'] as const;
const REPAYMENT_PARTS: readonly RepaymentPart[] = ['principal', 'interest', 'mixed'];
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_RECORDS = 100;

export type ParseResult =
  | { readonly ok: true; readonly batch: RawBatch }
  | { readonly ok: false; readonly field?: string; readonly message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** 校验年/月/日是否为真实存在的日历日期（V8 会把 2 月 31 日滚动到 3 月）。 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

/**
 * 只接受带时区偏移的 ISO-8601，并逐字段校验范围。
 * Date.parse 对 2 月 31 日、24:00 等非法字面量会静默滚动，因此必须按字面量校验。
 */
function isIsoTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = ISO_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day, hour, minute, second, , , , offsetHour, offsetMinute] = match;
  const numbers = [year, month, day, hour, minute, second].map((part) => Number(part));
  const [y, mo, d, h, mi, s] = numbers as [number, number, number, number, number, number];
  if (!isRealCalendarDate(y, mo, d)) {
    return false;
  }
  if (h > 23 || mi > 59 || s > 59) {
    return false;
  }
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/** 金额必须是有限数字、最多两位小数，且换算成分后仍在安全整数范围内。 */
function isAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  const scaled = value * 100;
  const cents = Math.round(scaled);
  return Math.abs(scaled - cents) <= 1e-6 && Number.isSafeInteger(cents);
}

function fail(message: string, field?: string): ParseResult {
  return { ok: false, message, field };
}

/**
 * 校验契约 §1.3 的还款拆分字段。
 *
 * - 退款与普通消费不得携带拆分子段；
 * - `mixed` 必须同时给出本金与利息，且两者之和等于 `amount`；
 * - 只给一个分字段时，`amount` 必须等于该字段；
 * - 返回值 `null` 表示通过。
 */
function validateRepaymentSplit(
  rawText: string,
  amount: number | null,
  part: RepaymentPart | null,
  principalCents: number | null,
  interestCents: number | null,
  prefix: string
): ParseResult | null {
  const declared = part !== null || principalCents !== null || interestCents !== null;
  if (!declared) {
    return null;
  }

  const special = detectSpecialEntry(rawText);
  if (special === 'refund') {
    return fail(`${prefix}.principalCents 不适用于退款记录`, `${prefix}.principalCents`);
  }
  // 既没显式声明还款、文本也不是还款时，拆分子段没有意义。
  if (part === null && special === null) {
    return fail(`${prefix}.principalCents 只适用于贷款还款`, `${prefix}.principalCents`);
  }

  const amountCents = amount === null ? null : Math.round(amount * 100);
  const effectivePart: RepaymentPart =
    part ?? (principalCents !== null ? (interestCents !== null ? 'mixed' : 'principal') : 'interest');

  if (effectivePart === 'mixed') {
    if (amountCents === null) {
      return fail(`${prefix}.amount 混合还款必须提供金额`, `${prefix}.amount`);
    }
    if (principalCents === null || interestCents === null) {
      const field = principalCents === null ? 'principalCents' : 'interestCents';
      return fail(`${prefix}.${field} 混合还款必须同时提供本金与利息`, `${prefix}.${field}`);
    }
    if (principalCents + interestCents !== amountCents) {
      return fail(`${prefix}.principalCents 与 interestCents 之和必须等于 amount`, `${prefix}.principalCents`);
    }
    return null;
  }

  if (effectivePart === 'interest') {
    if (principalCents !== null && principalCents !== 0) {
      return fail(`${prefix}.principalCents 纯利息还款不能包含本金`, `${prefix}.principalCents`);
    }
    if (interestCents !== null && amountCents !== null && interestCents !== amountCents) {
      return fail(`${prefix}.interestCents 必须等于 amount`, `${prefix}.interestCents`);
    }
    return null;
  }

  if (interestCents !== null && interestCents !== 0) {
    return fail(`${prefix}.interestCents 本金还款不能包含利息`, `${prefix}.interestCents`);
  }
  if (principalCents !== null && amountCents !== null && principalCents !== amountCents) {
    return fail(`${prefix}.principalCents 必须等于 amount`, `${prefix}.principalCents`);
  }
  return null;
}

function parseDirection(value: unknown, index: number): ParseResult | RawRecord['direction'] {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value)) {
    return value as RawRecord['direction'];
  }
  return fail(`records[${index}].direction 只能是 expense / income / null`, `records[${index}].direction`);
}

function parseModality(value: unknown, index: number): ParseResult | Modality {
  if (typeof value === 'string' && (MODALITIES as readonly string[]).includes(value)) {
    return value as Modality;
  }
  return fail(`records[${index}].modality 只能是 text / voice / image`, `records[${index}].modality`);
}

function parseRecord(value: unknown, index: number): ParseResult | RawRecord {
  if (!isObject(value)) {
    return fail(`records[${index}] 必须是对象`, `records[${index}]`);
  }

  const prefix = `records[${index}]`;
  if (!isNonEmptyString(value.recordId)) {
    return fail(`${prefix}.recordId 必填`, `${prefix}.recordId`);
  }
  if (!isNonEmptyString(value.userId)) {
    return fail(`${prefix}.userId 必填`, `${prefix}.userId`);
  }
  if (!isNonEmptyString(value.rawText)) {
    return fail(`${prefix}.rawText 必填`, `${prefix}.rawText`);
  }
  if (!isNonEmptyString(value.idempotencyKey)) {
    return fail(`${prefix}.idempotencyKey 必填`, `${prefix}.idempotencyKey`);
  }

  const modality = parseModality(value.modality, index);
  if (typeof modality !== 'string') {
    return modality as ParseResult;
  }

  const direction = parseDirection(value.direction, index);
  if (direction !== null && typeof direction !== 'string') {
    return direction as ParseResult;
  }

  if (value.amount !== undefined && value.amount !== null && !isAmount(value.amount)) {
    return fail(`${prefix}.amount 必须是最多两位小数的数字`, `${prefix}.amount`);
  }
  if (value.merchant !== undefined && value.merchant !== null && typeof value.merchant !== 'string') {
    return fail(`${prefix}.merchant 必须是字符串或 null`, `${prefix}.merchant`);
  }
  if (value.occurredAt !== undefined && value.occurredAt !== null && !isIsoTime(value.occurredAt)) {
    return fail(`${prefix}.occurredAt 必须是带时区的 ISO-8601`, `${prefix}.occurredAt`);
  }
  if (value.chatAt !== undefined && value.chatAt !== null && !isIsoTime(value.chatAt)) {
    return fail(`${prefix}.chatAt 必须是带时区的 ISO-8601`, `${prefix}.chatAt`);
  }
  if (value.sourceRef !== undefined && value.sourceRef !== null && typeof value.sourceRef !== 'string') {
    return fail(`${prefix}.sourceRef 必须是字符串或 null`, `${prefix}.sourceRef`);
  }
  if (
    value.originalTransactionId !== undefined &&
    value.originalTransactionId !== null &&
    typeof value.originalTransactionId !== 'string'
  ) {
    return fail(`${prefix}.originalTransactionId 必须是字符串或 null`, `${prefix}.originalTransactionId`);
  }
  if (
    value.repaymentPart !== undefined &&
    value.repaymentPart !== null &&
    !(
      typeof value.repaymentPart === 'string' &&
      (REPAYMENT_PARTS as readonly string[]).includes(value.repaymentPart)
    )
  ) {
    return fail(
      `${prefix}.repaymentPart 只能是 principal / interest / mixed / null`,
      `${prefix}.repaymentPart`
    );
  }
  const principalCents = value.principalCents ?? null;
  if (principalCents !== null && (!Number.isInteger(principalCents) || (principalCents as number) < 0)) {
    return fail(`${prefix}.principalCents 必须是非负整数（分）`, `${prefix}.principalCents`);
  }
  const interestCents = value.interestCents ?? null;
  if (interestCents !== null && (!Number.isInteger(interestCents) || (interestCents as number) < 0)) {
    return fail(`${prefix}.interestCents 必须是非负整数（分）`, `${prefix}.interestCents`);
  }
  const repaymentPart = (value.repaymentPart ?? null) as RepaymentPart | null;
  const splitError = validateRepaymentSplit(
    value.rawText,
    (value.amount ?? null) as number | null,
    repaymentPart,
    principalCents as number | null,
    interestCents as number | null,
    prefix
  );
  if (splitError !== null) {
    return splitError;
  }
  if (
    value.confidence !== undefined &&
    value.confidence !== null &&
    (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1)
  ) {
    return fail(`${prefix}.confidence 必须在 0–1 之间`, `${prefix}.confidence`);
  }

  return {
    recordId: value.recordId,
    userId: value.userId,
    direction: direction as RawRecord['direction'],
    amount: (value.amount ?? null) as number | null,
    merchant: (value.merchant ?? null) as string | null,
    occurredAt: (value.occurredAt ?? null) as string | null,
    chatAt: (value.chatAt ?? null) as string | null,
    originalTransactionId: (value.originalTransactionId ?? null) as string | null,
    repaymentPart,
    principalCents: principalCents as number | null,
    interestCents: interestCents as number | null,
    rawText: value.rawText,
    modality: modality as Modality,
    sourceRef: (value.sourceRef ?? null) as string | null,
    confidence: (value.confidence ?? null) as number | null,
    idempotencyKey: value.idempotencyKey
  };
}

/**
 * 校验并规范化模块 1 的批次 JSON。
 * 任一条必填字段缺失或类型非法，整批拒收（契约 1.1 / R1）。
 */
export function parseBatch(input: unknown): ParseResult {
  if (!isObject(input)) {
    return fail('批次必须是 JSON 对象');
  }
  if (input.version !== 1) {
    return fail('version 必须为 1', 'version');
  }
  if (!isNonEmptyString(input.batchId)) {
    return fail('batchId 必填', 'batchId');
  }
  if (!isIsoTime(input.sentAt)) {
    return fail('sentAt 必填且必须带时区（ISO-8601）', 'sentAt');
  }
  if (!Array.isArray(input.records) || input.records.length === 0) {
    return fail('records 必须是非空数组', 'records');
  }
  if (input.records.length > MAX_RECORDS) {
    return fail(`records 最多 ${MAX_RECORDS} 条`, 'records');
  }

  const records: RawRecord[] = [];
  for (const [index, item] of input.records.entries()) {
    const parsed = parseRecord(item, index);
    if ('ok' in parsed && parsed.ok === false) {
      return parsed;
    }
    records.push(parsed as RawRecord);
  }

  return {
    ok: true,
    batch: {
      version: 1,
      batchId: input.batchId,
      sentAt: input.sentAt,
      records
    }
  };
}
