/** 预算作用域：total 为月度总预算，category 为单类别预算。 */
export type BudgetScope = 'total' | 'category';

/** 预算使用程度，阈值与契约 §2.5 一致。 */
export type BudgetLevel = 'normal' | 'near' | 'over';

/** 预算关联类别的只读引用；total 预算为 null。 */
export interface BudgetCategory {
  readonly id: number;
  readonly name: string;
}

/** GET /api/budgets 与 PUT /api/budgets 的响应项。 */
export interface BudgetView {
  readonly id: number;
  readonly scope: BudgetScope;
  readonly category: BudgetCategory | null;
  readonly amountCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly usageRatio: number;
  readonly level: BudgetLevel;
  readonly alertThresholds: number[];
}

/** 校验后的预算写入参数。 */
export interface BudgetInput {
  readonly month: string;
  readonly scope: BudgetScope;
  readonly categoryId: number | null;
  readonly amountCents: number;
  readonly alertThresholds: number[];
}
