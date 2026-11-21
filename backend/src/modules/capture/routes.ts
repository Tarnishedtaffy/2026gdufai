import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError } from '../../shared/errors.ts';
import type { CaptureExtractor } from './extractor.ts';
import {
  isPlainObject,
  normalizeReferenceTime,
  validatePendingFeedbackHints
} from './normalizers.ts';
import { validateCaptureDraft } from './schema.ts';
import { saveCaptureUpload, verifyCaptureUploadRef } from './storage.ts';
import type { CaptureFailure, CaptureModality, PendingFeedbackHint } from './types.ts';

const MAX_UPLOAD_FILE_BYTES = 15 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + 128 * 1024;

/** M1 HTTP 路由插件参数。 */
export interface CaptureRoutesOptions {
  readonly extractor: CaptureExtractor;
}

function sendAppError(reply: FastifyReply, error: AppError): FastifyReply {
  return reply.status(error.statusCode).send({
    error: {
      code: error.code,
      message: error.message,
      field: error.field,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  });
}

function invalidUpload(message: string, statusCode = 400, field = 'file'): AppError {
  return new AppError('INVALID_UPLOAD', statusCode, message, { field });
}

function invalidCaptureInput(message: string, field: string): AppError {
  return new AppError('INVALID_CAPTURE_INPUT', 422, message, { field });
}

function mapCaptureFailureToAppError(
  failure: CaptureFailure,
  context: 'upload' | 'extract',
  fieldOverride?: string
): AppError {
  const field = fieldOverride ?? (failure.field === 'referenceTime' ? 'sentAt' : failure.field);

  switch (failure.code) {
    case 'UPLOAD_EMPTY_FILE':
      return new AppError('INVALID_UPLOAD', 400, failure.message, { field });
    case 'UPLOAD_TOO_LARGE':
      return new AppError('INVALID_UPLOAD', 413, failure.message, { field });
    case 'UPLOAD_UNSUPPORTED_TYPE':
      return new AppError('INVALID_UPLOAD', 415, failure.message, { field });
    case 'EMPTY_INPUT':
    case 'INVALID_SOURCE_REF':
    case 'INVALID_CAPTURE_INPUT':
      return context === 'upload'
        ? new AppError('INVALID_UPLOAD', 400, failure.message, { field })
        : new AppError('INVALID_CAPTURE_INPUT', 422, failure.message, { field });
    case 'EMPTY_TRANSCRIPT':
    case 'UNREADABLE_RECEIPT':
      return new AppError('CAPTURE_EMPTY_RECOGNITION', 422, failure.message, { field });
    case 'AI_NOT_CONFIGURED':
      return new AppError('AI_UPSTREAM_ERROR', 503, failure.message, { field });
    case 'AI_UPSTREAM_ERROR':
    case 'AI_INVALID_OUTPUT':
      return new AppError('AI_UPSTREAM_ERROR', 502, failure.message, { field });
  }
}

function parseStrictModality(value: unknown, field = 'modality'): CaptureModality {
  if (value === 'text' || value === 'image' || value === 'voice') {
    return value;
  }
  throw invalidCaptureInput('modality 必须是 text / image / voice。', field);
}

function parseStrictSentAt(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidCaptureInput('sentAt 必须是非空 ISO-8601 时间字符串。', 'sentAt');
  }
  try {
    return normalizeReferenceTime(value);
  } catch (error: unknown) {
    throw invalidCaptureInput(
      error instanceof Error ? error.message : 'sentAt 不是合法的 ISO-8601 时间。',
      'sentAt'
    );
  }
}

/**
 * 注册 M1 受控文件上传与草稿抽取路由（契约 #24 v1.6）。
 * 两个接口均挂在 `/api/capture/*` 复用全局 Bearer 鉴权；`extract` 只产出草稿或补丁，不调用入库接口。
 */
export async function registerCaptureRoutes(
  app: FastifyInstance,
  options: CaptureRoutesOptions
): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendAppError(reply, error);
    }

    const errCode = (error as { code?: unknown }).code;
    const isUploadRoute = request.url.startsWith('/api/capture/uploads');

    if (errCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return sendAppError(
        reply,
        isUploadRoute
          ? invalidUpload('请求头 Content-Type 必须是 multipart/form-data。')
          : invalidCaptureInput('请求头 Content-Type 必须是 application/json。', 'body')
      );
    }
    if (errCode === 'FST_ERR_CTP_INVALID_JSON_BODY' || errCode === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return sendAppError(reply, invalidCaptureInput('请求体必须是合法的非空 JSON。', 'body'));
    }
    if (errCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return sendAppError(
        reply,
        isUploadRoute
          ? invalidUpload('上传文件超过限制（上限 15 MB）。', 413)
          : invalidCaptureInput('抽取请求体过大。', 'body')
      );
    }

    request.log.error({ err: error }, 'unhandled capture route error');
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' }
    });
  });

  app.addContentTypeParser(
    'multipart/form-data',
    { bodyLimit: MAX_MULTIPART_BODY_BYTES },
    (request, payload, done) => {
      let settled = false;
      const finish = (error: Error | null, body?: Buffer): void => {
        if (settled) {
          return;
        }
        settled = true;
        done(error, body);
      };

      const contentLengthHeader = request.headers['content-length'];
      const declaredLength =
        typeof contentLengthHeader === 'string'
          ? Number.parseInt(contentLengthHeader, 10)
          : Number.NaN;
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BODY_BYTES) {
        payload.resume();
        finish(invalidUpload('上传文件超过限制（上限 15 MB）。', 413));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      payload.on('data', (chunk: Uint8Array | string) => {
        if (settled) {
          return;
        }
        const buf =
          typeof chunk === 'string'
            ? Buffer.from(chunk)
            : Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        totalBytes += buf.byteLength;
        if (totalBytes > MAX_MULTIPART_BODY_BYTES) {
          chunks.length = 0;
          payload.resume();
          finish(invalidUpload('上传文件超过限制（上限 15 MB）。', 413));
          return;
        }
        chunks.push(buf);
      });

      payload.on('end', () => {
        finish(null, Buffer.concat(chunks, totalBytes));
      });

      payload.on('error', (error) => {
        finish(invalidUpload(error.message || '读取上传流失败。', 400));
      });
    }
  );

  app.post('/api/capture/uploads', { bodyLimit: MAX_MULTIPART_BODY_BYTES }, async (request, reply) => {
    const contentType = request.headers['content-type'];
    if (
      typeof contentType !== 'string' ||
      !contentType.toLowerCase().startsWith('multipart/form-data') ||
      !Buffer.isBuffer(request.body)
    ) {
      throw invalidUpload('请求必须是包含 file 字段的 multipart/form-data。');
    }

    let formData: FormData;
    try {
      formData = await new Response(new Uint8Array(request.body), {
        headers: { 'content-type': contentType }
      }).formData();
    } catch {
      throw invalidUpload('multipart/form-data 格式无效或内容不完整。');
    }

    const fileEntries = formData.getAll('file');
    let totalBlobCount = 0;
    formData.forEach((value) => {
      if (typeof value !== 'string') {
        totalBlobCount += 1;
      }
    });

    if (fileEntries.length === 0) {
      throw invalidUpload('缺少上传文件字段 file。');
    }
    if (fileEntries.length > 1 || totalBlobCount > 1) {
      throw invalidUpload('每次请求仅允许上传单个文件。');
    }

    const fileEntry = fileEntries[0];
    if (fileEntry === undefined || typeof fileEntry === 'string') {
      throw invalidUpload('file 字段必须是二进制文件。');
    }

    const bytes = new Uint8Array(await fileEntry.arrayBuffer());
    const outcome = await saveCaptureUpload({
      uploadDir: app.config.uploadDir,
      bytes,
      mimeType: fileEntry.type
    });
    if (!outcome.ok) {
      throw mapCaptureFailureToAppError(outcome.failure, 'upload');
    }

    return reply.status(201).send(outcome.upload);
  });

  app.post('/api/capture/extract', async (request, reply) => {
    if (!isPlainObject(request.body)) {
      throw invalidCaptureInput('请求体必须是 JSON 对象。', 'body');
    }
    const body = request.body;
    if (body.mode !== 'draft' && body.mode !== 'followup') {
      throw invalidCaptureInput('mode 必须是 draft 或 followup。', 'mode');
    }

    const validSentAt = parseStrictSentAt(body.sentAt);

    if (body.mode === 'draft') {
      const modality = parseStrictModality(body.modality);
      if (modality === 'text') {
        if (body.sourceRef !== undefined && body.sourceRef !== null) {
          throw invalidCaptureInput('text 模态抽取不接受 sourceRef，请传 null 或省略。', 'sourceRef');
        }
        if (typeof body.rawText !== 'string' || body.rawText.trim() === '') {
          throw invalidCaptureInput('rawText 必须是非空字符串。', 'rawText');
        }
        const outcome = await options.extractor.extractFromText({
          rawText: body.rawText,
          referenceTime: validSentAt
        });
        if (!outcome.ok) {
          throw mapCaptureFailureToAppError(outcome.failure, 'extract');
        }
        return reply.status(200).send({ drafts: outcome.drafts });
      }

      if (typeof body.sourceRef !== 'string' || body.sourceRef.trim() === '') {
        throw invalidCaptureInput(`${modality} 模态抽取必须提供有效的 sourceRef。`, 'sourceRef');
      }
      const outcome =
        modality === 'image'
          ? await options.extractor.extractFromImage({
              sourceRef: body.sourceRef,
              referenceTime: validSentAt
            })
          : await options.extractor.extractFromVoice({
              sourceRef: body.sourceRef,
              referenceTime: validSentAt
            });
      if (!outcome.ok) {
        throw mapCaptureFailureToAppError(outcome.failure, 'extract');
      }
      return reply.status(200).send({ drafts: outcome.drafts });
    }

    let validDraft;
    try {
      validDraft = validateCaptureDraft(body.currentDraft);
    } catch (error: unknown) {
      throw invalidCaptureInput(
        error instanceof Error ? error.message : 'currentDraft 无效。',
        'currentDraft'
      );
    }

    if (body.modality !== undefined) {
      const declaredModality = parseStrictModality(body.modality);
      if (declaredModality !== validDraft.modality) {
        throw invalidCaptureInput(
          'followup 模式不得改写 currentDraft 原有的 modality。',
          'modality'
        );
      }
    }

    if (validDraft.modality === 'text') {
      if (validDraft.sourceRef !== null) {
        throw invalidCaptureInput(
          'text 模态的 currentDraft.sourceRef 必须为 null。',
          'currentDraft.sourceRef'
        );
      }
    } else {
      if (validDraft.sourceRef === null) {
        throw invalidCaptureInput(
          `${validDraft.modality} 模态的 currentDraft.sourceRef 不能为空。`,
          'currentDraft.sourceRef'
        );
      }
      const verified = await verifyCaptureUploadRef(
        app.config.uploadDir,
        validDraft.sourceRef,
        validDraft.modality
      );
      if (!verified.ok) {
        throw mapCaptureFailureToAppError(
          verified.failure,
          'extract',
          verified.failure.field === 'sourceRef' ? 'currentDraft.sourceRef' : verified.failure.field
        );
      }
    }

    if (typeof body.followupText !== 'string' || body.followupText.trim() === '') {
      throw invalidCaptureInput('followupText 必须是非空字符串。', 'followupText');
    }

    const feedbackFailure = validatePendingFeedbackHints(
      body.pendingFeedback as readonly PendingFeedbackHint[] | undefined
    );
    if (feedbackFailure !== null) {
      throw mapCaptureFailureToAppError(feedbackFailure, 'extract');
    }

    const outcome = await options.extractor.extractFollowupPatch({
      currentDraft: validDraft,
      followupText: body.followupText,
      pendingFeedback: body.pendingFeedback as readonly PendingFeedbackHint[] | undefined,
      referenceTime: validSentAt
    });
    if (!outcome.ok) {
      throw mapCaptureFailureToAppError(outcome.failure, 'extract');
    }

    return reply.status(200).send({ patch: outcome.patch });
  });
}
