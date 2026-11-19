export type Direction = 'expense' | 'income';
export type Modality = 'text' | 'voice' | 'image';
export type ImportStatus = 'confirmed' | 'pending_followup' | 'duplicate' | 'rejected';
export type FeedbackSeverity = 'blocking' | 'warning';
export type BudgetLevel = 'normal' | 'near' | 'over';
export type StatsDimension = 'day' | 'month' | 'year' | 'recent7';
export type StatsBasisDateField = 'occurred_date';

export type FeedbackCode =
  | 'MISSING_AMOUNT'
  | 'MISSING_TIME'
  | 'FUTURE_TIME'
  | 'MISSING_DIRECTION'
  | 'CATEGORY_KIND_MISMATCH'
  | 'LOW_CONFIDENCE_CATEGORY'
  | 'MERCHANT_DEFAULTED'
  | 'TIME_DEFAULTED_TO_CHAT_TIME'
  | 'DIRECTION_FORCED_BY_CATEGORY'
  | 'DUPLICATE_RECORD'
  | 'MISSING_ORIGINAL_TRANSACTION'
  | 'ORIGINAL_NOT_FOUND'
  | 'REFUND_RECORDED_NEUTRAL'
  | 'REPAYMENT_RECORDED_NEUTRAL'
  | 'ORIGINAL_NOT_FOUND_RECORDED'
  | 'REFUND_EXCEEDS_ORIGINAL'
  | 'PARTIAL_REFUND_AS_INCOME'
  // v1.2 兼容码；新版本退款处理使用上面的分层反馈。
  | 'REFUND_NOT_SUPPORTED';

export type HttpErrorCode =
  | 'INVALID_BATCH'
  | 'INVALID_DIMENSION_PARAM'
  | 'INVALID_QUERY_PARAM'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_IN_USE'
  | 'CATEGORY_NAME_TAKEN'
  | 'CATEGORY_PRESET_PROTECTED'
  | 'CATEGORY_KIND_MISMATCH'
  | 'BUDGET_NOT_FOUND'
  | 'BUDGET_CONFLICT'
  | 'INTERNAL_ERROR'
  | 'UNAUTHORIZED';

export const feedbackText: Record<FeedbackCode, string> = {
  MISSING_AMOUNT: '缺少金额，请补充消费或收入金额',
  MISSING_TIME: '缺少发生时间，请补充日期时间',
  FUTURE_TIME: '发生时间晚于当前时间，请核对',
  MISSING_DIRECTION: '无法判断支出或收入方向，请明确指定',
  CATEGORY_KIND_MISMATCH: '所选类别与收支方向不匹配',
  LOW_CONFIDENCE_CATEGORY: '分类置信度较低，请确认类别是否正确',
  MERCHANT_DEFAULTED: '未识别到商户名称，已使用默认值',
  TIME_DEFAULTED_TO_CHAT_TIME: '未识别到发生时间，已默认使用发送时间',
  DIRECTION_FORCED_BY_CATEGORY: '已根据所选类别自动修正收支方向',
  DUPLICATE_RECORD: '检测到重复提交，已直接关联已有账单',
  MISSING_ORIGINAL_TRANSACTION: '请确认这笔退款或还款对应的原账单。',
  ORIGINAL_NOT_FOUND: '没找到可匹配的原账单，请到账单一览核对。',
  REFUND_RECORDED_NEUTRAL: '退款已记录且不计入收支，请到账单一览作废原账单。',
  REPAYMENT_RECORDED_NEUTRAL: '还款已记录且不计入收支，请到账单一览作废原贷款账单。',
  ORIGINAL_NOT_FOUND_RECORDED: '没找到原账单，已归入其他或其他收入，且不计入收支。',
  REFUND_EXCEEDS_ORIGINAL: '退款金额高于原账单，尚未入库，请核对退款金额。',
  PARTIAL_REFUND_AS_INCOME: '已按部分退款计入收入。',
  REFUND_NOT_SUPPORTED: '暂不支持退款或负数入账',
};

export interface ImportRecord {
  recordId: string;
  userId: string;
  direction: Direction | null;
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null;
  chatAt: string | null;
  rawText: string;
  modality: Modality;
  sourceRef: string | null;
  confidence: number | null;
  idempotencyKey: string;
}

export interface ImportBatch {
  version: 1;
  batchId: string;
  sentAt: string;
  records: ImportRecord[];
}

export interface ImportCategoryRef {
  id: number;
  name: string;
  kind: Direction;
}

export interface FeedbackItem {
  field: string | null;
  code: FeedbackCode;
  severity: FeedbackSeverity;
  candidates?: { id: number; name: string }[];
}

export interface ImportResultItem {
  recordId: string;
  status: ImportStatus;
  transactionId: string | null;
  direction: Direction;
  occurredAt: string | null;
  category: ImportCategoryRef | null;
  confidence: number | null;
  feedback: FeedbackItem[];
}

export interface ImportResult {
  batchId: string;
  results: ImportResultItem[];
}

export interface CategoryItem {
  id: number;
  name: string;
  kind: Direction;
  color: string;
  icon: string;
  isPreset: boolean;
  isActive: boolean;
}

export interface CategoryRef {
  id: number;
  name: string;
  color: string;
  icon: string;
}

export interface TopCategory {
  categoryId: number;
  name: string;
  totalCents: number;
  ratio: number;
}

export interface StatsRange {
  start: string;
  end: string;
}

export interface StatsSummary {
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  count: number;
  topCategory: TopCategory | null;
}

export interface StatsCategory {
  categoryId: number;
  name: string;
  kind: Direction;
  color: string;
  custom: boolean;
  totalCents: number;
  count: number;
  ratio: number;
}

export interface StatsBucket {
  period: string;
  expenseCents: number;
  incomeCents: number;
  count: number;
  categories: StatsCategory[];
}

export interface StatsMeta {
  unit: 'cent';
  basis: { dateField: StatsBasisDateField; timezone: string; includeVoid: boolean };
  generatedAt: string;
  isEmpty: boolean;
}

export interface StatsResponse {
  dimension: StatsDimension;
  range: StatsRange;
  direction: Direction;
  summary: StatsSummary;
  buckets: StatsBucket[];
  meta: StatsMeta;
}

export interface TransactionFilter {
  categoryId: number | null;
  from: string | null;
  to: string | null;
  direction: Direction | null;
}

export interface TransactionSummary {
  totalExpenseCents: number;
  totalIncomeCents: number;
  count: number;
}

export interface TransactionItem {
  id: string;
  direction: Direction;
  amountCents: number;
  merchant: string | null;
  occurredAt: string;
  occurredDate: string;
  category: CategoryRef;
  categoryConfidence: number | null;
  sourceModality: Modality;
  sourceRef: string | null;
  status: string;
  anomalyFlag: string | null;
}

export interface TransactionPage {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface TransactionMeta {
  timezone: string;
  isEmpty: boolean;
}

export interface TransactionListResponse {
  filter: TransactionFilter;
  summary: TransactionSummary;
  items: TransactionItem[];
  page: TransactionPage;
  meta: TransactionMeta;
}

export interface BudgetItem {
  scope: 'total' | 'category';
  category: CategoryRef | null;
  amountCents: number;
  spentCents: number;
  remainingCents: number;
  usageRatio: number;
  level: BudgetLevel;
}

export interface ErrorDetail {
  code: HttpErrorCode;
  message: string;
  field?: string | null;
}

export interface ApiErrorBody {
  error: ErrorDetail;
}

export interface StatsQuery {
  dimension: StatsDimension;
  direction?: Direction;
  date?: string;
  month?: string;
  year?: string;
}

export interface TransactionQuery {
  cursor?: string | null;
  limit?: number;
  categoryId?: number | null;
  direction?: Direction | null;
  from?: string | null;
  to?: string | null;
}
