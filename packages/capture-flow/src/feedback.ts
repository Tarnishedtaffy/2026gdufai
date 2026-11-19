import type { CaptureMessage, CaptureResult } from './types.ts';

const FEEDBACK_TEXT: Record<string, string> = {
  MISSING_AMOUNT: '这笔的金额是多少？',
  MISSING_TIME: '这是哪天的收支？',
  FUTURE_TIME: '发生时间在未来，请检查后修改。',
  MISSING_DIRECTION: '这笔是支出还是收入？',
  CATEGORY_KIND_MISMATCH: '收支方向与类别不一致，请确认收支方向。',
  LOW_CONFIDENCE_CATEGORY: '分类结果不够确定，请核对返回类别。',
  MERCHANT_DEFAULTED: '已补充缺失的商户信息，请检查。',
  TIME_DEFAULTED_TO_CHAT_TIME: '已按原消息的聊天时间记账。',
  DIRECTION_FORCED_BY_CATEGORY: '已按类别确定收支方向。',
  DUPLICATE_RECORD: '这笔已经记过了，沿用已有账单。',
  // #16/#17 的迁移码先解释回执；旧服务仍可能返回 REFUND_NOT_SUPPORTED。
  MISSING_ORIGINAL_TRANSACTION: '请确认这笔退款或还款对应的原账单。',
  ORIGINAL_NOT_FOUND: '没找到可匹配的原账单，请到账单一览核对。',
  REFUND_RECORDED_NEUTRAL: '退款已记录且不计入收支，请到账单一览作废原账单。',
  REPAYMENT_RECORDED_NEUTRAL: '还款已记录且不计入收支，请到账单一览作废原贷款账单。',
  ORIGINAL_NOT_FOUND_RECORDED: '没找到原账单，已归入其他或其他收入，且不计入收支。',
  REFUND_EXCEEDS_ORIGINAL: '退款金额高于原账单，尚未入库，请核对退款金额。',
  PARTIAL_REFUND_AS_INCOME: '已按部分退款计入收入。',
  REFUND_NOT_SUPPORTED: '退款请到账单一览中作废原账单。',
};

/** 严重度原样保留；duplicate 是否成功只由结果 status 判断。 */
export function feedbackMessages(result: CaptureResult): CaptureMessage[] {
  return result.feedback.map(feedback => {
    let text = Object.hasOwn(FEEDBACK_TEXT, feedback.code) ? FEEDBACK_TEXT[feedback.code]!
      : `请检查 ${feedback.field ?? '这笔记录'}（${feedback.code}）。`;
    if (feedback.code === 'TIME_DEFAULTED_TO_CHAT_TIME' && result.occurredAt) {
      text = `已按聊天时间记账，发生时间为 ${result.occurredAt}。`;
    }
    if (feedback.code === 'DIRECTION_FORCED_BY_CATEGORY' && result.direction) {
      text = `已按类别记为${result.direction === 'income' ? '收入' : '支出'}。`;
    }
    return { ...feedback, text };
  });
}
