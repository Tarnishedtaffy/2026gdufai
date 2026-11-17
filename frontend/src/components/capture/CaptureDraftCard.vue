<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CaptureDraft, CaptureSnapshot } from '../../../../backend/src/modules/capture/index.ts';
import { normalizeIsoOffset, fmtDateTime } from '../../utils/datetime';
import { parseCaptureEdit, type CaptureEditableField } from './capture-form';

const props = defineProps<{ row: CaptureSnapshot['records'][number]; locked: boolean; index: number }>();
const emit = defineEmits<{ change: [recordId: string, patch: Partial<CaptureDraft> | null, error: string | null] }>();
const amount = ref('');
const merchant = ref('');
const occurredAt = ref('');
const direction = ref<CaptureDraft['direction']>(null);
const error = ref<string | null>(null);
const fieldErrors = ref<Partial<Record<CaptureEditableField, string>>>({});
const statusText = { confirmed: '已入库', pending_followup: '待追问', duplicate: '已关联原账单', rejected: '已放弃处理' };
const editable = computed(() => !props.locked && (!props.row.result || props.row.result.status === 'pending_followup'));

watch([() => props.row.record.recordId, () => props.row.result?.status, () => props.row.result?.transactionId], () => {
  const record = props.row.record;
  amount.value = record.amount === null ? '' : String(record.amount);
  merchant.value = record.merchant ?? '';
  occurredAt.value = normalizeIsoOffset(record.occurredAt)?.slice(0, 19) ?? '';
  direction.value = record.direction;
}, { immediate: true });

/** 表单格式错误时阻止确认；空字段仍保留 null，业务判断由 M2 完成。 */
function change(field: CaptureEditableField): void {
  const value = { amount: amount.value, merchant: merchant.value, occurredAt: occurredAt.value, direction: direction.value }[field];
  const parsed = parseCaptureEdit(field, value);
  if (parsed.error) fieldErrors.value[field] = parsed.error;
  else delete fieldErrors.value[field];
  error.value = Object.values(fieldErrors.value)[0] ?? null;
  emit('change', props.row.record.recordId, parsed.patch, error.value);
}
</script>

<template>
  <article class="draft-card" :aria-labelledby="`draft-title-${index}`">
    <h2 :id="`draft-title-${index}`">第 {{ index + 1 }} 条 · {{ row.result ? statusText[row.result.status] : '待确认草稿' }}</h2>
    <p class="source">原始文本：{{ row.record.rawText }}（{{ row.record.modality === 'text' ? '文字' : row.record.modality === 'voice' ? '语音' : '图片' }}）</p>
    <fieldset :disabled="!editable">
      <legend class="sr-only">核对第 {{ index + 1 }} 条记录</legend>
      <div class="fields">
        <label :for="`draft-amount-${index}`">金额（元，未知留空）
          <input :id="`draft-amount-${index}`" v-model="amount" inputmode="decimal" @input="change('amount')" />
        </label>
        <label :for="`draft-direction-${index}`">收支方向
          <select :id="`draft-direction-${index}`" v-model="direction" @change="change('direction')">
            <option :value="null">未知</option><option value="expense">支出</option><option value="income">收入</option>
          </select>
        </label>
        <label :for="`draft-merchant-${index}`">商户（未知留空）
          <input :id="`draft-merchant-${index}`" v-model="merchant" @input="change('merchant')" />
        </label>
        <label :for="`draft-time-${index}`">发生时间（北京时间，未知留空）
          <input :id="`draft-time-${index}`" v-model="occurredAt" type="datetime-local" step="1" @input="change('occurredAt')" />
        </label>
      </div>
    </fieldset>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="row.result" class="receipt" role="status">
      <p v-if="row.result.transactionId">账单号：{{ row.result.transactionId }}</p>
      <p v-if="row.result.category">返回类别：{{ row.result.category.name }}</p>
      <p v-if="row.result.direction">返回收支方向：{{ row.result.direction === 'expense' ? '支出' : '收入' }}</p>
      <p v-if="row.result.occurredAt">返回发生时间：{{ fmtDateTime(row.result.occurredAt) }}</p>
      <p v-for="(message, messageIndex) in row.messages" :key="messageIndex" :class="row.result.status === 'duplicate' ? 'warning' : message.severity">
        {{ row.result.status === 'pending_followup' && message.severity === 'blocking' ? '需要补充' : row.result.status === 'rejected' ? '未完成原因' : '提示' }}：{{ message.text }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.draft-card { padding: var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
.source { color: var(--color-text-muted); overflow-wrap: anywhere; }
fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); }
input, select { padding: var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); font: inherit; min-width: 0; }
.error, .blocking { color: var(--color-danger); }
.warning { color: var(--color-warning); }
.receipt { margin-top: var(--space-3); }
.receipt p { margin: var(--space-1) 0; }
@media (max-width: 600px) { .fields { grid-template-columns: 1fr; } }
</style>
