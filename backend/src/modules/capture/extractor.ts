import { MAX_CAPTURE_TEXT_LENGTH, validatePendingFeedbackHints } from './normalizers.ts';
import { buildFollowupExtractionPrompts, PROMPT_VERSION_FOLLOWUP } from './prompts/extract-followup.ts';
import { buildReceiptExtractionPrompts, PROMPT_VERSION_RECEIPT } from './prompts/extract-receipt.ts';
import { buildTextExtractionPrompts, PROMPT_VERSION_TEXT } from './prompts/extract-text.ts';
import {
  normalizeReferenceTime,
  parseExtractedDrafts,
  parseExtractedFollowupPatch,
  parseExtractedReceipt,
  validateCaptureDraft
} from './schema.ts';
import { readCaptureUpload } from './storage.ts';
import {
  CaptureProviderError,
  type CaptureAiProvider,
  type CaptureDraft,
  type CaptureFailure,
  type CaptureModality,
  type DraftExtractionOutcome,
  type PatchExtractionOutcome,
  type PendingFeedbackHint
} from './types.ts';

/** 抽取服务依赖配置。 */
export interface CaptureExtractorDeps {
  readonly provider: CaptureAiProvider;
  readonly uploadDir: string;
  /** 模型输出格式校验失败时的最大重试次数，默认 1 次。 */
  readonly maxRetries?: number;
}

/** 文本抽取入参。 */
export interface ExtractTextInput {
  readonly rawText: string;
  readonly referenceTime: string;
}

/** 追问补充抽取入参。 */
export interface ExtractFollowupInput {
  readonly currentDraft: CaptureDraft;
  readonly followupText: string;
  readonly pendingFeedback?: readonly PendingFeedbackHint[];
  readonly referenceTime: string;
}

/** 图片/语音抽取入参（sourceRef 必须由服务端受控上传返回）。 */
export interface ExtractMediaInput {
  readonly sourceRef: string;
  readonly referenceTime: string;
}

/** M1 识别与字段抽取服务接口。 */
export interface CaptureExtractor {
  extractFromText: (input: ExtractTextInput) => Promise<DraftExtractionOutcome>;
  extractFollowupPatch: (input: ExtractFollowupInput) => Promise<PatchExtractionOutcome>;
  extractFromVoice: (input: ExtractMediaInput) => Promise<DraftExtractionOutcome>;
  extractFromImage: (input: ExtractMediaInput) => Promise<DraftExtractionOutcome>;
}

function toProviderFailure(error: unknown, fallbackMessage: string): CaptureFailure {
  if (error instanceof CaptureProviderError) {
    return { code: error.code, message: error.message };
  }
  const detail = error instanceof Error ? error.message : fallbackMessage;
  return { code: 'AI_INVALID_OUTPUT', message: detail };
}

function failRefTime(error: unknown): { readonly ok: false; readonly failure: CaptureFailure } {
  return {
    ok: false,
    failure: {
      code: 'EMPTY_INPUT',
      field: 'referenceTime',
      message: error instanceof Error ? error.message : 'referenceTime 无效。'
    }
  };
}

async function readTypedMedia(
  uploadDir: string,
  sourceRef: string,
  expectedModality: 'image' | 'voice'
) {
  const fileOutcome = await readCaptureUpload(uploadDir, sourceRef);
  if (!fileOutcome.ok) {
    return fileOutcome;
  }
  if (fileOutcome.modality !== expectedModality) {
    return {
      ok: false as const,
      failure: {
        code: 'INVALID_SOURCE_REF' as const,
        message: `sourceRef 指向的文件不是${expectedModality === 'voice' ? '语音' : '图片'}格式。`,
        field: 'sourceRef'
      }
    };
  }
  return fileOutcome;
}

async function runWithSchemaRetry<T>(
  maxRetries: number,
  runOnce: () => Promise<T>,
  fallbackMessage: string
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: CaptureFailure }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return { ok: true, value: await runOnce() };
    } catch (error: unknown) {
      if (error instanceof CaptureProviderError && error.code !== 'AI_INVALID_OUTPUT') {
        return { ok: false, failure: { code: error.code, message: error.message } };
      }
      if (attempt === maxRetries) {
        return { ok: false, failure: toProviderFailure(error, fallbackMessage) };
      }
    }
  }
  return { ok: false, failure: { code: 'AI_INVALID_OUTPUT', message: fallbackMessage } };
}

/**
 * 创建 M1 多模态识别与字段抽取服务。
 * 所有输出均通过运行时 schema 校验；不生成身份/幂等字段，也不调用 M2 入库。
 */
export function createCaptureExtractor(deps: CaptureExtractorDeps): CaptureExtractor {
  const maxRetries = deps.maxRetries ?? 1;

  async function extractDraftsFromRawText(
    rawText: string,
    referenceTime: string,
    modality: CaptureModality,
    sourceRef: string | null
  ): Promise<DraftExtractionOutcome> {
    let validRefTime: string;
    try {
      validRefTime = normalizeReferenceTime(referenceTime);
    } catch (error: unknown) {
      return failRefTime(error);
    }

    const prompts = buildTextExtractionPrompts({ rawText, referenceTime: validRefTime });
    const result = await runWithSchemaRetry(
      maxRetries,
      async () => {
        const rawJson = await deps.provider.completeJson(prompts);
        return parseExtractedDrafts(rawJson, { modality, sourceRef, fallbackRawText: rawText });
      },
      '文本抽取结果格式异常，请重试或手工核对。'
    );

    return result.ok
      ? { ok: true, drafts: result.value, promptVersion: PROMPT_VERSION_TEXT }
      : result;
  }

  return {
    async extractFromText(input: ExtractTextInput): Promise<DraftExtractionOutcome> {
      const trimmed = input.rawText.trim();
      if (trimmed === '') {
        return {
          ok: false,
          failure: { code: 'EMPTY_INPUT', message: '请输入需要记账的文字内容。', field: 'rawText' }
        };
      }
      if (trimmed.length > MAX_CAPTURE_TEXT_LENGTH) {
        return {
          ok: false,
          failure: {
            code: 'INVALID_CAPTURE_INPUT',
            message: `输入文本长度不能超过 ${MAX_CAPTURE_TEXT_LENGTH} 字符。`,
            field: 'rawText'
          }
        };
      }
      return extractDraftsFromRawText(trimmed, input.referenceTime, 'text', null);
    },

    async extractFollowupPatch(input: ExtractFollowupInput): Promise<PatchExtractionOutcome> {
      const trimmedFollowup = input.followupText.trim();
      if (trimmedFollowup === '') {
        return {
          ok: false,
          failure: { code: 'EMPTY_INPUT', message: '请输入追问补充内容。', field: 'followupText' }
        };
      }
      if (trimmedFollowup.length > MAX_CAPTURE_TEXT_LENGTH) {
        return {
          ok: false,
          failure: {
            code: 'INVALID_CAPTURE_INPUT',
            message: `追问补充长度不能超过 ${MAX_CAPTURE_TEXT_LENGTH} 字符。`,
            field: 'followupText'
          }
        };
      }

      let validDraft: CaptureDraft;
      let validRefTime: string;
      try {
        validDraft = validateCaptureDraft(input.currentDraft);
        validRefTime = normalizeReferenceTime(input.referenceTime);
      } catch (error: unknown) {
        return {
          ok: false,
          failure: {
            code: 'EMPTY_INPUT',
            message: error instanceof Error ? error.message : '追问上下文无效。'
          }
        };
      }

      const feedbackFailure = validatePendingFeedbackHints(input.pendingFeedback);
      if (feedbackFailure !== null) {
        return { ok: false, failure: feedbackFailure };
      }

      const prompts = buildFollowupExtractionPrompts({
        currentDraft: validDraft,
        followupText: trimmedFollowup,
        pendingFeedback: input.pendingFeedback,
        referenceTime: validRefTime
      });

      const result = await runWithSchemaRetry(
        maxRetries,
        async () => {
          const rawJson = await deps.provider.completeJson(prompts);
          return parseExtractedFollowupPatch(rawJson, validDraft, trimmedFollowup);
        },
        '追问补充抽取结果格式异常，请重试或直接修改表单字段。'
      );

      return result.ok
        ? { ok: true, patch: result.value, promptVersion: PROMPT_VERSION_FOLLOWUP }
        : result;
    },

    async extractFromVoice(input: ExtractMediaInput): Promise<DraftExtractionOutcome> {
      const fileOutcome = await readTypedMedia(deps.uploadDir, input.sourceRef, 'voice');
      if (!fileOutcome.ok) {
        return fileOutcome;
      }

      let validRefTime: string;
      try {
        validRefTime = normalizeReferenceTime(input.referenceTime);
      } catch (error: unknown) {
        return failRefTime(error);
      }

      let transcript: string;
      try {
        transcript = (
          await deps.provider.transcribeAudio({
            audioBytes: fileOutcome.bytes,
            mimeType: fileOutcome.mimeType,
            filename: fileOutcome.filename
          })
        ).trim();
      } catch (error: unknown) {
        return { ok: false, failure: toProviderFailure(error, '语音转写失败。') };
      }

      if (transcript === '') {
        return {
          ok: false,
          failure: {
            code: 'EMPTY_TRANSCRIPT',
            message: '未能识别出有效语音内容，请重新录音或改用文字输入。',
            field: 'sourceRef'
          }
        };
      }

      return extractDraftsFromRawText(transcript, validRefTime, 'voice', input.sourceRef);
    },

    async extractFromImage(input: ExtractMediaInput): Promise<DraftExtractionOutcome> {
      const fileOutcome = await readTypedMedia(deps.uploadDir, input.sourceRef, 'image');
      if (!fileOutcome.ok) {
        return fileOutcome;
      }

      let validRefTime: string;
      try {
        validRefTime = normalizeReferenceTime(input.referenceTime);
      } catch (error: unknown) {
        return failRefTime(error);
      }

      const prompts = buildReceiptExtractionPrompts({ referenceTime: validRefTime });
      const result = await runWithSchemaRetry(
        maxRetries,
        async () => {
          const rawJson = await deps.provider.completeVisionJson({
            ...prompts,
            imageBytes: fileOutcome.bytes,
            mimeType: fileOutcome.mimeType
          });
          return parseExtractedReceipt(rawJson, input.sourceRef);
        },
        '小票识别输出格式异常，请重试或手工补录。'
      );

      if (!result.ok) {
        return result;
      }
      if (!result.value.readable) {
        return {
          ok: false,
          failure: {
            code: 'UNREADABLE_RECEIPT',
            message: result.value.reason,
            field: 'sourceRef'
          }
        };
      }
      return { ok: true, drafts: result.value.drafts, promptVersion: PROMPT_VERSION_RECEIPT };
    }
  };
}
