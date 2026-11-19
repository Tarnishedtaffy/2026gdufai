import { expect, it } from 'vitest';
import { feedbackText, type FeedbackCode } from './src/types/contract';

// 仅预兼容已确认的新反馈语义；entryType 等完整界面迁移由后续任务负责。
it.each([
  ['MISSING_ORIGINAL_TRANSACTION', '请确认这笔退款或还款对应的原账单。'],
  ['ORIGINAL_NOT_FOUND', '没找到可匹配的原账单，请到账单一览核对。'],
  ['REFUND_RECORDED_NEUTRAL', '退款已记录且不计入收支，请到账单一览作废原账单。'],
  ['REPAYMENT_RECORDED_NEUTRAL', '还款已记录且不计入收支，请到账单一览作废原贷款账单。'],
  ['ORIGINAL_NOT_FOUND_RECORDED', '没找到原账单，已归入其他或其他收入，且不计入收支。'],
  ['REFUND_EXCEEDS_ORIGINAL', '退款金额高于原账单，尚未入库，请核对退款金额。'],
  ['PARTIAL_REFUND_AS_INCOME', '已按部分退款计入收入。'],
] as const satisfies readonly (readonly [FeedbackCode, string])[])('%s 已有具体话术', (code, text) => {
  expect(feedbackText[code]).toBe(text);
});
