<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { CaptureDraft, CaptureSnapshot } from '@gduf/capture-flow';
import { recognize, recognizeFollowup, uploadCaptureFile, type UploadedCapture } from '../../api/capture';

const props = defineProps<{ row?: CaptureSnapshot['records'][number]; disabled: boolean }>();
const emit = defineEmits<{
  drafts: [drafts: CaptureDraft[]];
  patch: [id: string, patch: Partial<CaptureDraft>];
}>();
const text = ref('');
const file = ref<File | null>(null);
const loading = ref(false);
const error = ref('');
let active: AbortController | undefined;
let uploaded: UploadedCapture | null = null;
function cancel() { active?.abort(); active = undefined; loading.value = false; }
onBeforeUnmount(cancel);
watch(() => [props.row, props.disabled], cancel, { flush: 'sync' });
function select(event: Event) {
  cancel();
  uploaded = null;
  error.value = '';
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

async function run() {
  if (props.disabled || loading.value || (!file.value && !text.value.trim())) return;
  const controller = new AbortController();
  active = controller;
  loading.value = true;
  error.value = '';
  try {
    if (props.row) {
      const row = props.row;
      const patch = await recognizeFollowup(row.record, text.value.trim(), row.result?.feedback ?? [], controller.signal);
      if (!controller.signal.aborted) { emit('patch', row.record.recordId, patch); text.value = ''; }
    } else {
      if (file.value && !uploaded) {
        const source = await uploadCaptureFile(file.value, controller.signal);
        if (controller.signal.aborted) return;
        uploaded = source;
      }
      const drafts = await recognize(uploaded ?? text.value.trim(), controller.signal);
      if (!controller.signal.aborted) emit('drafts', drafts);
    }
  } catch (cause) {
    if (controller.signal.aborted) return;
    if (cause instanceof Error && 'code' in cause && cause.code === 'INVALID_CAPTURE_INPUT' &&
        'field' in cause && cause.field === 'sourceRef') {
      uploaded = null;
    }
    error.value = cause instanceof Error ? cause.message : '识别失败，请重试。';
  } finally {
    if (active === controller) { active = undefined; loading.value = false; }
  }
}
</script>

<template>
  <form @submit.prevent="run">
    <fieldset :disabled="disabled || loading">
      <legend>{{ row ? '识别这笔账的补充说明' : '从文字、图片或语音生成草稿' }}</legend>
      <label v-if="!file">{{ row ? '补充说明' : '记账文字' }}<textarea v-model="text" maxlength="4000" /></label>
      <label v-if="!row">或选择文件<input id="cap-file" type="file" accept="image/jpeg,image/png,image/webp,audio/webm,audio/wav,audio/mpeg,audio/mp4,audio/ogg" @change="select" /></label>
      <p v-if="file" role="status">{{ file.name }}（待识别）</p>
      <button type="submit" :disabled="!file && !text.trim()">{{ loading ? '识别中…' : row ? '更新待确认草稿' : '识别为待确认草稿' }}</button>
    </fieldset>
    <p v-if="error" role="alert">{{ error }}</p>
  </form>
</template>
