import { afterEach, expect, it, vi } from 'vitest';
import { mountUi, allNodes, dispatch, findNode } from './test-support/app-renderer';
import CaptureRecognizer from './src/components/capture/CaptureRecognizer.vue';
import { createCaptureSession } from '@gduf/capture-flow';
import { recognizeFollowup } from './src/api/capture';

afterEach(() => vi.unstubAllGlobals());

it.each(['image', 'voice'] as const)('从文件选择到 %s 草稿只调用上传和抽取，保留服务端来源', async modality => {
  const sourceRef = 'uploads/2026/11/550e8400-e29b-41d4-a716-446655440000.' + (modality === 'image' ? 'png' : 'wav');
  const file = new File(['fixture'], 'local-name', {type: modality === 'image' ? 'image/png' : 'audio/wav'});
  const draft = { rawText: '虚构记录', modality, sourceRef, amount: null, merchant: null, occurredAt: null, direction: null, confidence: null };
  const client = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/uploads')) {
      expect(new Headers(init.headers).has('Content-Type')).toBe(false);
      expect((init.body as FormData).get('file')).toBe(file);
      return Response.json({sourceRef, modality});
    }
    expect(path).toMatch(/\/extract$/);
    expect(JSON.parse(String(init.body))).toMatchObject({mode:'draft', modality, sourceRef});
    return Response.json({drafts:[draft]});
  });
  vi.stubGlobal('fetch', client);
  const received = vi.fn();
  const ui = mountUi(CaptureRecognizer, {disabled:false, onDrafts:received});
  try {
    const input = findNode(ui.root, 'cap-file');
    Object.assign(input, {files:[file]});
    await dispatch(input,'change');
    expect(client).not.toHaveBeenCalled();
    await dispatch(allNodes(ui.root).find(n => n.kind === 'form')!, 'submit');
    expect(received).toHaveBeenCalledWith([draft]);
    expect(client).toHaveBeenCalledTimes(2);
  } finally { ui.unmount(); }
});

it('追问只传草稿和反馈，补丁不能改写幂等键', async () => {
  const draft = {rawText:'虚构记录', amount:null, merchant:null, occurredAt:null, direction:null, confidence:null, modality:'text' as const, sourceRef:null};
  let seq = 0;
  const flow = createCaptureSession({newId:()=>String(++seq), importBatch:vi.fn()});
  const row = flow.prepare({userId:'u_001',sessionId:'demo',sentAt:'2026-11-20T12:00:00+08:00',chatAt:null},[draft]).records[0]!;
  const client = vi.fn(async (_path:string, init:RequestInit) => {
    expect(JSON.parse(String(init.body)).currentDraft).toEqual(draft);
    return Response.json({patch:{idempotencyKey:'untrusted'}});
  });
  vi.stubGlobal('fetch',client);
  await expect(recognizeFollowup(row.record,'15元',[],new AbortController().signal)).rejects.toThrow('无效的追问补丁');
  expect(flow.getSnapshot().records[0]).toEqual(row);
});

it('抽取服务暂时失败时，使用已有文件引用重试而不是再次上传', async () => {
  const sourceRef = 'uploads/2026/11/550e8400-e29b-41d4-a716-446655440000.png';
  const draft = { rawText: '虚构记录', modality: 'image', sourceRef, amount: null, merchant: null, occurredAt: null, direction: null, confidence: null };
  let attempts = 0;
  const client = vi.fn(async (path: string, init: RequestInit) => {
    if (path.endsWith('/uploads')) return Response.json({ sourceRef, modality: 'image' });
    expect(JSON.parse(String(init.body)).sourceRef).toBe(sourceRef);
    if (++attempts === 1) {
      return Response.json({ error: { code: 'AI_UPSTREAM_ERROR', message: '识别服务暂时不可用', field: null } }, { status: 502 });
    }
    return Response.json({ drafts: [draft] });
  });
  vi.stubGlobal('fetch', client);
  const received = vi.fn();
  const ui = mountUi(CaptureRecognizer, { disabled: false, onDrafts: received });
  try {
    const input = findNode(ui.root, 'cap-file');
    Object.assign(input, { files: [new File(['fixture'], 'test.png', { type: 'image/png' })] });
    await dispatch(input, 'change');
    const form = allNodes(ui.root).find(node => node.kind === 'form')!;
    await dispatch(form, 'submit');
    expect(received).not.toHaveBeenCalled();
    await dispatch(form, 'submit');
    expect(received).toHaveBeenCalledWith([draft]);
    expect(client.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['uploads', 'extract', 'extract']);
  } finally {
    ui.unmount();
  }
});
