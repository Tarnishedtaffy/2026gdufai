<script setup lang="ts">
import { ref } from 'vue';
import { hasAccessToken, setAccessToken } from '../api/access-token';

const input = ref('');
const error = ref<string | null>(null);
function save(): void {
  try { setAccessToken(input.value); input.value = ''; error.value = null; }
  catch (value: unknown) { error.value = value instanceof Error ? value.message : '请核对访问令牌。'; }
}
function clear(): void { setAccessToken(''); input.value = ''; error.value = null; }
</script>

<template>
  <details class="access-panel" :open="!hasAccessToken">
    <summary>记账服务访问设置 · {{ hasAccessToken ? '本次令牌已设置' : '本次未设置令牌' }}</summary>
    <p>服务已设置访问令牌时，请输入部署者提供的令牌。仅保存在当前页面内存，刷新后需重新输入。</p>
    <form id="api-access-form" @submit.prevent="save">
      <label for="api-access-token">访问令牌</label>
      <input id="api-access-token" type="password" :value="input" autocomplete="off" spellcheck="false"
        @input="input = ($event.target as HTMLInputElement).value" />
      <button type="submit">保存本次访问令牌</button>
      <button type="button" :disabled="!hasAccessToken" @click="clear">清除令牌</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else role="status">{{ hasAccessToken ? '后续请求将携带本次令牌，可继续提交或重试原请求。' : '未设置鉴权的开发服务可直接使用。' }}</p>
  </details>
</template>

<style scoped>
.access-panel { margin-bottom: var(--space-4); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
summary { cursor: pointer; }
p, label { font-size: var(--text-sm); }
form { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
input, button { font: inherit; padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
</style>
