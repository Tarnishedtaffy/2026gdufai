<script setup lang="ts">
import { ref } from 'vue';
import { getCategories, getStats } from '../api';
import { isMockEnabled } from '../api/request';
import { DEMO_TODAY } from '../mock/data';
import { parseQuestion, answerQuestion } from '../query';
import { nowIso } from '../utils/datetime';

const question = ref('');
const result = ref('');
const busy = ref(false);
async function ask() {
  if (busy.value || !question.value.trim()) return;
  busy.value = true;
  result.value = '';
  try {
    const plan = parseQuestion(question.value, await getCategories(), isMockEnabled() ? DEMO_TODAY : nowIso().slice(0, 10));
    result.value = answerQuestion(plan, await getStats(plan.query));
  } catch (error) {
    result.value = error instanceof Error ? error.message : '查账失败，请重试。';
  } finally { busy.value = false; }
}
</script>

<template>
  <form class="query" @submit.prevent="ask">
    <label for="ledger-question">问问账本</label>
    <input id="ledger-question" v-model="question" placeholder="上个月吃饭花了多少？" maxlength="160" :disabled="busy" />
    <button type="submit" :disabled="busy || !question.trim()">{{ busy ? '查询中…' : '查账' }}</button>
    <p v-if="result" role="status">{{ result }}</p>
  </form>
</template>

<style scoped>
.query { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
input { flex: 1; min-width: 12em; padding: var(--space-2); font: inherit; }
button { padding: var(--space-2) var(--space-3); }
p { flex-basis: 100%; margin: 0; }
</style>
