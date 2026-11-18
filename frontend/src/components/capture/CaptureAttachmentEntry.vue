<script setup lang="ts">
import { ref } from 'vue';

const files = ref<{ name: string; kind: string }[]>([]);
/** 文件选择只显示本地名称；识别服务接入前不上传、不构造 sourceRef 或识别草稿。 */
function selectFiles(event: Event): void {
  files.value = Array.from((event.target as HTMLInputElement).files ?? []).map(file => ({
    name: file.name, kind: file.type.startsWith('image/') ? '图片' : file.type.startsWith('audio/') ? '语音' : '文件',
  }));
}
</script>

<template>
  <section class="attachment-entry" aria-labelledby="attachment-title">
    <h2 id="attachment-title">图片 / 语音记账</h2>
    <label for="cap-file">选择图片或语音文件（识别待接入）</label>
    <input id="cap-file" type="file" accept="image/*,audio/*" multiple @change="selectFiles" />
    <p role="status">图片识别和语音转写尚未接入。选择文件仅在本地展示名称，暂不上传或生成可提交草稿。</p>
    <ul v-if="files.length"><li v-for="(file, index) in files" :key="index">{{ file.kind }}：{{ file.name }}（尚未识别）</li></ul>
  </section>
</template>

<style scoped>
.attachment-entry { padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
label, input { display: block; margin: var(--space-2) 0; }
p, li { font-size: var(--text-sm); color: var(--color-text-muted); overflow-wrap: anywhere; }
</style>
