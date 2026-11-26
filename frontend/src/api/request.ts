import type { ApiErrorBody, HttpErrorCode } from '../types/contract';
import { getAccessToken } from './access-token';

export type ClientErrorCode = HttpErrorCode | 'NETWORK' | 'INVALID_RESPONSE' | 'HTTP_ERROR';

export interface ApiRequestError extends Error {
  readonly code: ClientErrorCode;
  readonly field: string | null;
}

/**
 * 构造统一结构化请求错误对象。
 * @param code 错误码
 * @param message 可读错误提示
 * @param field 关联字段名
 */
export function createApiError(
  code: ClientErrorCode,
  message: string,
  field: string | null = null,
): ApiRequestError {
  const err = new Error(message) as Error & { code: ClientErrorCode; field: string | null };
  err.name = 'ApiRequestError';
  err.code = code;
  err.field = field;
  return err;
}

/**
 * 判断当前是否启用前端本地 mock 模式（默认开启）。
 */
export function isMockEnabled(): boolean {
  return import.meta.env.VITE_USE_MOCK !== 'false';
}

/**
 * 前端使用的单用户身份，必须与服务端 `DEMO_USER_ID` 一致。
 * 构建期变量；未配置时与服务端默认值 `u_001` 对齐。
 */
export function getDemoUserId(): string {
  const configured = import.meta.env.VITE_DEMO_USER_ID?.trim();
  return configured === undefined || configured === '' ? 'u_001' : configured;
}

export interface RequestConfig extends RequestInit {
  expectArray?: boolean;
}

/**
 * 全站唯一 fetch 请求封装，统一处理网络异常、HTTP 错误体与顶层数据结构校验。
 * @param path 接口相对路径
 * @param config 请求配置与响应形状期望
 */
export async function request<T>(path: string, config: RequestConfig = {}): Promise<T> {
  const { expectArray = false, ...init } = config;
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw createApiError('NETWORK', '网络连接失败，请稍后重试');
  }

  let payload: unknown = null;
  if (response.status === 204) {
    return undefined as T;
  }
  try {
    payload = await response.json();
  } catch {
    throw createApiError(response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', response.ok
      ? '服务端返回了非 JSON 数据' : `请求失败（HTTP ${response.status}，非 JSON 响应）`);
  }

  if (!response.ok) {
    const errBody = payload as Partial<ApiErrorBody>;
    const detail = errBody?.error;
    if (detail && typeof detail.code === 'string' && typeof detail.message === 'string') {
      throw createApiError(detail.code as HttpErrorCode, detail.message, typeof detail.field === 'string' ? detail.field : null);
    }
    throw createApiError('HTTP_ERROR', `请求失败（HTTP ${response.status}）`);
  }

  const isArr = Array.isArray(payload);
  const isObj = typeof payload === 'object' && payload !== null && !isArr;
  if ((expectArray && !isArr) || (!expectArray && !isObj)) {
    throw createApiError('INVALID_RESPONSE', '响应顶层数据结构与契约不符');
  }
  return payload as T;
}
