import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { MOCK_TRANSACTIONS } from './src/mock/data';
import { storeTransactions } from './src/mock/store';
import { allNodes, dispatch, findNode, mountCaptureApp, visibleText, type TestNode } from './test-support/app-renderer';

const savedTransactions = [...storeTransactions];
const today = '2026-11-28';
const yesterday = '2026-11-27';

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCK', 'true');
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`${today}T12:00:00+08:00`));
  storeTransactions.splice(0);
});

afterEach(() => {
  storeTransactions.splice(0, storeTransactions.length, ...savedTransactions);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function dayNodes(root: TestNode): TestNode[] {
  return allNodes(root).filter(node => node.kind === 'li' && typeof node.props['data-date'] === 'string');
}

function recordedDates(root: TestNode): string[] {
  return dayNodes(root).filter(node => visibleText(node).includes('已记录')).map(node => String(node.props['data-date']));
}

it.each(['空账本', '只有中性退款'])('%s时首页默认收起，点开有七片未点亮的叶子', async (scenario) => {
  if (scenario === '只有中性退款') {
    storeTransactions.push({
      ...MOCK_TRANSACTIONS[0]!, entryType: 'refund', occurredDate: today, occurredAt: `${today}T09:00:00+08:00`,
    });
  }
  const app = await mountCaptureApp();
  try {
    await nextTick();
    const toggle = findNode(app.root, 'recording-tree-toggle');
    expect(toggle.props['aria-expanded']).toBe(false);
    expect(visibleText(toggle)).toContain('近 7 天已记录 0 天');
    expect(dayNodes(app.root)).toHaveLength(0);
    await dispatch(toggle, 'click');
    expect(toggle.props['aria-expanded']).toBe(true);
    expect(dayNodes(app.root)).toHaveLength(7);
    expect(recordedDates(app.root)).toEqual([]);
    expect(visibleText(dayNodes(app.root).at(-1)!)).toContain('今天');
  } finally {
    app.unmount();
  }
});

it('确认入账才刷新，同一天多笔仍算一天，补记点亮实际发生日', async () => {
  const app = await mountCaptureApp();
  try {
    await dispatch(findNode(app.root, 'recording-tree-toggle'), 'click');
    const entries = [
      [today, '午餐', [today]],
      [today, '水果', [today]],
      [yesterday, '茶饮', [yesterday, today]],
    ] as const;
    for (const [date, merchant, expected] of entries) {
      const before = recordedDates(app.root);
      app.view.value!.acceptDrafts([{
        rawText: `${merchant} 12 元`, amount: 12, merchant, direction: 'expense',
        occurredAt: `${date}T09:00:00+08:00`, modality: 'text', sourceRef: null, confidence: null,
      }]);
      await nextTick();
      expect(recordedDates(app.root)).toEqual(before);
      const confirm = allNodes(app.root).find(node => node.kind === 'button' && visibleText(node).includes('确认并提交'))!;
      await dispatch(confirm, 'click');
      await nextTick();
      expect(recordedDates(app.root)).toEqual(expected);
      expect(visibleText(findNode(app.root, 'recording-tree-toggle'))).toContain(`近 7 天已记录 ${expected.length} 天`);
    }
  } finally {
    app.unmount();
  }
});
