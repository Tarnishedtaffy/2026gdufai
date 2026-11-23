import type { CaptureMessage, CaptureResult } from './types.ts';

/** 前端与确认流程共用的只读话术；当前 v1.4 与历史兼容码分组维护，避免双表漂移。 */
export const captureFeedbackText = Object.freeze({
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
  // #17 04fb0c0 / 契约 v1.4：8 个现行退款/还款码，原单变更由 M2 自动完成。
  MISSING_ORIGINAL_TRANSACTION: '请确认这笔退款或还款对应的原账单。',
  ORIGINAL_NOT_FOUND: '没找到可匹配的原账单，请到账单一览核对。',
  REFUND_RECORDED_NEUTRAL: '退款已记录且不计入收支，原账单已自动作废或调整。',
  REPAYMENT_RECORDED_NEUTRAL: '还款已记录且不计入收支，原贷款账单已自动作废或调整。',
  ORIGINAL_NOT_FOUND_RECORDED: '没找到原账单，已归入其他或其他收入，且不计入收支。',
  ORIGINAL_AMOUNT_ADJUSTED: '原账单金额已自动调整为剩余金额。',
  REFUND_EXCESS_AS_INCOME: '原账单已自动作废，退款超出部分已计入收入。',
  // 契约 v1.5 已将本码标记 deprecated，仅用于解释 v1.4 历史回执。
  REPAYMENT_EXCESS_AS_EXPENSE: '原贷款账单已自动作废，还款超出部分已计入支出。',
  // 契约 v1.5（#23）：长期原单、部分还款、本息不明、已结清。
  ORIGINAL_TRANSACTION_AGED: '这笔原账单较早，请确认是否对应正确。',
  PARTIAL_REPAYMENT_RECORDED: '已记录本次还款，贷款尚未结清。',
  AMBIGUOUS_LOAN_PAYMENT: '这笔是还本金还是还利息？请补充本金与利息金额。',
  ORIGINAL_ALREADY_SETTLED: '这笔贷款已结清，无需再还款。',
  // 仅解释历史 v1.3 回执；不作为 v1.4 的现行处理规则。
  REFUND_EXCEEDS_ORIGINAL: '退款金额高于原账单，尚未入库，请核对退款金额。',
  PARTIAL_REFUND_AS_INCOME: '已按部分退款计入收入。',
  // v1.2 旧服务与 mock 的兼容码；真实退款新流程由 #17 / #18 迁移。
  REFUND_NOT_SUPPORTED: '退款请到账单一览中作废原账单。',
});

/** 已知反馈码直接从唯一话术表派生；CaptureFeedback.code 仍允许未知增量码。 */
export type CaptureFeedbackCode = keyof typeof captureFeedbackText;

/** 严重度原样保留；duplicate 是否成功只由结果 status 判断。 */
export function feedbackMessages(result: CaptureResult): CaptureMessage[] {
  return result.feedback.map(feedback => {
    let text = Object.hasOwn(captureFeedbackText, feedback.code) ? captureFeedbackText[feedback.code as CaptureFeedbackCode]
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
