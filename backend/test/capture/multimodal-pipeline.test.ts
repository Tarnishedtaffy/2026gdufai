import { link, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CaptureProviderError,
  createCaptureExtractor,
  isControlledSourceRef,
  PROMPT_VERSION_RECEIPT,
  PROMPT_VERSION_TEXT,
  readCaptureUpload,
  saveCaptureUpload,
  verifyCaptureUploadRef,
  type CaptureAiProvider
} from '../../src/modules/capture/index.ts';

const REFERENCE_TIME = '2026-11-19T12:00:00+08:00';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP_BYTES = Buffer.from('RIFF\x12\x00\x00\x00WEBPfake');
const WAV_BYTES = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ');

const tempDirs: string[] = [];

async function makeUploadDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gdufai-capture-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('M1 第三阶段：受控上传存储与语音/小票流水线', () => {
  it('saveCaptureUpload 校验类型、魔数与大小，并拒绝非法或越权 sourceRef', async () => {
    const uploadDir = await makeUploadDir();

    const empty = await saveCaptureUpload({
      uploadDir,
      bytes: new Uint8Array(0),
      mimeType: 'image/png'
    });
    expect(empty).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'UPLOAD_EMPTY_FILE' })
    });

    const badMime = await saveCaptureUpload({
      uploadDir,
      bytes: Buffer.from('hello'),
      mimeType: 'application/pdf'
    });
    expect(badMime).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'UPLOAD_UNSUPPORTED_TYPE' })
    });

    const spoofedPng = await saveCaptureUpload({
      uploadDir,
      bytes: Buffer.from('not-a-real-png'),
      mimeType: 'image/png'
    });
    expect(spoofedPng).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'UPLOAD_UNSUPPORTED_TYPE' })
    });

    const tooLargeImage = await saveCaptureUpload({
      uploadDir,
      bytes: Buffer.concat([PNG_BYTES, Buffer.alloc(10 * 1024 * 1024)]),
      mimeType: 'image/png'
    });
    expect(tooLargeImage).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'UPLOAD_TOO_LARGE' })
    });

    const savedJpg = await saveCaptureUpload({
      uploadDir,
      bytes: JPEG_BYTES,
      mimeType: 'image/jpeg',
      now: new Date('2026-11-19T10:00:00+08:00')
    });
    expect(savedJpg.ok).toBe(true);
    if (savedJpg.ok) {
      expect(isControlledSourceRef(savedJpg.upload.sourceRef)).toBe(true);
      expect(savedJpg.upload.sourceRef).toMatch(/^uploads\/2026\/11\/.+\.jpg$/);
      const readBack = await readCaptureUpload(uploadDir, savedJpg.upload.sourceRef);
      expect(readBack.ok).toBe(true);
      if (readBack.ok) {
        expect(Buffer.from(readBack.bytes)).toEqual(JPEG_BYTES);
      }
    }

    const savedWebp = await saveCaptureUpload({
      uploadDir,
      bytes: WEBP_BYTES,
      mimeType: 'image/webp'
    });
    expect(savedWebp.ok).toBe(true);

    expect(isControlledSourceRef('uploads/2026/11/not-a-uuid.jpg')).toBe(false);

    for (const badRef of [
      'receipt.jpg',
      'data:image/png;base64,iVBORw0KGgo=',
      'uploads/2026/11/not-a-uuid.jpg',
      'uploads/2026/11/../../etc/passwd.jpg',
      '/uploads/2026/11/550e8400-e29b-41d4-a716-446655440000.jpg'
    ]) {
      const readInvalid = await readCaptureUpload(uploadDir, badRef);
      expect(readInvalid).toEqual({
        ok: false,
        failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
      });
    }
  });

  it('语音 ASR 接入同一抽取链路，保留 modality=voice 与受控 sourceRef，空转写与上游失败显式报错', async () => {
    const uploadDir = await makeUploadDir();
    const savedAudio = await saveCaptureUpload({
      uploadDir,
      bytes: WAV_BYTES,
      mimeType: 'audio/wav;codecs=pcm',
      now: new Date('2026-11-19T12:00:00+08:00')
    });
    expect(savedAudio.ok).toBe(true);
    if (!savedAudio.ok) return;

    const okProvider: CaptureAiProvider = {
      transcribeAudio: async (input) => {
        expect(input.mimeType).toBe('audio/wav');
        expect(Buffer.from(input.audioBytes)).toEqual(WAV_BYTES);
        return '今天打车去机场花了六十八块';
      },
      completeJson: async () =>
        JSON.stringify({
          records: [
            {
              amount: 68,
              merchant: '网约车',
              occurredAt: '2026-11-19T12:00:00+08:00',
              direction: 'expense',
              confidence: 0.91,
              rawText: '今天打车去机场花了六十八块'
            }
          ]
        }),
      completeVisionJson: async () => {
        throw new Error('not expected');
      }
    };

    const extractor = createCaptureExtractor({ uploadDir, provider: okProvider });
    const voiceOutcome = await extractor.extractFromVoice({
      sourceRef: savedAudio.upload.sourceRef,
      referenceTime: REFERENCE_TIME
    });

    expect(voiceOutcome).toEqual({
      ok: true,
      promptVersion: PROMPT_VERSION_TEXT,
      drafts: [
        {
          amount: 68,
          merchant: '网约车',
          occurredAt: '2026-11-19T12:00:00+08:00',
          direction: 'expense',
          confidence: 0.91,
          rawText: '今天打车去机场花了六十八块',
          modality: 'voice',
          sourceRef: savedAudio.upload.sourceRef
        }
      ]
    });

    const emptyTranscriptExtractor = createCaptureExtractor({
      uploadDir,
      provider: {
        ...okProvider,
        transcribeAudio: async () => '   '
      }
    });
    const emptyOutcome = await emptyTranscriptExtractor.extractFromVoice({
      sourceRef: savedAudio.upload.sourceRef,
      referenceTime: REFERENCE_TIME
    });
    expect(emptyOutcome).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'EMPTY_TRANSCRIPT' })
    });

    const errorExtractor = createCaptureExtractor({
      uploadDir,
      provider: {
        ...okProvider,
        transcribeAudio: async () => {
          throw new CaptureProviderError('AI_UPSTREAM_ERROR', 'ASR gateway 503', 503);
        }
      }
    });
    const errOutcome = await errorExtractor.extractFromVoice({
      sourceRef: savedAudio.upload.sourceRef,
      referenceTime: REFERENCE_TIME
    });
    expect(errOutcome).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'AI_UPSTREAM_ERROR' })
    });
  });

  it('小票 OCR 识别多金额取实付，模糊小票返回 UNREADABLE_RECEIPT 不伪造草稿', async () => {
    const uploadDir = await makeUploadDir();
    const savedImg = await saveCaptureUpload({
      uploadDir,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
      now: new Date('2026-11-19T12:00:00+08:00')
    });
    expect(savedImg.ok).toBe(true);
    if (!savedImg.ok) return;

    const clearProvider: CaptureAiProvider = {
      completeJson: async () => {
        throw new Error('not expected');
      },
      transcribeAudio: async () => {
        throw new Error('not expected');
      },
      completeVisionJson: async (input) => {
        expect(input.mimeType).toBe('image/png');
        expect(Buffer.from(input.imageBytes)).toEqual(PNG_BYTES);
        return JSON.stringify({
          readable: true,
          ocrText: '星巴克门店 原价45 优惠-5 打包费2 实付42.00',
          records: [
            {
              amount: 42,
              merchant: '星巴克',
              occurredAt: '2026-11-19T11:20:00+08:00',
              direction: 'expense',
              confidence: 0.93,
              rawText: '星巴克小票实付 42.00 元（原价45，优惠5，打包费2）'
            }
          ]
        });
      }
    };

    const clearExtractor = createCaptureExtractor({ uploadDir, provider: clearProvider });
    const receiptOutcome = await clearExtractor.extractFromImage({
      sourceRef: savedImg.upload.sourceRef,
      referenceTime: REFERENCE_TIME
    });
    expect(receiptOutcome).toEqual({
      ok: true,
      promptVersion: PROMPT_VERSION_RECEIPT,
      drafts: [
        {
          amount: 42,
          merchant: '星巴克',
          occurredAt: '2026-11-19T11:20:00+08:00',
          direction: 'expense',
          confidence: 0.93,
          rawText: '星巴克小票实付 42.00 元（原价45，优惠5，打包费2）',
          modality: 'image',
          sourceRef: savedImg.upload.sourceRef
        }
      ]
    });

    let blurryCalls = 0;
    const blurryExtractor = createCaptureExtractor({
      uploadDir,
      provider: {
        ...clearProvider,
        completeVisionJson: async () => {
          blurryCalls++;
          return JSON.stringify({
            readable: false,
            reason: '小票反光严重，实付金额不可辨认',
            ocrText: null,
            records: []
          });
        }
      }
    });
    const blurryOutcome = await blurryExtractor.extractFromImage({
      sourceRef: savedImg.upload.sourceRef,
      referenceTime: REFERENCE_TIME
    });
    expect(blurryCalls).toBe(1);
    expect(blurryOutcome).toEqual({
      ok: false,
      failure: {
        code: 'UNREADABLE_RECEIPT',
        field: 'sourceRef',
        message: '小票反光严重，实付金额不可辨认'
      }
    });
  });

  it('语音抽取在调用付费 ASR 前先校验 referenceTime，非法时间不触发转写', async () => {
    const uploadDir = await makeUploadDir();
    const savedAudio = await saveCaptureUpload({
      uploadDir,
      bytes: WAV_BYTES,
      mimeType: 'audio/wav',
      now: new Date(REFERENCE_TIME)
    });
    expect(savedAudio.ok).toBe(true);
    if (!savedAudio.ok) return;

    let asrCalls = 0;
    const extractor = createCaptureExtractor({
      uploadDir,
      provider: {
        completeJson: async () => {
          throw new Error('not expected');
        },
        completeVisionJson: async () => {
          throw new Error('not expected');
        },
        transcribeAudio: async () => {
          asrCalls++;
          return '不该执行';
        }
      }
    });

    const outcome = await extractor.extractFromVoice({
      sourceRef: savedAudio.upload.sourceRef,
      referenceTime: 'not-a-date'
    });
    expect(asrCalls).toBe(0);
    expect(outcome).toEqual({
      ok: false,
      failure: expect.objectContaining({
        code: 'EMPTY_INPUT',
        field: 'referenceTime'
      })
    });
  });

  it('MIME_SPECS / EXT_TO_MEDIA 拒绝原型链继承键（P2 回归）', async () => {
    const uploadDir = await makeUploadDir();

    for (const protoKey of ['constructor', '__proto__', 'toString', 'valueOf']) {
      const outcome = await saveCaptureUpload({
        uploadDir,
        bytes: Buffer.from([1, 2, 3]),
        mimeType: protoKey
      });
      expect(outcome).toEqual({
        ok: false,
        failure: expect.objectContaining({ code: 'UPLOAD_UNSUPPORTED_TYPE' })
      });
    }

    expect(await readdir(uploadDir)).toEqual([]);
  });

  it('父目录符号链接逃逸在读写路径均被拒绝（P1 回归）', async () => {
    const dirType = process.platform === 'win32' ? 'junction' : 'dir';
    const fixedTime = new Date('2026-11-19T10:00:00+08:00');

    // 年份层级（uploadDir/2026 -> outsideDir）符号链接逃逸拦截
    const yearEscapeName = '550e8400-e29b-41d4-a716-446655440011.jpg';
    const uploadDir = await makeUploadDir();
    const outsideDir = await makeUploadDir();
    const outsideMonthDir = join(outsideDir, '11');
    await mkdir(outsideMonthDir, { recursive: true });
    await writeFile(join(outsideMonthDir, yearEscapeName), JPEG_BYTES);
    await symlink(outsideDir, join(uploadDir, '2026'), dirType);

    const readYearEscape = await readCaptureUpload(uploadDir, `uploads/2026/11/${yearEscapeName}`);
    expect(readYearEscape).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
    });

    const saveYearEscape = await saveCaptureUpload({
      uploadDir,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
      now: fixedTime
    });
    expect(saveYearEscape).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
    });
    expect(await readdir(outsideMonthDir)).toEqual([yearEscapeName]);

    // 月份层级（uploadDir2/2026/11 -> outsideTargetDir）符号链接逃逸拦截
    const monthEscapeName = '550e8400-e29b-41d4-a716-446655440012.jpg';
    const uploadDir2 = await makeUploadDir();
    const outsideTargetDir = await makeUploadDir();
    await writeFile(join(outsideTargetDir, monthEscapeName), JPEG_BYTES);
    await mkdir(join(uploadDir2, '2026'), { recursive: true });
    await symlink(outsideTargetDir, join(uploadDir2, '2026', '11'), dirType);

    const readMonthEscape = await readCaptureUpload(uploadDir2, `uploads/2026/11/${monthEscapeName}`);
    expect(readMonthEscape).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
    });

    const saveMonthEscape = await saveCaptureUpload({
      uploadDir: uploadDir2,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
      now: fixedTime
    });
    expect(saveMonthEscape).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
    });
    expect(await readdir(outsideTargetDir)).toEqual([monthEscapeName]);
  });

  it('readCaptureUpload 拒绝多硬链接与超大小上限文件，并支持自动创建不存在的 uploadDir（P3 回归）', async () => {
    const uploadDir = await makeUploadDir();
    const outsideDir = await makeUploadDir();
    const monthDir = join(uploadDir, '2026', '11');
    await mkdir(monthDir, { recursive: true });

    const hardlinkName = '550e8400-e29b-41d4-a716-446655440013.jpg';
    const outsideFile = join(outsideDir, 'outside.jpg');
    await writeFile(outsideFile, JPEG_BYTES);
    await link(outsideFile, join(monthDir, hardlinkName));

    const hardlinkRead = await readCaptureUpload(uploadDir, `uploads/2026/11/${hardlinkName}`);
    expect(hardlinkRead).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
    });

    const oversizedName = '550e8400-e29b-41d4-a716-446655440014.png';
    const oversizedPath = join(monthDir, oversizedName);
    await writeFile(oversizedPath, Buffer.concat([PNG_BYTES, Buffer.alloc(10 * 1024 * 1024)]));
    const oversizedRead = await readCaptureUpload(uploadDir, `uploads/2026/11/${oversizedName}`);
    expect(oversizedRead).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'UPLOAD_TOO_LARGE' })
    });

    const tempParent = await makeUploadDir();
    const freshUploadDir = join(tempParent, 'nested-uploads');
    const saved = await saveCaptureUpload({
      uploadDir: freshUploadDir,
      bytes: PNG_BYTES,
      mimeType: 'image/png',
      now: new Date(REFERENCE_TIME)
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      const readBack = await readCaptureUpload(freshUploadDir, saved.upload.sourceRef);
      expect(readBack.ok).toBe(true);
    }

    // 跨多个 64 KiB 分块读取 + verifyCaptureUploadRef 不读体校验与模态防串台
    const multiChunkPng = Buffer.concat([PNG_BYTES, Buffer.alloc(180 * 1024, 0x2a)]);
    const savedMulti = await saveCaptureUpload({
      uploadDir,
      bytes: multiChunkPng,
      mimeType: 'image/png',
      now: new Date(REFERENCE_TIME)
    });
    expect(savedMulti.ok).toBe(true);
    if (savedMulti.ok) {
      const verifiedOk = await verifyCaptureUploadRef(uploadDir, savedMulti.upload.sourceRef, 'image');
      expect(verifiedOk).toEqual({ ok: true });
      const verifiedWrongModality = await verifyCaptureUploadRef(
        uploadDir,
        savedMulti.upload.sourceRef,
        'voice'
      );
      expect(verifiedWrongModality).toEqual({
        ok: false,
        failure: expect.objectContaining({ code: 'INVALID_SOURCE_REF' })
      });
      const readMulti = await readCaptureUpload(uploadDir, savedMulti.upload.sourceRef);
      expect(readMulti.ok).toBe(true);
      if (readMulti.ok) {
        expect(Buffer.from(readMulti.bytes)).toEqual(multiChunkPng);
      }
    }
  });

  it('saveCaptureUpload 对 WebM/WAV/MP3/MP4/OGG 执行魔数双校验，extractor 拒绝超 4000 字符输入（#40 / P3）', async () => {
    const uploadDir = await makeUploadDir();
    const validAudioSamples: readonly { mimeType: string; bytes: Uint8Array }[] = [
      { mimeType: 'audio/webm', bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]) },
      { mimeType: 'audio/wav', bytes: WAV_BYTES },
      { mimeType: 'audio/mpeg', bytes: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]) },
      { mimeType: 'audio/mpeg', bytes: Buffer.from([0xff, 0xfb, 0x90, 0x64]) },
      { mimeType: 'audio/mp4', bytes: Buffer.from('\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00') },
      { mimeType: 'audio/ogg', bytes: Buffer.from('OggS\x00\x02\x00\x00') }
    ];

    for (const sample of validAudioSamples) {
      const outcome = await saveCaptureUpload({
        uploadDir,
        bytes: sample.bytes,
        mimeType: sample.mimeType
      });
      expect(outcome.ok).toBe(true);
    }

    for (const spoofedMime of ['audio/wav', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg']) {
      const outcome = await saveCaptureUpload({
        uploadDir,
        bytes: Buffer.from('plain-text-not-audio'),
        mimeType: spoofedMime
      });
      expect(outcome).toEqual({
        ok: false,
        failure: expect.objectContaining({ code: 'UPLOAD_UNSUPPORTED_TYPE', field: 'file' })
      });
    }

    let aiCalls = 0;
    const extractor = createCaptureExtractor({
      uploadDir,
      provider: {
        completeJson: async () => {
          aiCalls++;
          return '{}';
        },
        completeVisionJson: async () => {
          aiCalls++;
          return '{}';
        },
        transcribeAudio: async () => {
          aiCalls++;
          return '';
        }
      }
    });

    const tooLongText = await extractor.extractFromText({
      rawText: '测'.repeat(4001),
      referenceTime: REFERENCE_TIME
    });
    expect(tooLongText).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_CAPTURE_INPUT', field: 'rawText' })
    });

    const tooLongFollowup = await extractor.extractFollowupPatch({
      currentDraft: {
        amount: null,
        merchant: '咖啡店',
        occurredAt: REFERENCE_TIME,
        direction: 'expense',
        confidence: 0.9,
        rawText: '喝咖啡',
        modality: 'text',
        sourceRef: null
      },
      followupText: '补'.repeat(4001),
      referenceTime: REFERENCE_TIME
    });
    expect(tooLongFollowup).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'INVALID_CAPTURE_INPUT', field: 'followupText' })
    });
    expect(aiCalls).toBe(0);
  });
});
