import { expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import TransactionsView from './src/views/TransactionsView.vue';
import { allNodes, mountUi, visibleText } from './test-support/app-renderer';

it('在对应账单卡片上区分普通收支、退款与已结清还款', async () => {
  vi.stubEnv('VITE_USE_MOCK', 'true');
  const mounted = mountUi(TransactionsView, {});
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    const cards = allNodes(mounted.root).filter(node => node.kind === 'article').map(visibleText);
    expect(cards.find(text => text.includes('瑞幸咖啡退款'))).toContain('不计收支');
    expect(cards.find(text => text.includes('助学贷款还款'))).toContain('不计收支 · 已结清');
    expect(cards.some(text => !text.includes('不计收支'))).toBe(true);
  } finally {
    mounted.unmount();
    vi.unstubAllEnvs();
  }
});
