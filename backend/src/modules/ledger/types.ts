/** 收支方向。入站可为 null（未判定），入库前必然确定。 */
export type Direction = 'expense' | 'income';

/** 输入形态，对应契约 1.3 的 modality。 */
export type Modality = 'text' | 'voice' | 'image';

/** 分类结果来源，对应 transactions.category_source。 */
export type ClassificationSource = 'rule' | 'user_rule' | 'llm' | 'fallback';

/** 贷款还款的本金/利息属性，对应契约 §1.3 的 repaymentPart。 */
export type RepaymentPart = 'principal' | 'interest' | 'mixed';

/** 模块 1 批次中的单条记录（已通过校验的规范化形态）。 */
export interface RawRecord {
  readonly recordId: string;
  readonly userId: string;
  readonly direction: Direction | null;
  /** 金额，单位元，最多两位小数；未识别为 null。 */
  readonly amount: number | null;
  readonly merchant: string | null;
  readonly occurredAt: string | null;
  readonly chatAt: string | null;
  /** 退款/还款场景下由模块 1 带回的原账单 id；正常记账为 null。 */
  readonly originalTransactionId: string | null;
  /** 贷款还款的本金/利息属性；非还款记录为 null。 */
  readonly repaymentPart: RepaymentPart | null;
  /** 本次还款的本金（分）；未拆分为 null。 */
  readonly principalCents: number | null;
  /** 本次还款的利息（分）；未拆分为 null。 */
  readonly interestCents: number | null;
  readonly rawText: string;
  readonly modality: Modality;
  readonly sourceRef: string | null;
  readonly confidence: number | null;
  readonly idempotencyKey: string;
}

/** 模块 1 发来的完整批次。 */
export interface RawBatch {
  readonly version: 1;
  readonly batchId: string;
  readonly sentAt: string;
  readonly records: readonly RawRecord[];
}

/** 分类字典的一行，供分类引擎匹配。 */
export interface CategoryRow {
  readonly id: number;
  readonly name: string;
  readonly kind: Direction;
  readonly keywords: readonly string[];
  readonly isPreset: boolean;
}

/** 用户历史修正沉淀下来的规则。 */
export interface UserCategoryRule {
  readonly pattern: string;
  readonly categoryId: number;
}

/** 分类引擎输出。 */
export interface Classification {
  readonly categoryId: number | null;
  readonly confidence: number;
  readonly source: ClassificationSource;
}
