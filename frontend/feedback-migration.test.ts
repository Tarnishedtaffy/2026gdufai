import { expect, it } from 'vitest';
import { feedbackText, type FeedbackCode } from './src/types/contract';

// 预兼容 v1.4 当前八码；旧版反馈只作为历史兼容，不固定为当前契约。
it.each([
  ['MISSING_ORIGINAL_TRANSACTION', '请确认这笔退款或还款对应的原账单。'],
  ['ORIGINAL_NOT_FOUND', '没找到可匹配的原账单，请到账单一览核对。'],
  ['REFUND_RECORDED_NEUTRAL', '退款已记录且不计入收支，原账单已自动作废或调整。'],
  ['REPAYMENT_RECORDED_NEUTRAL', '还款已记录且不计入收支，原贷款账单已自动作废或调整。'],
  ['ORIGINAL_NOT_FOUND_RECORDED', '没找到原账单，已归入其他或其他收入，且不计入收支。'],
  ['ORIGINAL_AMOUNT_ADJUSTED', '原账单金额已自动调整为剩余金额。'],
  ['REFUND_EXCESS_AS_INCOME', '原账单已自动作废，退款超出部分已计入收入。'],
  ['REPAYMENT_EXCESS_AS_EXPENSE', '原贷款账单已自动作废，还款超出部分已计入支出。'],
] as const satisfies readonly (readonly [FeedbackCode, string])[])('%s 已有具体话术', (code, text) => {
  expect(feedbackText[code]).toBe(text);
});
