import {
  ACTIVE_CONTRACT_FEEDBACK_CODES,
  isControlledSourceRef,
  isPlainObject,
  MAX_CAPTURE_TEXT_LENGTH,
  normalizeAmount,
  normalizeConfidence,
  normalizeDirection,
  normalizeMerchant,
  normalizeOccurredAt,
  normalizeReferenceTime,
  parseJsonPayload,
  validatePendingFeedbackHints
} from './normalizers.ts';
import type { CaptureDraft, CaptureDraftPatch, CaptureModality } from './types.ts';

export {
  ACTIVE_CONTRACT_FEEDBACK_CODES,
  isControlledSourceRef,
  MAX_CAPTURE_TEXT_LENGTH,
  normalizeAmount,
  normalizeMerchant,
  normalizeOccurredAt,
  normalizeReferenceTime,
  parseJsonPayload,
  validatePendingFeedbackHints
};

const MODALITIES: readonly CaptureModality[] = ['text', 'voice', 'image'];
const MAX_DRAFT_RECORDS = 100;

interface DraftContext {
  readonly modality: CaptureModality;
  readonly sourceRef: string | null;
  readonly fallbackRawText?: string;
}

function buildDraftFromModelRecord(
  item: unknown,
  context: DraftContext,
  allowFallbackRawText: boolean
): CaptureDraft {
  if (!isPlainObject(item)) {
    throw new Error('records 元素必须是对象。');
  }
  let rawText = typeof item.rawText === 'string' ? item.rawText.trim() : '';
  if (rawText === '' && allowFallbackRawText && context.fallbackRawText) {
    rawText = context.fallbackRawText.trim();
  }
  if (rawText === '') {
    throw new Error('每条抽取草稿都必须包含非空 rawText。');
  }

  return {
    amount: normalizeAmount(item.amount),
    merchant: normalizeMerchant(item.merchant),
    occurredAt: normalizeOccurredAt(item.occurredAt),
    direction: normalizeDirection(item.direction),
    confidence: normalizeConfidence(item.confidence),
    rawText,
    modality: context.modality,
    sourceRef: context.sourceRef
  };
}

/** 按白名单解析模型返回的草稿列表，自动剥离模型夹带的身份、幂等键或原单字段。 */
export function parseExtractedDrafts(rawJson: string, context: DraftContext): CaptureDraft[] {
  if (context.sourceRef !== null && !isControlledSourceRef(context.sourceRef)) {
    throw new Error('sourceRef 必须是受控相对路径。');
  }
  const parsed = parseJsonPayload(rawJson);
  if (!isPlainObject(parsed) || !Array.isArray(parsed.records)) {
    throw new Error('模型输出缺少 records 数组。');
  }
  if (parsed.records.length === 0 || parsed.records.length > MAX_DRAFT_RECORDS) {
    throw new Error(`records 数量必须在 1 到 ${MAX_DRAFT_RECORDS} 之间。`);
  }
  const allowFallback = parsed.records.length === 1;
  return parsed.records.map((record) => buildDraftFromModelRecord(record, context, allowFallback));
}

/** 小票视觉模型输出解析结果。 */
export type ParsedReceiptResult =
  | { readonly readable: true; readonly drafts: CaptureDraft[] }
  | { readonly readable: false; readonly reason: string };

/** 解析小票视觉识别输出；图片不可读时明确失败，不伪造草稿。 */
export function parseExtractedReceipt(rawJson: string, sourceRef: string): ParsedReceiptResult {
  if (!isControlledSourceRef(sourceRef)) {
    throw new Error('sourceRef 必须是受控相对路径。');
  }
  const parsed = parseJsonPayload(rawJson);
  if (!isPlainObject(parsed) || typeof parsed.readable !== 'boolean') {
    throw new Error('视觉模型输出缺少布尔字段 readable。');
  }
  if (!parsed.readable) {
    const reason =
      typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
        ? parsed.reason.trim()
        : '小票图像模糊或未识别到有效消费凭据，请重新拍摄或改用文字输入。';
    return { readable: false, reason };
  }
  if (!Array.isArray(parsed.records) || parsed.records.length === 0) {
    return {
      readable: false,
      reason: '未能从小票中识别出任何记账记录，请补充文字说明或重拍。'
    };
  }
  if (parsed.records.length > MAX_DRAFT_RECORDS) {
    throw new Error(`小票记录数量超过上限 ${MAX_DRAFT_RECORDS}。`);
  }
  const ocrText =
    typeof parsed.ocrText === 'string' && parsed.ocrText.trim() !== ''
      ? parsed.ocrText.trim()
      : undefined;
  const allowFallback = parsed.records.length === 1;
  const drafts = parsed.records.map((record) =>
    buildDraftFromModelRecord(
      record,
      { modality: 'image', sourceRef, fallbackRawText: ocrText },
      allowFallback
    )
  );
  return { readable: true, drafts };
}

type PatchFieldKey = 'amount' | 'merchant' | 'occurredAt' | 'direction' | 'confidence';

const PATCH_FIELD_NORMALIZERS: ReadonlyArray<
  readonly [PatchFieldKey, (value: unknown) => CaptureDraft[PatchFieldKey]]
> = [
  ['amount', normalizeAmount],
  ['merchant', normalizeMerchant],
  ['occurredAt', normalizeOccurredAt],
  ['direction', normalizeDirection],
  ['confidence', normalizeConfidence]
];

/** 解析二阶段追问补丁输出，仅返回明确补充或修正的字段，保留未提及字段不变。 */
export function parseExtractedFollowupPatch(
  rawJson: string,
  currentDraft: CaptureDraft,
  followupText: string
): CaptureDraftPatch {
  const parsed = parseJsonPayload(rawJson);
  if (!isPlainObject(parsed) || !isPlainObject(parsed.patch)) {
    throw new Error('追问模型输出缺少 patch 对象。');
  }
  const rawPatch = parsed.patch;
  const patch: Record<string, unknown> = {};

  for (const [key, normalize] of PATCH_FIELD_NORMALIZERS) {
    if (!Object.hasOwn(rawPatch, key) || rawPatch[key] === undefined) {
      continue;
    }
    const nextValue = normalize(rawPatch[key]);
    // 原字段本就是 null 时，模型冗余回传 null 视为未改动，保持补丁精简。
    if (nextValue !== null || currentDraft[key] !== null) {
      patch[key] = nextValue;
    }
  }

  const trimmedFollowup = followupText.trim();
  if (parsed.appendRawText === true && trimmedFollowup !== '') {
    patch.rawText = currentDraft.rawText.includes(trimmedFollowup)
      ? currentDraft.rawText
      : `${currentDraft.rawText}；补充：${trimmedFollowup}`;
  }

  return patch as CaptureDraftPatch;
}

/** 校验外部传入的 CaptureDraft 合法性（如二阶段追问抽取前的当前草稿边界校验）。 */
export function validateCaptureDraft(value: unknown): CaptureDraft {
  if (!isPlainObject(value)) {
    throw new Error('currentDraft 必须是对象。');
  }
  if (typeof value.modality !== 'string' || !(MODALITIES as readonly string[]).includes(value.modality)) {
    throw new Error('currentDraft.modality 无效。');
  }
  const sourceRef =
    value.sourceRef === undefined || value.sourceRef === null || value.sourceRef === ''
      ? null
      : value.sourceRef;
  if (sourceRef !== null && !isControlledSourceRef(sourceRef)) {
    throw new Error('currentDraft.sourceRef 必须是受控相对路径或 null。');
  }
  const rawText = typeof value.rawText === 'string' ? value.rawText.trim() : '';
  if (rawText === '') {
    throw new Error('currentDraft.rawText 不能为空。');
  }
  return {
    amount: normalizeAmount(value.amount),
    merchant: normalizeMerchant(value.merchant),
    occurredAt: normalizeOccurredAt(value.occurredAt),
    direction: normalizeDirection(value.direction),
    confidence: normalizeConfidence(value.confidence),
    rawText,
    modality: value.modality as CaptureModality,
    sourceRef
  };
}

/** 安全合并追问补丁到当前草稿；不修改未被补丁触及的字段，也不修改 modality/sourceRef。 */
export function mergeDraftPatch(current: CaptureDraft, patch: CaptureDraftPatch): CaptureDraft {
  return {
    amount: patch.amount !== undefined ? patch.amount : current.amount,
    merchant: patch.merchant !== undefined ? patch.merchant : current.merchant,
    occurredAt: patch.occurredAt !== undefined ? patch.occurredAt : current.occurredAt,
    direction: patch.direction !== undefined ? patch.direction : current.direction,
    confidence: patch.confidence !== undefined ? patch.confidence : current.confidence,
    rawText: patch.rawText !== undefined ? patch.rawText : current.rawText,
    modality: current.modality,
    sourceRef: current.sourceRef
  };
}
