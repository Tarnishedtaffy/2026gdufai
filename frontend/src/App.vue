<script setup lang="ts">
import { computed, provide } from 'vue';
import { useRoute } from 'vue-router';
import AppNav from './components/AppNav.vue';
import ApiAccessPanel from './components/ApiAccessPanel.vue';
import { captureContextKey } from './composables/useCaptureFlow';
import { getDemoUserId, isMockEnabled } from './api/request';
import { nowIso } from './utils/datetime';

// 单用户演示身份由部署配置提供；同一应用生命周期内的会话标识保持稳定。
const sessionId = crypto.randomUUID();
provide(captureContextKey, () => {
  const sentAt = nowIso();
  return { sessionId, userId: getDemoUserId(), sentAt, chatAt: sentAt };
});

const route = useRoute();
const activePath = computed(() => route.path);
</script>

<template>
  <div class="app-shell">
    <AppNav :active="activePath" />
    <main class="app-main">
      <ApiAccessPanel v-if="!isMockEnabled()" />
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-main {
  max-width: var(--size-container);
  margin: 0 auto;
  padding: var(--space-5) var(--space-4);
}
</style>
