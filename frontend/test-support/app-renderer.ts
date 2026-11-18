import { createRenderer, defineComponent, h, nextTick, shallowRef } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { CaptureDraft } from '@gduf/capture-flow';
import App from '../src/App.vue';
import CaptureView from '../src/views/CaptureView.vue';

/** 只实现 Vue host 协议和表单属性，不依赖浏览器或 DOM 测试库。 */
export class TestNode {
  children: TestNode[] = [];
  parent: TestNode | null = null;
  props: Record<string, unknown> = {};
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  value: unknown = '';
  selected = false;
  selectedIndex = -1;
  multiple = false;
  constructor(public kind: string, public text = '') {}
  get tagName() { return this.kind.toUpperCase(); }
  get options(): TestNode[] { return this.children.flatMap(child => child.kind === 'option' ? [child] : child.options); }
  addEventListener(name: string, callback: (event: unknown) => void) { (this.listeners[name] ??= []).push(callback); }
  removeEventListener() {}
  setAttribute(name: string, value: unknown) { this.props[name] = value; }
  removeAttribute(name: string) { delete this.props[name]; }
}

const renderer = createRenderer<TestNode, TestNode>({
  createElement: tag => new TestNode(tag), createText: text => new TestNode('#text', text),
  createComment: text => new TestNode('#comment', text), setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => { node.text = text; node.children = []; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent;
  },
  remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
  patchProp(node, key, _previous, value) {
    node.props[key] = value;
    if (key === 'value') node.value = value;
    if (key === 'selected') node.selected = Boolean(value);
    if (key === 'multiple') node.multiple = Boolean(value);
  },
});

export function allNodes(root: TestNode): TestNode[] { return [root, ...root.children.flatMap(allNodes)]; }
export function findNode(root: TestNode, id: string): TestNode {
  const node = allNodes(root).find(item => item.props.id === id);
  if (!node) throw new Error(`找不到界面元素 ${id}`);
  return node;
}
export function visibleText(root: TestNode): string { return allNodes(root).filter(node => node.kind !== '#comment').map(node => node.text).join(' '); }

/** 触发应用真实的表单事件处理器，测试不直接改变组件内部状态。 */
export async function dispatch(node: TestNode, eventName: string, value?: string): Promise<void> {
  if (value !== undefined) node.value = value;
  const event = { target: node, preventDefault() {}, stopPropagation() {} };
  for (const listener of node.listeners[eventName] ?? []) listener(event);
  const handler = node.props[`on${eventName[0]!.toUpperCase()}${eventName.slice(1)}`];
  if (typeof handler === 'function') await handler(event);
  await nextTick();
}

/** 挂载真正的 App 与记账页，确保应用级 provide 和路由依赖都参与测试。 */
export async function mountCaptureApp() {
  const view = shallowRef<{ acceptDrafts(drafts: CaptureDraft[]): void } | null>(null);
  const route = defineComponent({ setup: () => () => h(CaptureView, { ref: view }) });
  const other = defineComponent({ setup: () => () => h('p', '其他页面') });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: route },
    ...['/transactions', '/stats', '/budget'].map(path => ({ path, component: other }))] });
  const app = renderer.createApp(App).use(router);
  await router.push('/'); await router.isReady();
  const root = new TestNode('root'); app.mount(root); await nextTick();
  return { root, view, router, unmount: () => app.unmount() };
}

export function mountUi(component: Parameters<typeof renderer.createApp>[0], props: Record<string, unknown>) {
  const app = renderer.createApp(component, props), root = new TestNode('root');
  app.mount(root);
  return { root, unmount: () => app.unmount() };
}
