import type { CaptureDraft, CaptureFeedback } from '@gduf/capture-flow';
import { nowIso } from '../utils/datetime';
import { request } from './request';

function extract<T>(input: object, signal: AbortSignal): Promise<T> {
  return request<T>('/api/capture/extract', {
    method: 'POST', body: JSON.stringify({ ...input, sentAt: nowIso() }), signal,
  });
}

/** 上传成功后仅将服务端返回的文件引用传给抽取接口。 */
export async function recognize(input: string | File, signal: AbortSignal): Promise<CaptureDraft[]> {
  let source: { modality: CaptureDraft['modality']; sourceRef: string | null; rawText?: string };
  if (typeof input === 'string') {
    source = { modality: 'text', rawText: input, sourceRef: null };
  } else {
    const form = new FormData();
    form.append('file', input);
    const upload = await request<{ modality: string; sourceRef: string }>('/api/capture/uploads', {
      method: 'POST', body: form, signal,
    });
    if (!['image', 'voice'].includes(upload.modality) || typeof upload.sourceRef !== 'string' || !upload.sourceRef) {
      throw new Error('上传服务未返回有效的文件引用。');
    }
    source = { modality: upload.modality as 'image' | 'voice', sourceRef: upload.sourceRef };
  }
  const { drafts } = await extract<{ drafts: CaptureDraft[] }>({ mode: 'draft', ...source }, signal);
  if (!Array.isArray(drafts) || !drafts.length || drafts.some(d => d?.modality !== source.modality || d.sourceRef !== source.sourceRef)) {
    throw new Error('识别结果为空或与原始来源不一致。');
  }
  return drafts;
}

/** 只传草稿八字段及当前反馈，返回值交给共享流程再次校验。 */
export async function recognizeFollowup(record: CaptureDraft, followupText: string, pendingFeedback: CaptureFeedback[], signal: AbortSignal) {
  const { amount, merchant, occurredAt, direction, confidence, rawText, modality, sourceRef } = record;
  const currentDraft = { amount, merchant, occurredAt, direction, confidence, rawText, modality, sourceRef };
  const { patch } = await extract<{ patch: Partial<CaptureDraft> }>({ mode: 'followup', currentDraft, followupText, pendingFeedback }, signal);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(k => !['amount', 'merchant', 'occurredAt', 'direction', 'confidence', 'rawText'].includes(k))) {
    throw new Error('识别服务返回了无效的追问补丁。');
  }
  return patch;
}
