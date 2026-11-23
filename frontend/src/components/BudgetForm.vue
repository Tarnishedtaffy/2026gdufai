<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { putBudget } from '../api/index';
import type { BudgetItem, CategoryItem } from '../types/contract';

const props = defineProps<{
  month: string;
  categories: CategoryItem[];
  editing: BudgetItem | null;
}>();

const emit = defineEmits<{ saved: []; cancel: [] }>();

const formScope = ref<'total' | 'category'>('total');
const formCategoryId = ref<number | null>(null);
const formAmountYuan = ref('');
const formThresholds = ref('80,100');
const saving = ref(false);
const actionError = ref<string | null>(null);

const expenseCategories = computed(() =>
  props.categories.filter((category) => category.kind === 'expense' && category.isActive),
);

function resetForm(): void {
  formScope.value = 'total';
  formCategoryId.value = expenseCategories.value[0]?.id ?? null;
  formAmountYuan.value = '';
  formThresholds.value = '80,100';
  actionError.value = null;
}

function parseThresholds(raw: string): number[] | null {
  const text = raw.trim();
  if (text === '') {
    return [];
  }
  const values = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => Number(part));
  const unique = [...new Set(values)];
  if (unique.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 200) || unique.length > 5) {
    return null;
  }
  return unique.sort((a, b) => a - b);
}

async function submit(): Promise<void> {
  actionError.value = null;
  const amount = Number(formAmountYuan.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    actionError.value = '请输入大于 0 的预算金额';
    return;
  }
  const amountCents = Math.round(amount * 100);
  if (amountCents <= 0) {
    actionError.value = '金额精度不足以形成有效预算';
    return;
  }
  const thresholds = parseThresholds(formThresholds.value);
  if (thresholds === null) {
    actionError.value = '告警阈值须为 1–200 的整数，最多 5 个';
    return;
  }
  if (formScope.value === 'category' && formCategoryId.value === null) {
    actionError.value = '请选择类别预算的类别';
    return;
  }

  saving.value = true;
  try {
    await putBudget({
      month: props.month,
      scope: formScope.value,
      categoryId: formScope.value === 'total' ? null : formCategoryId.value,
      amountCents,
      alertThresholds: thresholds,
    });
    resetForm();
    emit('saved');
  } catch (err: unknown) {
    actionError.value = err instanceof Error ? err.message : '保存预算失败';
  } finally {
    saving.value = false;
  }
}

function cancel(): void {
  resetForm();
  emit('cancel');
}

watch(
  () => props.editing,
  (budget) => {
    if (budget === null) {
      resetForm();
      return;
    }
    formScope.value = budget.scope;
    formCategoryId.value = budget.category?.id ?? expenseCategories.value[0]?.id ?? null;
    formAmountYuan.value = (budget.amountCents / 100).toFixed(2);
    formThresholds.value = budget.alertThresholds.join(',');
    actionError.value = null;
  },
  { immediate: true },
);

watch(
  () => props.categories,
  () => {
    if (formCategoryId.value === null) {
      formCategoryId.value = expenseCategories.value[0]?.id ?? null;
    }
  },
  { immediate: true },
);
</script>

<template>
  <form class="budget-form" @submit.prevent="submit">
    <div class="form-row">
      <label>
        类型
        <select id="budget-scope" v-model="formScope" :disabled="editing !== null">
          <option value="total">月度总预算</option>
          <option value="category">类别预算</option>
        </select>
      </label>
      <label v-if="formScope === 'category'">
        类别
        <select id="budget-category" v-model.number="formCategoryId" :disabled="editing !== null">
          <option v-for="category in expenseCategories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
      </label>
      <label>
        金额（元）
        <input id="budget-amount" v-model="formAmountYuan" type="number" min="0.01" step="0.01" placeholder="1500.00" />
      </label>
      <label>
        告警阈值（%，留空不提醒）
        <input id="budget-thresholds" v-model="formThresholds" type="text" placeholder="80,100" />
      </label>
      <button type="submit" class="btn btn-primary" :disabled="saving">
        {{ saving ? '保存中…' : editing === null ? '新增预算' : '保存修改' }}
      </button>
      <button v-if="editing !== null" type="button" class="btn" @click="cancel">取消</button>
    </div>
    <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
  </form>
</template>

<style scoped>
.budget-form { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-4); }
.form-row { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); }
.form-row label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); }
.form-row input, .form-row select { padding: var(--space-1) var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); }
.form-error { margin: var(--space-2) 0 0; color: var(--color-danger); font-size: var(--text-sm); }
.btn { padding: var(--space-1) var(--space-3); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); cursor: pointer; }
.btn-primary { background: var(--color-primary); color: var(--color-primary-contrast); border-color: var(--color-primary); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
