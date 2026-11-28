<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getRecordingWeek } from '../../api';
import { getAccessToken } from '../../api/access-token';
import type { StatsBucket } from '../../types/contract';

const props = defineProps<{ recordedBatchId: string | null }>();
const expanded = ref(false);
const days = ref<StatsBucket[]>([]);
const today = ref('');
const loading = ref(true);
const error = ref(false);
const recordedDays = computed(() => days.value.filter(day => day.count > 0).length);
let requestId = 0;

async function refresh(): Promise<void> {
  const id = ++requestId;
  loading.value = true;
  error.value = false;
  try {
    const stats = await getRecordingWeek();
    if (id !== requestId) return;
    if (!Array.isArray(stats.buckets) || stats.buckets.length !== 7) {
      throw new Error('近七天统计缺少每日记录');
    }
    days.value = stats.buckets;
    today.value = stats.range.end;
  } catch {
    if (id !== requestId) return;
    days.value = [];
    error.value = true;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

onMounted(refresh);
onBeforeUnmount(() => { requestId += 1; });
watch(() => props.recordedBatchId, id => { if (id) void refresh(); });
watch(getAccessToken, () => {
  days.value = [];
  void refresh();
});
</script>

<template>
  <section class="recording-tree">
    <button id="recording-tree-toggle" class="tree-toggle" type="button"
      :aria-expanded="expanded" aria-controls="recording-tree-days" @click="expanded = !expanded">
      <span class="tree-icon" aria-hidden="true">🌳</span>
      <span class="tree-label">
        <strong>记账树</strong>
        <span role="status">{{ error ? '进度暂不可用' : days.length ? `近 7 天已记录 ${recordedDays} 天` : '正在读取近 7 天记录…' }}</span>
      </span>
      <span class="tree-chevron" aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>
    <div id="recording-tree-days" class="tree-content" :hidden="!expanded" :aria-busy="loading">
      <div v-if="expanded && error" class="tree-error">
        <p role="alert">暂时无法读取记账进度。</p>
        <button type="button" class="tree-retry" @click="refresh">重试</button>
      </div>
      <ol v-else-if="expanded && days.length" class="tree-days" aria-label="近 7 天记账日期">
        <li v-for="day in days" :key="day.period" :data-date="day.period">
          <span class="leaf" :class="{ lit: day.count > 0 }" aria-hidden="true">{{ day.count > 0 ? '✓' : '' }}</span>
          <time :datetime="day.period">{{ day.period === today ? '今天' : day.period.slice(5).replace('-', '/') }}</time>
          <span class="sr-only">{{ day.count > 0 ? '已记录' : '未记录' }}</span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.recording-tree { border: var(--border-width) solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.tree-toggle { width: 100%; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border: 0; border-radius: inherit; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.tree-toggle:focus-visible, .tree-retry:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.tree-icon { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; background: #e2f3e5; font-size: 1.25rem; }
.tree-label { flex: 1; display: grid; gap: var(--space-1); }
.tree-label span, .tree-days time { font-size: var(--text-sm); color: var(--color-text-muted); }
.tree-chevron { font-size: var(--text-lg); }
.tree-content { border-top: var(--border-width) solid var(--color-border); padding: var(--space-4); }
.tree-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: var(--space-1); margin: 0; padding: 0; list-style: none; text-align: center; }
.tree-days li { display: grid; justify-items: center; gap: var(--space-2); }
.tree-days time { white-space: nowrap; }
.leaf { box-sizing: border-box; width: clamp(1.25rem, 6vw, 1.9rem); aspect-ratio: 1; border-radius: 72% 8% 72% 8%; border: 1px solid #88a595; background: #ecf2ef; }
.leaf.lit { display: grid; place-items: center; border-color: #176b46; background: #176b46; color: white; font-size: 0.8rem; }
.tree-error { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.tree-error p { margin: 0; font-size: var(--text-sm); }
.tree-retry { padding: var(--space-2); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: inherit; font: inherit; cursor: pointer; }
</style>
