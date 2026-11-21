/** 契约 2.6 中登记的错误码。新增错误码必须先改契约。 */
export type ErrorCode =
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
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export interface AppErrorOptions {
  field?: string;
  details?: Record<string, unknown>;
}

/** 业务错误。由全局错误处理器转成契约 2.6 的响应格式。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, statusCode: number, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.field = options.field;
    this.details = options.details;
  }
}

export function invalidBatch(message: string, field?: string): AppError {
  return new AppError('INVALID_BATCH', 400, message, { field });
}

export function categoryNotFound(id: number): AppError {
  return new AppError('CATEGORY_NOT_FOUND', 404, `类别 ${id} 不存在`, { field: 'categoryId' });
}
