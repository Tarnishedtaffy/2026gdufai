<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { deleteBudget, getBudgets } from '../api/index';
import { useCategories } from '../composables/useCategories';
import type { BudgetItem } from '../types/contract';
import { nowIso } from '../utils/datetime';
import AmountText from '../components/AmountText.vue';
import BudgetForm from '../components/BudgetForm.vue';
import EmptyState from '../components/EmptyState.vue';
import LevelBadge from '../components/LevelBadge.vue';
import LoadingSkeleton from '../components/LoadingSkeleton.vue';

const { categories, loadCategories } = useCategories();
const month = ref(nowIso().slice(0, 7));
const budgets = ref<BudgetItem[]>([]);
const editing = ref<BudgetItem | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
const pendingDeleteId = ref<number | null>(null);
const deletingId = ref<number | null>(null);

watch(month, () => {
  editing.value = null;
  pendingDeleteId.value = null;
  actionError.value = null;
});

async function loadBudgets(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    budgets.value = await getBudgets(month.value);
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : '加载预算数据失败';
  } finally {
    loading.value = false;
  }
}

function startEdit(budget: BudgetItem): void {
  editing.value = budget;
  actionError.value = null;
}

async function onSaved(): Promise<void> {
  editing.value = null;
  await loadBudgets();
}

async function removeBudget(budget: BudgetItem): Promise<void> {
  actionError.value = null;
  deletingId.value = budget.id;
  try {
    await deleteBudget(budget.id);
    if (editing.value?.id === budget.id) {
      editing.value = null;
    }
    await loadBudgets();
  } catch (err: unknown) {
    actionError.value = err instanceof Error ? err.message : '删除预算失败';
  } finally {
    deletingId.value = null;
    pendingDeleteId.value = null;
  }
}

onMounted(async () => {
  await loadCategories();
  await loadBudgets();
});
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <h1 class="title">月度预算</h1>
      <div class="filter">
        <label for="budget-month-input">选择月份</label>
        <input id="budget-month-input" v-model="month" type="month" @change="loadBudgets" />
      </div>
    </div>

    <BudgetForm
      :month="month"
      :categories="categories"
      :editing="editing"
      @saved="onSaved"
      @cancel="editing = null"
    />
    <p v-if="actionError" class="alert-error" role="alert">{{ actionError }}</p>

    <LoadingSkeleton v-if="loading" :rows="3" />
    <div v-else-if="error" class="alert-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="btn" @click="loadBudgets">重试</button>
    </div>
    <EmptyState v-else-if="budgets.length === 0" title="该月份暂未设置预算" hint="请在上方新增预算，或切换其他月份查看" />
    <div v-else class="grid">
      <article v-for="b in budgets" :key="b.id" class="card">
        <div class="card-head">
          <strong>{{ b.scope === 'total' ? '月度总预算' : (b.category?.name ?? '—') }}</strong>
          <LevelBadge :level="b.level" />
        </div>
        <div class="card-nums">
          <span>已用：<AmountText :cents="b.spentCents" /></span>
          <span>限额：<AmountText :cents="b.amountCents" /></span>
          <span>剩余：<AmountText :cents="b.remainingCents" /></span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${Math.min(100, Math.round(b.usageRatio * 100))}%` }"></div>
        </div>
        <div class="card-foot">
          <span class="thresholds">告警阈值：{{ b.alertThresholds.length > 0 ? b.alertThresholds.join(' / ') + '%' : '未设置' }}</span>
          <div class="card-actions">
            <button type="button" class="btn btn-small" @click="startEdit(b)">编辑</button>
            <template v-if="pendingDeleteId === b.id">
              <button
                type="button"
                class="btn btn-small btn-danger"
                :disabled="deletingId === b.id"
                @click="removeBudget(b)"
              >
                {{ deletingId === b.id ? '删除中…' : '确认删除' }}
              </button>
              <button type="button" class="btn btn-small" :disabled="deletingId === b.id" @click="pendingDeleteId = null">取消</button>
            </template>
            <button v-else type="button" class="btn btn-small btn-danger" @click="pendingDeleteId = b.id">删除</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-4); }
.toolbar { display: flex; justify-content: space-between; align-items: center; }
.title { margin: 0; font-size: var(--text-xl); }
.filter { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
.filter input { padding: var(--space-1) var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); }
.alert-error { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-danger-bg); color: var(--color-danger); display: flex; justify-content: space-between; align-items: center; }
.grid { display: flex; flex-direction: column; gap: var(--space-3); }
.card { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.card-nums { display: flex; flex-wrap: wrap; gap: var(--space-4); font-size: var(--text-sm); }
.progress-track { height: var(--size-progress-height); background: var(--color-surface-muted); border-radius: var(--radius-pill); overflow: hidden; }
.progress-fill { height: 100%; background: var(--color-primary); }
.card-foot { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.thresholds { font-size: var(--text-xs); color: var(--color-text-muted); }
.card-actions { display: flex; gap: var(--space-2); }
.btn { padding: var(--space-1) var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.btn-small { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }
.btn-danger { color: var(--color-danger); border-color: var(--color-danger); }
</style>
