<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { listTransactions } from '../api/index';
import { useCategories } from '../composables/useCategories';
import type { TransactionItem } from '../types/contract';
import { fmtDateTime } from '../utils/datetime';
import AmountText from '../components/AmountText.vue';
import EmptyState from '../components/EmptyState.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';

const { categories, loadCategories } = useCategories();
const selectedCategoryId = ref<number | null>(null);
const selectedEntryType = ref<'all' | 'normal' | 'refund' | 'repayment'>('all');
const items = ref<TransactionItem[]>([]);
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

async function fetchList(reset = true): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await listTransactions({
      cursor: reset ? null : nextCursor.value,
      limit: 10,
      categoryId: selectedCategoryId.value,
      entryType: selectedEntryType.value,
    });
    items.value = reset ? res.items : [...items.value, ...res.items];
    nextCursor.value = res.page.nextCursor;
    hasMore.value = res.page.hasMore;
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : '加载账单失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadCategories();
  void fetchList(true);
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <h1 class="title">账单明细</h1>
      <div class="filter">
        <label for="tx-entry-select">记录类型</label>
        <select id="tx-entry-select" v-model="selectedEntryType" @change="fetchList(true)">
          <option value="all">全部（含退款/还款）</option>
          <option value="normal">仅正常</option>
          <option value="refund">退款</option>
          <option value="repayment">还款</option>
        </select>
        <label for="tx-cat-select">按类别筛选</label>
        <select id="tx-cat-select" v-model="selectedCategoryId" @change="fetchList(true)">
          <option :value="null">全部类别</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
      </div>
    </div>

    <LoadingSkeleton v-if="loading && items.length === 0" :rows="4" />
    <div v-else-if="error" class="alert-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn" @click="fetchList(true)">重试</button>
    </div>
    <EmptyState v-else-if="items.length === 0" title="暂无账单明细" hint="去智能记账页录入第一笔收支吧" />
    <div v-else class="list">
      <article v-for="tx in items" :key="tx.id" class="tx-card">
        <div class="tx-main">
          <span class="cat-pill" :style="{ '--cat-color': tx.category?.color ?? '#6B7280' }">{{ tx.category?.name ?? '未分类' }}</span>
          <span v-if="tx.entryType && tx.entryType !== 'normal'" class="neutral-badge">不计收支{{ tx.settledAt ? ' · 已结清' : '' }}</span>
          <strong>{{ tx.merchant ?? '—' }}</strong>
        </div>
        <div class="tx-meta">
          <span class="time">{{ fmtDateTime(tx.occurredAt) }}</span>
          <AmountText :cents="tx.amountCents" :direction="tx.direction" />
        </div>
      </article>
      <button v-if="hasMore" type="button" class="btn" :disabled="loading" @click="fetchList(false)">
        {{ loading ? '加载中...' : '加载更多' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-4); }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.title { margin: 0; font-size: var(--text-xl); }
.filter { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.filter select { padding: var(--space-1) var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); }
.list { display: flex; flex-direction: column; gap: var(--space-3); }
.tx-card { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); display: flex; justify-content: space-between; align-items: center; }
.tx-main, .tx-meta { display: flex; align-items: center; gap: var(--space-3); }
.cat-pill { padding: var(--space-1) var(--space-2); border-radius: var(--radius-pill); font-size: var(--text-xs); background-color: var(--cat-color, var(--color-cat-fallback)); color: var(--color-primary-contrast); }
.neutral-badge { padding: var(--space-1) var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-pill); font-size: var(--text-xs); color: var(--color-text-muted); white-space: nowrap; }
.time { font-size: var(--text-xs); color: var(--color-text-muted); }
.btn { align-self: center; padding: var(--space-2) var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; }
.alert-error { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-danger-bg); color: var(--color-danger); display: flex; justify-content: space-between; align-items: center; }
</style>
