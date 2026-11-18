import type { CaptureDraft } from '@gduf/capture-flow';
import { normalizeIsoOffset } from '../../utils/datetime';
import { centsToYuanNumber, yuanToCents } from '../../utils/money';

export type CaptureEditableField = 'amount' | 'merchant' | 'direction' | 'occurredAt';

/** 只返回用户实际编辑的单个字段，避免表单展示精度影响未修改的原始字段。 */
export function parseCaptureEdit(field: CaptureEditableField, input: string | null): {
  patch: Partial<CaptureDraft> | null;
  error: string | null;
} {
  const raw = input?.trim() ?? '';
  if (field === 'amount') {
    if (raw && !/^\d+(?:\.\d{1,2})?$/.test(raw)) {
      return { patch: null, error: '金额请填写最多两位小数的元数值，未知时留空。' };
    }
    const cents = yuanToCents(raw);
    if (raw && (cents === null || !Number.isSafeInteger(cents))) {
      return { patch: null, error: '金额超出可处理范围，请核对。' };
    }
    return { patch: { amount: centsToYuanNumber(cents) }, error: null };
  }
  if (field === 'merchant') return { patch: { merchant: raw || null }, error: null };
  if (field === 'direction') {
    if (raw && raw !== 'expense' && raw !== 'income') return { patch: null, error: '请核对收支方向。' };
    return { patch: { direction: raw === 'expense' || raw === 'income' ? raw : null }, error: null };
  }
  const time = normalizeIsoOffset(raw);
  if (raw && time === null) return { patch: null, error: '请核对发生时间，未知时留空。' };
  if (time !== null) {
    const instant = Date.parse(time);
    // Date.parse 会把部分非法日期进位，往返核对以避免把 2 月 31 日静默变成 3 月。
    if (Number.isNaN(instant) || normalizeIsoOffset(new Date(instant).toUTCString()) !== time) {
      return { patch: null, error: '请核对发生时间，未知时留空。' };
    }
  }
  return { patch: { occurredAt: time }, error: null };
}
