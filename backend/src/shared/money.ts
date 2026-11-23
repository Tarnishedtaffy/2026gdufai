export const CENTS_PER_YUAN = 100;

/** 元转分。入站金额最多两位小数，超过直接报错，避免静默四舍五入。 */
export function yuanToCents(yuan: number): number {
  if (!Number.isFinite(yuan)) {
    throw new RangeError('金额必须是有限数字');
  }
  const scaled = yuan * CENTS_PER_YUAN;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6) {
    throw new RangeError(`金额最多两位小数，当前值: ${yuan}`);
  }
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`金额超出安全整数范围，当前值: ${yuan}`);
  }
  return cents;
}

/** 分转元，仅用于展示或测试。 */
export function centsToYuan(cents: number): number {
  return cents / CENTS_PER_YUAN;
}

/** 分格式化为「12.34」形式的字符串。 */
export function formatCents(cents: number): string {
  return (cents / CENTS_PER_YUAN).toFixed(2);
}
