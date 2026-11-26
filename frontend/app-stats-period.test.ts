import { afterEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { getStats } from './src/api/index';
import { mockGetStats } from './src/mock/stats';
import type { StatsResponse } from './src/types/contract';
import StatsView from './src/views/StatsView.vue';
import { dispatch, findNode, mountUi, visibleText } from './test-support/app-renderer';

vi.mock('./src/api/index', async importOriginal => ({
  ...(await importOriginal<typeof import('./src/api/index')>()),
  getStats: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it.each(['success', 'error'] as const)('切换周期后，忽略旧请求的 %s 响应', async (outcome) => {
  vi.stubGlobal('Document', class {});
  vi.stubGlobal('ShadowRoot', class {});
  vi.stubGlobal('document', { activeElement: null });
  const previous = Promise.withResolvers<StatsResponse>();
  const sample = mockGetStats({ dimension: 'recent7' });
  const summary = { ...sample.summary, expenseCents: 9900 };
  vi.mocked(getStats).mockImplementation(({ dimension }) =>
    dimension === 'recent7' ? previous.promise : Promise.resolve({ ...sample, summary }));
  const mounted = mountUi(StatsView, {});
  try {
    const select = findNode(mounted.root, 'stats-dim-select');
    for (const option of select.options) option.selected = option.value === 'month';
    await dispatch(select, 'change');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(visibleText(mounted.root)).toContain('99.00');

    if (outcome === 'success') previous.resolve(sample);
    else previous.reject(new Error('旧请求失败'));
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    expect(visibleText(mounted.root)).toContain('99.00');
    expect(visibleText(mounted.root)).not.toContain('旧请求失败');
  } finally {
    mounted.unmount();
  }
});
