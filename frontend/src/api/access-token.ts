import { computed, shallowRef } from 'vue';

const accessToken = shallowRef('');
export const hasAccessToken = computed(() => accessToken.value !== '');

/** 访问令牌仅保存在本次页面内存中；刷新即清除，不写入任何持久化存储。 */
export function setAccessToken(value: string): void {
  const token = value.trim();
  if (/[\r\n]/.test(token)) throw new Error('访问令牌不能包含换行，请重新核对。');
  accessToken.value = token;
}

/** 每次请求读取当前访问令牌，修改后可直接重试原来的待提交批次。 */
export function getAccessToken(): string { return accessToken.value; }
