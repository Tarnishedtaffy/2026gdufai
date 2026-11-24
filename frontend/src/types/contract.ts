import type { CaptureFeedbackCode } from '@gduf/capture-flow';

// 与确认流程复用唯一只读话术表；反馈码/文案变更统一在共享包维护。
export { captureFeedbackText as feedbackText } from '@gduf/capture-flow';

export type Direction = 'expense' | 'income';
export type StatsDirection = 'all' | Direction;
export type Modality = 'text' | 'voice' | 'image';
export type ImportStatus = 'confirmed' | 'pending_followup' | 'duplicate' | 'rejected';
export type FeedbackSeverity = 'blocking' | 'warning';
export type BudgetLevel = 'normal' | 'near' | 'over';
export type StatsDimension = 'day' | 'month' | 'year' | 'recent7';
export type StatsBasisDateField = 'occurred_date';

export type FeedbackCode = CaptureFeedbackCode;

export type HttpErrorCode =
  | 'INVALID_BATCH'
  | 'INVALID_DIMENSION_PARAM'
  | 'INVALID_QUERY_PARAM'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_IN_USE'
  | 'TRANSACTION_NOT_FOUND'
  | 'CATEGORY_NAME_TAKEN'
  | 'CATEGORY_PRESET_PROTECTED'
  | 'CATEGORY_KIND_MISMATCH'
  | 'BUDGET_NOT_FOUND'
  | 'BUDGET_CONFLICT'
  | 'INTERNAL_ERROR'
  | 'UNAUTHORIZED';

export interface ImportRecord {
  recordId: string;
  userId: string;
  direction: Direction | null;
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null;
  chatAt: string | null;
  /** 契约 §1.3：退款/还款场景下的原账单 id；普通记账不传。 */
  originalTransactionId?: string | null;
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
  /** 契约 §1.4：匹配到的原账单 id；未匹配或普通记账为 null。 */
  matchedTransactionId?: string | null;
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
  direction: StatsDirection;
  summary: StatsSummary;
  buckets: StatsBucket[];
  meta: StatsMeta;
}

export interface TransactionFilter {
  categoryId: number | null;
  from: string | null;
  to: string | null;
  direction: Direction | null;
  entryType: 'normal' | 'refund' | 'repayment' | 'all';
}

export interface TransactionSummary {
  expenseCents: number;
  incomeCents: number;
  count: number;
}

export interface TransactionItem {
  id: string;
  direction: Direction;
  amountCents: number;
  merchant: string | null;
  occurredAt: string;
  occurredDate: string;
  category: CategoryRef | null;
  categoryConfidence: number | null;
  sourceModality: Modality;
  sourceRef: string | null;
  status: string;
  anomalyFlag: boolean | null;
  entryType?: 'normal' | 'refund' | 'repayment';
  settledAt?: string | null;
  /** 契约 §2.3 v1.6：退款/还款匹配到的原账单 id；normal 或未匹配为 null。 */
  matchedTransactionId?: string | null;
}

export interface TransactionPage {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface TransactionMeta {
  unit: 'cent';
  isEmpty: boolean;
}

export interface TransactionListResponse {
  filter: TransactionFilter;
  summary: TransactionSummary;
  items: TransactionItem[];
  page: TransactionPage;
  meta: TransactionMeta;
}

export interface BudgetCategoryRef {
  id: number;
  name: string;
}

export interface BudgetItem {
  id: number;
  scope: 'total' | 'category';
  category: BudgetCategoryRef | null;
  amountCents: number;
  spentCents: number;
  remainingCents: number;
  usageRatio: number;
  level: BudgetLevel;
  alertThresholds: number[];
}

export interface BudgetInput {
  month: string;
  scope: 'total' | 'category';
  categoryId: number | null;
  amountCents: number;
  alertThresholds: number[];
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
  direction?: StatsDirection;
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
  entryType?: 'normal' | 'refund' | 'repayment' | 'all';
}
