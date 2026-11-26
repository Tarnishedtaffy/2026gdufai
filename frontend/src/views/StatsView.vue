<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getStats } from '../api/index';
import type { StatsDimension, StatsResponse } from '../types/contract';
import AmountText from '../components/AmountText.vue';
import EmptyState from '../components/EmptyState.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';

const dimension = ref<StatsDimension>('recent7');
const data = ref<StatsResponse | null>(null);
const netCents = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
let latestRequestId = 0;

const maxBucketCents = computed(() => {
  if (!data.value) return 1;
  let maxVal = 1;
  for (const b of data.value.buckets) {
    if (b.expenseCents > maxVal) maxVal = b.expenseCents;
  }
  return maxVal;
});

async function loadStats(): Promise<void> {
  const requestId = ++latestRequestId;
  const requestedDimension = dimension.value;
  loading.value = true;
  error.value = null;
  try {
    const [expenseData, allData] = await Promise.all([
      getStats({ dimension: requestedDimension, direction: 'expense' }),
      getStats({ dimension: requestedDimension, direction: 'all' })
    ]);
    if (requestId !== latestRequestId) return;
    data.value = expenseData;
    netCents.value = allData.summary.netCents;
  } catch (err: unknown) {
    if (requestId !== latestRequestId) return;
    error.value = err instanceof Error ? err.message : '加载统计数据失败';
  } finally {
    if (requestId === latestRequestId) loading.value = false;
  }
}

onMounted(() => {
  void loadStats();
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <h1 class="title">消费统计</h1>
      <div class="filter">
        <label for="stats-dim-select">统计维度</label>
        <select id="stats-dim-select" v-model="dimension" @change="loadStats">
          <option value="recent7">近 7 天</option>
          <option value="month">本月</option>
          <option value="day">当日</option>
          <option value="year">年度</option>
        </select>
      </div>
    </div>

    <LoadingSkeleton v-if="loading" :rows="3" />
    <div v-else-if="error" class="alert-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn" @click="loadStats">重试</button>
    </div>
    <EmptyState v-else-if="!data || data.meta.isEmpty" title="当前周期暂无消费统计" hint="有入账记录后将自动生成趋势图" />
    <div v-else class="card">
      <div class="summary-row">
        <span>总支出：<AmountText :cents="data.summary.expenseCents" direction="expense" /></span>
        <span>净收支：<AmountText :cents="netCents" /></span>
        <span>笔数：{{ data.summary.count }} 笔</span>
        <span>最高类别：{{ data.summary.topCategory?.name ?? '—' }}</span>
      </div>
      <div class="chart">
        <div v-for="b in data.buckets" :key="b.period" class="bar-col">
          <div class="bar-track">
            <div class="bar-fill" :style="{ height: `${Math.round((b.expenseCents / maxBucketCents) * 100)}%` }"></div>
          </div>
          <span class="bar-label">{{ b.period.slice(5) || b.period }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-4); }
.toolbar { display: flex; justify-content: space-between; align-items: center; }
.title { margin: 0; font-size: var(--text-xl); }
.filter { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.filter select { padding: var(--space-1) var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); }
.card { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); }
.summary-row { display: flex; flex-wrap: wrap; gap: var(--space-5); font-size: var(--text-sm); }
.chart { display: flex; align-items: flex-end; gap: var(--space-3); height: var(--size-chart-height); padding-top: var(--space-3); }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: var(--space-1); height: 100%; }
.bar-track { flex: 1; width: var(--size-bar-width); background: var(--color-surface-muted); border-radius: var(--radius-sm); display: flex; align-items: flex-end; overflow: hidden; }
.bar-fill { width: 100%; background: var(--color-primary); }
.bar-label { font-size: var(--text-xs); color: var(--color-text-muted); }
.btn { padding: var(--space-1) var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.alert-error { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-danger-bg); color: var(--color-danger); display: flex; justify-content: space-between; align-items: center; }
</style>
