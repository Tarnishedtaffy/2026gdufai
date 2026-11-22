import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadAiConfig, type AppConfig } from '../../src/config/index.ts';
import { openDatabase, type Db } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';
import { seedDemoUser } from '../../src/db/seed/users.ts';
import {
  CaptureProviderError,
  createCaptureExtractor,
  createCaptureSession,
  createOpenAiCompatibleProvider,
  type CaptureAiProvider,
  type CaptureDraft
} from '../../src/modules/capture/index.ts';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const SENT_AT = '2026-11-21T12:00:00+08:00';

const cleanups: (() => Promise<void>)[] = [];

function buildPcmWav(durationSeconds: number, sampleRate = 4000): Uint8Array {
  const byteRate = sampleRate * 2;
  const dataBytes = byteRate * durationSeconds;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

function buildMultipartBody(
  boundary: string,
  parts: readonly {
    readonly name: string;
    readonly filename?: string;
    readonly contentType?: string;
    readonly bytes: Uint8Array | string;
  }[]
): { readonly contentType: string; readonly payload: Buffer } {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    const filenameSegment = part.filename !== undefined ? `; filename="${part.filename}"` : '';
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${part.name}"${filenameSegment}\r\n`)
    );
    if (part.contentType !== undefined) {
      chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    }
    chunks.push(Buffer.from('\r\n'));
    chunks.push(typeof part.bytes === 'string' ? Buffer.from(part.bytes) : Buffer.from(part.bytes));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat(chunks)
  };
}

async function setupHarness(options?: {
  readonly authToken?: string | null;
  readonly provider?: CaptureAiProvider;
  readonly omitExtractor?: boolean;
}) {
  const uploadDir = await mkdtemp(join(tmpdir(), 'gdufai-routes-test-'));
  const db: Db = openDatabase(':memory:');
  seedCategories(db);
  seedDemoUser(db, 'u_001');

  const config: AppConfig = {
    port: 0,
    nodeEnv: 'test',
    databasePath: ':memory:',
    uploadDir,
    authToken: options?.authToken ?? null,
    demoUserId: 'u_001'
  };

  let aiCalls = 0;
  const provider: CaptureAiProvider = options?.provider ?? {
    async completeJson(input) {
      aiCalls += 1;
      if (input.systemPrompt.includes('追问') || input.userPrompt.includes('currentDraft:')) {
        return JSON.stringify({ patch: { amount: 42.5 } });
      }
      return JSON.stringify({
        records: [
          {
            amount: 32.5,
            merchant: '瑞幸咖啡',
            occurredAt: SENT_AT,
            direction: 'expense',
            confidence: 0.92,
            rawText: '早上瑞幸花了32块5'
          }
        ]
      });
    },
    async completeVisionJson() {
      aiCalls += 1;
      return JSON.stringify({
        readable: true,
        ocrText: '星巴克 实付 42.00',
        records: [
          {
            amount: 42,
            merchant: '星巴克',
            occurredAt: SENT_AT,
            direction: 'expense',
            confidence: 0.94,
            rawText: '星巴克门店实付42元'
          }
        ]
      });
    },
    async transcribeAudio() {
      aiCalls += 1;
      return '打车三十八元';
    }
  };

  const app = buildApp({
    config,
    db,
    ...(options?.omitExtractor
      ? {}
      : { captureExtractor: createCaptureExtractor({ uploadDir, provider }) })
  });

  cleanups.push(async () => {
    await app.close();
    db.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  return { app, db, config, uploadDir, getAiCalls: () => aiCalls };
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      await fn();
    }
  }
});

describe('M1 第二阶段：/api/capture/uploads 与 /api/capture/extract HTTP 路由', () => {
  it('复用 /api/* Bearer 鉴权拦截未认证上传与抽取请求', async () => {
    const { app } = await setupHarness({ authToken: 'secret-token' });

    const uploadNoAuth = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads'
    });
    expect(uploadNoAuth.statusCode).toBe(401);
    expect(uploadNoAuth.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

    const extractWrongAuth = await app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      headers: { authorization: 'Bearer wrong' },
      payload: { mode: 'draft', modality: 'text', rawText: '咖啡25元', sentAt: SENT_AT }
    });
    expect(extractWrongAuth.statusCode).toBe(401);
    expect(extractWrongAuth.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

    const extractOk = await app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      headers: { authorization: 'Bearer secret-token' },
      payload: { mode: 'draft', modality: 'text', rawText: '瑞幸32块5', sentAt: SENT_AT }
    });
    expect(extractOk.statusCode).toBe(200);
  });

  it('POST /api/capture/uploads 严格执行类型、魔数与大小校验（含 > 1 MiB 合法语音上传）', async () => {
    const { app } = await setupHarness();

    // 合法 JPEG 上传（201）
    const okJpg = buildMultipartBody('b-jpg', [
      { name: 'file', filename: 'receipt.jpg', contentType: 'image/jpeg', bytes: JPEG_BYTES }
    ]);
    const resJpg = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': okJpg.contentType },
      payload: okJpg.payload
    });
    expect(resJpg.statusCode).toBe(201);
    expect(resJpg.json()).toMatchObject({
      sourceRef: expect.stringMatching(/^uploads\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.jpg$/),
      modality: 'image',
      mimeType: 'image/jpeg',
      byteLength: JPEG_BYTES.byteLength
    });

    // 超过 Fastify 默认 1 MiB 但 ≤ 15 MiB 的合法 WAV 上传（201）
    const wav1500Kb = Buffer.alloc(1500 * 1024);
    Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ').copy(wav1500Kb, 0);
    const okWav = buildMultipartBody('b-wav', [
      { name: 'file', filename: 'voice.wav', contentType: 'audio/wav', bytes: wav1500Kb }
    ]);
    const resWav = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': okWav.contentType },
      payload: okWav.payload
    });
    expect(resWav.statusCode).toBe(201);
    expect(resWav.json()).toMatchObject({ modality: 'voice', mimeType: 'audio/wav' });

    // 空文件 → 400 INVALID_UPLOAD
    const emptyForm = buildMultipartBody('b-empty', [
      { name: 'file', filename: 'empty.png', contentType: 'image/png', bytes: new Uint8Array(0) }
    ]);
    const resEmpty = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': emptyForm.contentType },
      payload: emptyForm.payload
    });
    expect(resEmpty.statusCode).toBe(400);
    expect(resEmpty.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    // 缺少 file 字段 / 非 multipart / 损坏 multipart / 多文件 → 400 INVALID_UPLOAD
    const wrongField = buildMultipartBody('b-wrong-field', [
      { name: 'image', filename: 'a.png', contentType: 'image/png', bytes: PNG_BYTES }
    ]);
    const resWrongField = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': wrongField.contentType },
      payload: wrongField.payload
    });
    expect(resWrongField.statusCode).toBe(400);
    expect(resWrongField.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD', field: 'file' } });

    const twoFiles = buildMultipartBody('b-two', [
      { name: 'file', filename: 'a.png', contentType: 'image/png', bytes: PNG_BYTES },
      { name: 'other', filename: 'b.jpg', contentType: 'image/jpeg', bytes: JPEG_BYTES }
    ]);
    const resTwo = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': twoFiles.contentType },
      payload: twoFiles.payload
    });
    expect(resTwo.statusCode).toBe(400);
    expect(resTwo.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    const resMalformed = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': 'multipart/form-data; boundary=broken' },
      payload: 'not-multipart-body'
    });
    expect(resMalformed.statusCode).toBe(400);
    expect(resMalformed.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    const resJsonType = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      payload: {}
    });
    expect(resJsonType.statusCode).toBe(400);
    expect(resJsonType.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    // 假 PNG 魔数 / 不支持 MIME / 原型链 MIME → 415 INVALID_UPLOAD
    const spoofedPng = buildMultipartBody('b-spoof', [
      { name: 'file', filename: 'fake.png', contentType: 'image/png', bytes: 'not-a-png' }
    ]);
    const resSpoof = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': spoofedPng.contentType },
      payload: spoofedPng.payload
    });
    expect(resSpoof.statusCode).toBe(415);
    expect(resSpoof.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    const protoMime = buildMultipartBody('b-proto', [
      { name: 'file', filename: 'a.bin', contentType: 'constructor', bytes: PNG_BYTES }
    ]);
    const resProto = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': protoMime.contentType },
      payload: protoMime.payload
    });
    expect(resProto.statusCode).toBe(415);
    expect(resProto.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    // 超出图片 10 MiB / 超出请求体 15 MiB 硬上限 → 413 INVALID_UPLOAD
    const bigPng = buildMultipartBody('b-big-png', [
      {
        name: 'file',
        filename: 'big.png',
        contentType: 'image/png',
        bytes: Buffer.concat([PNG_BYTES, Buffer.alloc(10 * 1024 * 1024)])
      }
    ]);
    const resBigPng = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': bigPng.contentType },
      payload: bigPng.payload
    });
    expect(resBigPng.statusCode).toBe(413);
    expect(resBigPng.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    const resOverBodyLimit = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': 'multipart/form-data; boundary=huge' },
      payload: Buffer.alloc(15 * 1024 * 1024 + 256 * 1024)
    });
    expect(resOverBodyLimit.statusCode).toBe(413);
    expect(resOverBodyLimit.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });
  });

  it('POST /api/capture/extract 区分 mode/modality、拦截非法输入、映射空识别与上游错误且绝不写库', async () => {
    const { app, db, getAiCalls } = await setupHarness();

    const upImg = buildMultipartBody('b-up-img', [
      { name: 'file', filename: 'r.png', contentType: 'image/png', bytes: PNG_BYTES }
    ]);
    const uploadedImg = (
      await app.inject({
        method: 'POST',
        url: '/api/capture/uploads',
        headers: { 'content-type': upImg.contentType },
        payload: upImg.payload
      })
    ).json() as { sourceRef: string };

    const upVoice = buildMultipartBody('b-up-wav', [
      { name: 'file', filename: 'v.wav', contentType: 'audio/wav', bytes: buildPcmWav(2) }
    ]);
    const uploadedVoice = (
      await app.inject({
        method: 'POST',
        url: '/api/capture/uploads',
        headers: { 'content-type': upVoice.contentType },
        payload: upVoice.payload
      })
    ).json() as { sourceRef: string };

    // 校验错误均返回 422 INVALID_CAPTURE_INPUT 且不调用 AI
    const callsBeforeValidation = getAiCalls();
    for (const invalidReq of [
      { payload: { mode: 'invalid', modality: 'text', rawText: 'a', sentAt: SENT_AT }, field: 'mode' },
      { payload: { mode: ['draft'], modality: 'text', rawText: 'a', sentAt: SENT_AT }, field: 'mode' },
      { payload: { mode: 'draft', modality: 'video', rawText: 'a', sentAt: SENT_AT }, field: 'modality' },
      { payload: { mode: 'draft', modality: 'text', rawText: '   ', sentAt: SENT_AT }, field: 'rawText' },
      {
        payload: {
          mode: 'draft',
          modality: 'text',
          rawText: 'a',
          sourceRef: uploadedImg.sourceRef,
          sentAt: SENT_AT
        },
        field: 'sourceRef'
      },
      {
        payload: { mode: 'draft', modality: 'text', rawText: 'a', sentAt: '2026-02-31T12:00:00+08:00' },
        field: 'sentAt'
      },
      {
        payload: { mode: 'draft', modality: 'image', sourceRef: uploadedVoice.sourceRef, sentAt: SENT_AT },
        field: 'sourceRef'
      },
      {
        payload: {
          mode: 'draft',
          modality: 'image',
          sourceRef: 'uploads/2026/11/00000000-0000-0000-0000-000000000000.png',
          sentAt: SENT_AT
        },
        field: 'sourceRef'
      },
      {
        payload: {
          mode: 'followup',
          modality: 'text',
          currentDraft: {
            amount: null,
            merchant: '星巴克',
            occurredAt: SENT_AT,
            direction: 'expense',
            confidence: 0.9,
            rawText: '星巴克小票',
            modality: 'image',
            sourceRef: uploadedImg.sourceRef
          },
          followupText: '实付42.5',
          sentAt: SENT_AT
        },
        field: 'modality'
      },
      {
        payload: {
          mode: 'followup',
          currentDraft: {
            amount: null,
            merchant: '瑞幸',
            occurredAt: SENT_AT,
            direction: 'expense',
            confidence: 0.9,
            rawText: '早上买咖啡',
            modality: 'text',
            sourceRef: null
          },
          followupText: '32块5',
          pendingFeedback: [{ field: 'amount', code: 'REFUND_NOT_SUPPORTED', severity: 'blocking' }],
          sentAt: SENT_AT
        },
        field: 'pendingFeedback[0].code'
      },
      {
        payload: {
          mode: 'followup',
          currentDraft: {
            amount: null,
            merchant: '瑞幸',
            occurredAt: SENT_AT,
            direction: 'expense',
            confidence: 0.9,
            rawText: '早上买咖啡',
            modality: 'text',
            sourceRef: uploadedImg.sourceRef
          },
          followupText: '32块5',
          sentAt: SENT_AT
        },
        field: 'currentDraft.sourceRef'
      },
      {
        payload: {
          mode: 'followup',
          currentDraft: {
            amount: null,
            merchant: '瑞幸',
            occurredAt: SENT_AT,
            direction: 'expense',
            confidence: 0.9,
            rawText: '早上买咖啡',
            modality: 'text',
            sourceRef: null
          },
          followupText: '32块5',
          pendingFeedback: [{ field: 123, code: 'MISSING_AMOUNT', severity: 'blocking' }],
          sentAt: SENT_AT
        },
        field: 'pendingFeedback[0].field'
      },
      {
        payload: {
          mode: 'draft',
          modality: 'text',
          rawText: '瑞幸32元',
          pendingFeedback: [],
          sentAt: SENT_AT
        },
        field: 'pendingFeedback'
      },
      {
        payload: {
          mode: 'draft',
          modality: 'text',
          rawText: '瑞幸32元',
          followupText: '补充说明',
          sentAt: SENT_AT
        },
        field: 'followupText'
      },
      {
        payload: {
          mode: 'draft',
          modality: 'text',
          rawText: '瑞幸32元',
          currentDraft: {},
          sentAt: SENT_AT
        },
        field: 'currentDraft'
      }
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/capture/extract',
        payload: invalidReq.payload
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        error: { code: 'INVALID_CAPTURE_INPUT', field: invalidReq.field }
      });
    }
    expect(getAiCalls()).toBe(callsBeforeValidation);

    // 坏 JSON 也返回 422 INVALID_CAPTURE_INPUT
    const badJson = await app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      headers: { 'content-type': 'application/json' },
      payload: '{bad-json'
    });
    expect(badJson.statusCode).toBe(422);
    expect(badJson.json()).toMatchObject({
      error: { code: 'INVALID_CAPTURE_INPUT', field: 'body' }
    });

    // 追问允许携带契约 v1.4 / v1.5 现行反馈码（不调用写入）
    const okFollowup = await app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: {
        mode: 'followup',
        currentDraft: {
          amount: null,
          merchant: '星巴克',
          occurredAt: SENT_AT,
          direction: 'expense',
          confidence: 0.85,
          rawText: '星巴克门店小票',
          modality: 'image',
          sourceRef: uploadedImg.sourceRef
        },
        followupText: '实付42块5',
        pendingFeedback: [{ field: 'amount', code: 'ORIGINAL_AMOUNT_ADJUSTED', severity: 'warning' }],
        sentAt: SENT_AT
      }
    });
    expect(okFollowup.statusCode).toBe(200);
    expect(okFollowup.json()).toEqual({ patch: { amount: 42.5 } });

    // v1.5 新增反馈码同样放行（#41）
    const okV15Followup = await app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: {
        mode: 'followup',
        currentDraft: {
          amount: null,
          merchant: '贷款银行',
          occurredAt: SENT_AT,
          direction: 'expense',
          confidence: 0.85,
          rawText: '还房贷',
          modality: 'text',
          sourceRef: null
        },
        followupText: '本金还40块',
        pendingFeedback: [
          { field: 'originalTransactionId', code: 'PARTIAL_REPAYMENT_RECORDED', severity: 'warning' }
        ],
        sentAt: SENT_AT
      }
    });
    expect(okV15Followup.statusCode).toBe(200);

    // 空识别（模糊小票 / 空白转写）→ 422 CAPTURE_EMPTY_RECOGNITION
    const emptyRec = await setupHarness({
      provider: {
        async completeJson() {
          return JSON.stringify({ records: [] });
        },
        async completeVisionJson() {
          return JSON.stringify({ readable: false, reason: '小票反光模糊', ocrText: null, records: [] });
        },
        async transcribeAudio() {
          return '   ';
        }
      }
    });
    const imgForEmpty = (
      await emptyRec.app.inject({
        method: 'POST',
        url: '/api/capture/uploads',
        headers: { 'content-type': upImg.contentType },
        payload: upImg.payload
      })
    ).json() as { sourceRef: string };
    const voiceForEmpty = (
      await emptyRec.app.inject({
        method: 'POST',
        url: '/api/capture/uploads',
        headers: { 'content-type': upVoice.contentType },
        payload: upVoice.payload
      })
    ).json() as { sourceRef: string };

    const resUnreadable = await emptyRec.app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: { mode: 'draft', modality: 'image', sourceRef: imgForEmpty.sourceRef, sentAt: SENT_AT }
    });
    expect(resUnreadable.statusCode).toBe(422);
    expect(resUnreadable.json()).toMatchObject({ error: { code: 'CAPTURE_EMPTY_RECOGNITION' } });

    const resBlankVoice = await emptyRec.app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: { mode: 'draft', modality: 'voice', sourceRef: voiceForEmpty.sourceRef, sentAt: SENT_AT }
    });
    expect(resBlankVoice.statusCode).toBe(422);
    expect(resBlankVoice.json()).toMatchObject({ error: { code: 'CAPTURE_EMPTY_RECOGNITION' } });

    // AI 未配置（503）与上游 502（502）
    const unconfigured = await setupHarness({ omitExtractor: true });
    const resUnconfigured = await unconfigured.app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: { mode: 'draft', modality: 'text', rawText: '咖啡30元', sentAt: SENT_AT }
    });
    expect(resUnconfigured.statusCode).toBe(503);
    expect(resUnconfigured.json()).toMatchObject({ error: { code: 'AI_UPSTREAM_ERROR' } });

    const upstreamFail = await setupHarness({
      provider: {
        async completeJson() {
          throw new CaptureProviderError('AI_UPSTREAM_ERROR', 'upstream timeout', 504);
        },
        async completeVisionJson() {
          throw new CaptureProviderError('AI_INVALID_OUTPUT', 'bad json');
        },
        async transcribeAudio() {
          return 'ok';
        }
      }
    });
    const resUpstream = await upstreamFail.app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: { mode: 'draft', modality: 'text', rawText: '咖啡30元', sentAt: SENT_AT }
    });
    expect(resUpstream.statusCode).toBe(502);
    expect(resUpstream.json()).toMatchObject({ error: { code: 'AI_UPSTREAM_ERROR' } });

    // DeepSeek ASR 时长 > 120s → 413 INVALID_UPLOAD
    const dsHarness = await setupHarness({
      provider: createOpenAiCompatibleProvider(loadAiConfig({ DEEPSEEK_API_KEY: 'sk-ds-stub' }))
    });
    const longWav = buildMultipartBody('b-long-wav', [
      { name: 'file', filename: 'long.wav', contentType: 'audio/wav', bytes: buildPcmWav(121) }
    ]);
    const uploadedLong = (
      await dsHarness.app.inject({
        method: 'POST',
        url: '/api/capture/uploads',
        headers: { 'content-type': longWav.contentType },
        payload: longWav.payload
      })
    ).json() as { sourceRef: string };
    const resTooLongAsr = await dsHarness.app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: { mode: 'draft', modality: 'voice', sourceRef: uploadedLong.sourceRef, sentAt: SENT_AT }
    });
    expect(resTooLongAsr.statusCode).toBe(413);
    expect(resTooLongAsr.json()).toMatchObject({ error: { code: 'INVALID_UPLOAD' } });

    // 关键约束：extract 从不写库
    const rowCount = db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    expect(rowCount.count).toBe(0);
  });

  it('端到端 HTTP 上传 → 抽取草稿 → 确认前不入库 → capture-flow 确认后写入 M2 保留 sourceModality 与 sourceRef', async () => {
    const { app, db } = await setupHarness();

    const upImg = buildMultipartBody('b-e2e-png', [
      { name: 'file', filename: 'sbux.png', contentType: 'image/png', bytes: PNG_BYTES }
    ]);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/capture/uploads',
      headers: { 'content-type': upImg.contentType },
      payload: upImg.payload
    });
    expect(uploadRes.statusCode).toBe(201);
    const { sourceRef } = uploadRes.json() as { sourceRef: string };

    const extractRes = await app.inject({
      method: 'POST',
      url: '/api/capture/extract',
      payload: { mode: 'draft', modality: 'image', sourceRef, sentAt: SENT_AT }
    });
    expect(extractRes.statusCode).toBe(200);
    const { drafts } = extractRes.json() as { drafts: CaptureDraft[] };
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ modality: 'image', sourceRef, amount: 42, merchant: '星巴克' });

    const beforeConfirm = db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    expect(beforeConfirm.count).toBe(0);

    let idSeq = 0;
    const session = createCaptureSession({
      newId: () => String(++idSeq),
      importBatch: async (batch) => {
        const importRes = await app.inject({
          method: 'POST',
          url: '/api/transactions/import',
          payload: batch
        });
        expect(importRes.statusCode).toBe(201);
        return importRes.json();
      }
    });

    const prepared = session.prepare(
      { sessionId: 'sess_route_1', userId: 'u_001', sentAt: SENT_AT, chatAt: SENT_AT },
      drafts
    );
    expect(prepared.phase).toBe('draft');
    const beforeSubmit = db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number };
    expect(beforeSubmit.count).toBe(0);

    const submitted = await session.submit();
    expect(submitted.phase).toBe('complete');
    expect(submitted.records[0]!.result?.status).toBe('confirmed');

    const persisted = db
      .prepare('SELECT amount_cents, source_modality, source_ref FROM transactions')
      .all() as { amount_cents: number; source_modality: string; source_ref: string | null }[];
    expect(persisted).toEqual([
      { amount_cents: 4200, source_modality: 'image', source_ref: sourceRef }
    ]);
  });
});
