<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CaptureDraft } from '../../../backend/src/modules/capture/index.ts';
import { useCaptureFlow } from '../composables/useCaptureFlow';
import { isMockEnabled } from '../api/request';
import { normalizeIsoOffset } from '../utils/datetime';
import { modalityFromMimeType } from '../utils/attachment';
import { yuanToCents, centsToYuanNumber } from '../utils/money';
import CaptureDraftCard from '../components/capture/CaptureDraftCard.vue';

const { snapshot, inputError, canPrepare, prepare, update, confirm } = useCaptureFlow();
const showEntry = ref(snapshot.value.phase === 'empty');
const rawText = ref('');
const amountInput = ref('');
const merchantInput = ref('');
const occurredAtInput = ref('');
const direction = ref<CaptureDraft['direction']>(null);
const modality = ref<CaptureDraft['modality']>('text');
const sourceRef = ref<string | null>(null);
const formError = ref<string | null>(null);
const invalidRows = ref<Record<string, string>>({});
const busy = computed(() => snapshot.value.phase === 'submitting');
const retrying = computed(() => snapshot.value.phase === 'retry');
const pendingCount = computed(() => snapshot.value.records.filter(row => !row.result || row.result.status === 'pending_followup').length);
const isMock = isMockEnabled();

/** 附件入口只记录文件名与模态；识别能力尚未接入，不读取文件内容。 */
function handleFileSelect(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  sourceRef.value = file.name;
  modality.value = modalityFromMimeType(file.type);
}

/** 手工录入只生成待确认草稿；金额不静默舍入，未知时间不补为当前时间。 */
function prepareManual(): void {
  formError.value = null;
  const rawAmount = amountInput.value.trim();
  if (!rawText.value.trim()) { formError.value = '请填写原始文本。'; return; }
  if (rawAmount && !/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) {
    formError.value = '金额请填写最多两位小数的元数值，未知时留空。'; return;
  }
  const cents = yuanToCents(rawAmount);
  if (rawAmount && (cents === null || !Number.isSafeInteger(cents))) { formError.value = '金额超出可处理范围，请核对。'; return; }
  const occurredAt = normalizeIsoOffset(occurredAtInput.value);
  if (occurredAt && Number.isNaN(Date.parse(occurredAt))) { formError.value = '请核对发生时间。'; return; }
  acceptDrafts([{
    amount: centsToYuanNumber(cents), merchant: merchantInput.value.trim() || null,
    occurredAt, direction: direction.value, confidence: null,
    rawText: rawText.value, modality: modality.value, sourceRef: sourceRef.value,
  }]);
}

/** 识别端交接入口；这里只接收字段草稿，不抽取文字，也不生成模型身份字段。 */
function acceptDrafts(drafts: CaptureDraft[]): void {
  if (prepare(drafts)) { invalidRows.value = {}; showEntry.value = false; }
}

/** 固定虚构样例用于演示多条返回与缺金额追问，不标记为真实识别结果。 */
function prepareSamples(): void {
  const common = { merchant: null, direction: 'expense' as const, confidence: null, modality: 'text' as const, sourceRef: null };
  acceptDrafts([
    { ...common, rawText: '虚构示例：午饭 24.5 元', amount: 24.5, occurredAt: '2026-11-16T12:00:00+08:00' },
    { ...common, rawText: '虚构示例：咖啡，金额待补', amount: null, occurredAt: '2026-11-16T15:00:00+08:00' },
  ]);
}

function edit(recordId: string, patch: Partial<CaptureDraft> | null, error: string | null): void {
  const errors = { ...invalidRows.value };
  if (error) errors[recordId] = error; else delete errors[recordId];
  if (patch && !update(recordId, patch)) errors[recordId] = inputError.value ?? '请核对字段。';
  invalidRows.value = errors;
}

function newEntry(): void {
  showEntry.value = true;
  rawText.value = ''; amountInput.value = ''; merchantInput.value = ''; occurredAtInput.value = ''; direction.value = null;
  modality.value = 'text'; sourceRef.value = null;
  formError.value = null; invalidRows.value = {};
}

defineExpose({ acceptDrafts });
</script>

<template>
  <section class="page">
    <h1 class="title">智能记账 · 先核对，再提交</h1>
    <p class="hint">{{ isMock ? '演示模式：使用模拟接口，数据仅保存在本次页面会话中。' : '真实模式：核对后提交到记账服务。' }}</p>
    <p v-if="!canPrepare" class="alert" role="alert">真实记账尚未接入登录会话，暂不能提交。</p>
    <form v-if="showEntry" class="entry" @submit.prevent="prepareManual">
      <h2>准备文字草稿</h2>
      <p class="hint">可先手工填写或载入虚构示例；小票图片与语音识别尚未接入，选择附件后只会记录文件名。</p>
      <label for="cap-raw">原始文本<input id="cap-raw" v-model="rawText" placeholder="例如：午饭麻辣烫 24.5 元" /></label>
      <div class="fields">
        <label for="cap-dir">收支方向<select id="cap-dir" v-model="direction"><option :value="null">未知</option><option value="expense">支出</option><option value="income">收入</option></select></label>
        <label for="cap-amount">金额（元，未知留空）<input id="cap-amount" v-model="amountInput" inputmode="decimal" /></label>
        <label for="cap-merchant">商户（未知留空）<input id="cap-merchant" v-model="merchantInput" /></label>
        <label for="cap-time">发生时间（北京时间，未知留空）<input id="cap-time" v-model="occurredAtInput" type="datetime-local" /></label>
        <label for="cap-file">附件小票或语音（可选）<input id="cap-file" type="file" accept="image/*,audio/*" @change="handleFileSelect" /><span class="hint">{{ sourceRef ?? '未选择文件' }}</span></label>
      </div>
      <p v-if="formError" class="alert" role="alert">{{ formError }}</p>
      <div class="actions"><button type="submit" class="primary" :disabled="!canPrepare">生成待确认草稿</button><button type="button" :disabled="!canPrepare" @click="prepareSamples">载入两条虚构示例</button></div>
    </form>
    <template v-else>
      <p v-if="snapshot.phase === 'draft'" class="hint">请核对以下 {{ snapshot.records.length }} 条草稿。点击确认之前不会提交。</p>
      <p v-if="snapshot.phase === 'pending_followup'" class="hint">请补充对应记录；已完成的记录不会重复提交。</p>
      <CaptureDraftCard v-for="(row, index) in snapshot.records" :key="row.record.recordId" :row="row" :index="index" :locked="busy || retrying" @change="edit" />
      <div v-if="snapshot.error" class="alert" role="alert">{{ snapshot.error }}。请重试原提交，暂不能修改或新建记录。</div>
      <div class="actions">
        <button v-if="snapshot.phase !== 'complete'" class="primary" type="button" :disabled="busy || !canPrepare || Object.keys(invalidRows).length > 0" @click="confirm">
          {{ busy ? '提交中…' : retrying ? '重试原提交' : snapshot.phase === 'pending_followup' ? `确认补充并重发 ${pendingCount} 条` : `确认并提交 ${pendingCount} 条` }}
        </button>
        <button v-if="snapshot.phase === 'complete' || snapshot.phase === 'draft'" type="button" @click="newEntry">{{ snapshot.phase === 'draft' ? '重新填写' : '新建一笔' }}</button>
      </div>
    </template>
    <p v-if="inputError" class="alert" role="alert">{{ inputError }}</p>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: var(--space-4); }
.title { margin: 0; font-size: var(--text-xl); }
h2 { margin: 0; font-size: var(--text-lg); }
.entry { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
label { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-sm); }
input, select { padding: var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-sm); font: inherit; min-width: 0; }
.hint { margin: 0; font-size: var(--text-sm); color: var(--color-text-muted); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
button { padding: var(--space-2) var(--space-4); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; font: inherit; }
button.primary { background: var(--color-primary); color: var(--color-primary-contrast); border-color: var(--color-primary); }
button:disabled { opacity: .55; cursor: default; }
.alert { padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-danger-bg); color: var(--color-danger); margin: 0; }
@media (max-width: 600px) { .fields { grid-template-columns: 1fr; } }
</style>
