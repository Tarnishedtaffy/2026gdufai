import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toShanghaiDate } from '../../shared/time.ts';
import { isControlledSourceRef } from './schema.ts';
import type { CaptureFailure, UploadSaveOutcome } from './types.ts';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const NOFOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0;

interface MediaSpec {
  readonly modality: 'image' | 'voice';
  readonly canonicalMime: string;
  readonly ext: string;
  readonly maxBytes: number;
}

const MIME_SPECS: ReadonlyMap<string, MediaSpec> = new Map([
  ['image/jpeg', { modality: 'image', canonicalMime: 'image/jpeg', ext: 'jpg', maxBytes: MAX_IMAGE_BYTES }],
  ['image/jpg', { modality: 'image', canonicalMime: 'image/jpeg', ext: 'jpg', maxBytes: MAX_IMAGE_BYTES }],
  ['image/png', { modality: 'image', canonicalMime: 'image/png', ext: 'png', maxBytes: MAX_IMAGE_BYTES }],
  ['image/webp', { modality: 'image', canonicalMime: 'image/webp', ext: 'webp', maxBytes: MAX_IMAGE_BYTES }],
  ['audio/webm', { modality: 'voice', canonicalMime: 'audio/webm', ext: 'webm', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/wav', { modality: 'voice', canonicalMime: 'audio/wav', ext: 'wav', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/x-wav', { modality: 'voice', canonicalMime: 'audio/wav', ext: 'wav', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/mpeg', { modality: 'voice', canonicalMime: 'audio/mpeg', ext: 'mp3', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/mp3', { modality: 'voice', canonicalMime: 'audio/mpeg', ext: 'mp3', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/mp4', { modality: 'voice', canonicalMime: 'audio/mp4', ext: 'm4a', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/m4a', { modality: 'voice', canonicalMime: 'audio/mp4', ext: 'm4a', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/x-m4a', { modality: 'voice', canonicalMime: 'audio/mp4', ext: 'm4a', maxBytes: MAX_AUDIO_BYTES }],
  ['audio/ogg', { modality: 'voice', canonicalMime: 'audio/ogg', ext: 'ogg', maxBytes: MAX_AUDIO_BYTES }]
]);

const EXT_TO_MEDIA: ReadonlyMap<
  string,
  { readonly modality: 'image' | 'voice'; readonly mimeType: string; readonly maxBytes: number }
> = new Map([
  ['.jpg', { modality: 'image', mimeType: 'image/jpeg', maxBytes: MAX_IMAGE_BYTES }],
  ['.png', { modality: 'image', mimeType: 'image/png', maxBytes: MAX_IMAGE_BYTES }],
  ['.webp', { modality: 'image', mimeType: 'image/webp', maxBytes: MAX_IMAGE_BYTES }],
  ['.webm', { modality: 'voice', mimeType: 'audio/webm', maxBytes: MAX_AUDIO_BYTES }],
  ['.wav', { modality: 'voice', mimeType: 'audio/wav', maxBytes: MAX_AUDIO_BYTES }],
  ['.mp3', { modality: 'voice', mimeType: 'audio/mpeg', maxBytes: MAX_AUDIO_BYTES }],
  ['.m4a', { modality: 'voice', mimeType: 'audio/mp4', maxBytes: MAX_AUDIO_BYTES }],
  ['.ogg', { modality: 'voice', mimeType: 'audio/ogg', maxBytes: MAX_AUDIO_BYTES }]
]);

function invalidSourceFailure(
  message: string,
  field: 'file' | 'sourceRef'
): { readonly ok: false; readonly failure: CaptureFailure } {
  return {
    ok: false,
    failure: { code: 'INVALID_SOURCE_REF', message, field }
  };
}

function isStrictlyInsideDir(rootDir: string, candidatePath: string): boolean {
  const rel = relative(rootDir, candidatePath);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function resolveSafeUploadRoot(uploadDir: string, createIfMissing: boolean): Promise<string | null> {
  const rootDir = resolve(uploadDir);
  let stat;
  try {
    stat = await lstat(rootDir);
  } catch (error: unknown) {
    if (!createIfMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return null;
    }
    await mkdir(rootDir, { recursive: true });
    stat = await lstat(rootDir);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return null;
  }
  return realpath(rootDir);
}

async function ensureSafeSubdir(
  rootReal: string,
  parentDir: string,
  segment: string
): Promise<string | null> {
  const nextDir = join(parentDir, segment);
  try {
    await mkdir(nextDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  const stat = await lstat(nextDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return null;
  }
  const nextReal = await realpath(nextDir);
  if (!isStrictlyInsideDir(rootReal, nextReal)) {
    return null;
  }
  return nextReal;
}

async function traverseSafeSubdir(
  rootReal: string,
  parentDir: string,
  segment: string
): Promise<string | null> {
  const nextDir = join(parentDir, segment);
  const stat = await lstat(nextDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return null;
  }
  const nextReal = await realpath(nextDir);
  if (!isStrictlyInsideDir(rootReal, nextReal)) {
    return null;
  }
  return nextReal;
}

function hasValidImageSignature(bytes: Uint8Array, canonicalMime: string): boolean {
  if (canonicalMime === 'image/jpeg') {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (canonicalMime === 'image/png') {
    return (
      bytes.byteLength >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (canonicalMime === 'image/webp') {
    if (bytes.byteLength < 12) {
      return false;
    }
    const header = Buffer.from(bytes.subarray(0, 4)).toString('ascii');
    const format = Buffer.from(bytes.subarray(8, 12)).toString('ascii');
    return header === 'RIFF' && format === 'WEBP';
  }
  return false;
}

function hasValidAudioSignature(bytes: Uint8Array, canonicalMime: string): boolean {
  if (canonicalMime === 'audio/webm') {
    return (
      bytes.byteLength >= 4 &&
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    );
  }
  if (canonicalMime === 'audio/wav') {
    if (bytes.byteLength < 12) {
      return false;
    }
    const header = Buffer.from(bytes.subarray(0, 4)).toString('ascii');
    const format = Buffer.from(bytes.subarray(8, 12)).toString('ascii');
    return header === 'RIFF' && format === 'WAVE';
  }
  if (canonicalMime === 'audio/mpeg') {
    if (bytes.byteLength >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      return true;
    }
    if (bytes.byteLength >= 2 && bytes[0] === 0xff) {
      const b1 = bytes[1] ?? 0;
      return (b1 & 0xe0) === 0xe0 && (b1 & 0x18) !== 0x08 && (b1 & 0x06) !== 0x00;
    }
    return false;
  }
  if (canonicalMime === 'audio/mp4') {
    return bytes.byteLength >= 8 && Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp';
  }
  if (canonicalMime === 'audio/ogg') {
    return bytes.byteLength >= 4 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'OggS';
  }
  return false;
}

/** 受控上传存储入参。 */
export interface SaveCaptureUploadInput {
  readonly uploadDir: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly now?: Date;
}

/**
 * 校验并持久化上传的语音或图片文件到受控目录，返回相对路径 `sourceRef`。
 * 逐级检查父目录并禁用符号链接跟随，不返回宿主机绝对路径，也不接收内联 base64 字符串。
 */
export async function saveCaptureUpload(input: SaveCaptureUploadInput): Promise<UploadSaveOutcome> {
  if (input.bytes.byteLength === 0) {
    return {
      ok: false,
      failure: { code: 'UPLOAD_EMPTY_FILE', message: '上传文件不能为空。', field: 'file' }
    };
  }

  const normalizedMime = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const spec = MIME_SPECS.get(normalizedMime);
  if (spec === undefined) {
    return {
      ok: false,
      failure: {
        code: 'UPLOAD_UNSUPPORTED_TYPE',
        message: `不支持的文件类型: ${input.mimeType}`,
        field: 'file'
      }
    };
  }

  if (input.bytes.byteLength > spec.maxBytes) {
    return {
      ok: false,
      failure: {
        code: 'UPLOAD_TOO_LARGE',
        message: `上传文件超过限制（上限 ${Math.round(spec.maxBytes / (1024 * 1024))} MB）。`,
        field: 'file'
      }
    };
  }

  if (spec.modality === 'image' && !hasValidImageSignature(input.bytes, spec.canonicalMime)) {
    return {
      ok: false,
      failure: {
        code: 'UPLOAD_UNSUPPORTED_TYPE',
        message: '图片文件内容与声明的格式不匹配。',
        field: 'file'
      }
    };
  }
  if (spec.modality === 'voice' && !hasValidAudioSignature(input.bytes, spec.canonicalMime)) {
    return {
      ok: false,
      failure: {
        code: 'UPLOAD_UNSUPPORTED_TYPE',
        message: '音频文件内容与声明的格式不匹配。',
        field: 'file'
      }
    };
  }

  const shanghaiDate = toShanghaiDate((input.now ?? new Date()).toISOString());
  const year = shanghaiDate.slice(0, 4);
  const month = shanghaiDate.slice(5, 7);
  const fileName = `${randomUUID()}.${spec.ext}`;

  try {
    const rootReal = await resolveSafeUploadRoot(input.uploadDir, true);
    if (rootReal === null) {
      return invalidSourceFailure('上传根目录不是受控真实目录。', 'file');
    }

    let currentDir = rootReal;
    for (const segment of [year, month]) {
      const nextDir = await ensureSafeSubdir(rootReal, currentDir, segment);
      if (nextDir === null) {
        return invalidSourceFailure('上传目录包含非受控符号链接或越出根目录。', 'file');
      }
      currentDir = nextDir;
    }

    const targetPath = join(currentDir, fileName);
    const writeFlags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW_FLAG;
    const handle = await open(targetPath, writeFlags, 0o600);
    let safeToWrite = false;
    let unlinkTarget: string | null = null;
    try {
      const fdStat = await handle.stat();
      const targetReal = await realpath(targetPath);
      const pathStat = await lstat(targetPath);
      if (
        !fdStat.isFile() ||
        fdStat.nlink !== 1 ||
        pathStat.isSymbolicLink() ||
        pathStat.dev !== fdStat.dev ||
        pathStat.ino !== fdStat.ino ||
        !isStrictlyInsideDir(rootReal, targetReal)
      ) {
        if (isStrictlyInsideDir(rootReal, targetReal)) {
          unlinkTarget = targetReal;
        }
      } else {
        safeToWrite = true;
        await handle.writeFile(input.bytes);
      }
    } finally {
      await handle.close();
      if (unlinkTarget !== null) {
        await unlink(unlinkTarget).catch(() => {});
      }
    }
    if (!safeToWrite) {
      return invalidSourceFailure('上传目标不是受控常规文件或已越出根目录。', 'file');
    }
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      return invalidSourceFailure('上传目标包含非受控符号链接或非法路径。', 'file');
    }
    throw error;
  }

  return {
    ok: true,
    upload: {
      sourceRef: `uploads/${year}/${month}/${fileName}`,
      modality: spec.modality,
      mimeType: spec.canonicalMime,
      byteLength: input.bytes.byteLength
    }
  };
}

/** 读取受控上传文件结果。 */
export type ReadCaptureUploadOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly modality: 'image' | 'voice';
      readonly filename: string;
    }
  | { readonly ok: false; readonly failure: CaptureFailure };

/** 仅校验受控 sourceRef 是否存在且匹配预期模态的结果。 */
export type VerifyCaptureUploadOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: CaptureFailure };

interface VerifiedOpenUpload {
  readonly ok: true;
  readonly handle: FileHandle;
  readonly fileName: string;
  readonly media: { readonly modality: 'image' | 'voice'; readonly mimeType: string; readonly maxBytes: number };
}

async function readHandleBounded(handle: FileHandle, maxBytes: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const remaining = maxBytes - totalBytes;
    const chunkCapacity = Math.min(READ_CHUNK_BYTES, remaining + 1);
    const buffer = Buffer.allocUnsafe(chunkCapacity);
    const { bytesRead } = await handle.read(buffer, 0, chunkCapacity, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes);
    }
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) {
      return null;
    }
    chunks.push(bytesRead === chunkCapacity ? buffer : buffer.subarray(0, bytesRead));
  }
}

async function openVerifiedUpload(
  uploadDir: string,
  sourceRef: string
): Promise<VerifiedOpenUpload | { readonly ok: false; readonly failure: CaptureFailure }> {
  if (!isControlledSourceRef(sourceRef)) {
    return invalidSourceFailure('源文件引用不合法，必须来自受控上传目录。', 'sourceRef');
  }

  const subPath = sourceRef.slice('uploads/'.length);
  const segments = subPath.split('/');
  const [year, month, fileName] = segments;
  if (segments.length !== 3 || year === undefined || month === undefined || fileName === undefined) {
    return invalidSourceFailure('源文件引用层级不合法。', 'sourceRef');
  }

  const ext = extname(fileName).toLowerCase();
  const media = EXT_TO_MEDIA.get(ext);
  if (media === undefined) {
    return invalidSourceFailure('源文件扩展名不受支持。', 'sourceRef');
  }

  const rootDir = resolve(uploadDir);
  const lexicalTarget = resolve(rootDir, subPath);
  if (!isStrictlyInsideDir(rootDir, lexicalTarget)) {
    return invalidSourceFailure('源文件引用越界。', 'sourceRef');
  }

  let handle: FileHandle | null = null;
  try {
    const rootReal = await resolveSafeUploadRoot(uploadDir, false);
    if (rootReal === null) {
      return invalidSourceFailure('受控上传根目录不存在或包含非法链接。', 'sourceRef');
    }

    let currentDir = rootReal;
    for (const segment of [year, month]) {
      const nextDir = await traverseSafeSubdir(rootReal, currentDir, segment);
      if (nextDir === null) {
        return invalidSourceFailure('源文件目录包含符号链接或越出受控根目录。', 'sourceRef');
      }
      currentDir = nextDir;
    }

    const safeTargetPath = join(currentDir, fileName);
    const preStat = await lstat(safeTargetPath);
    if (preStat.isSymbolicLink() || !preStat.isFile()) {
      return invalidSourceFailure('源文件不是受控常规文件。', 'sourceRef');
    }
    if (preStat.nlink > 1) {
      return invalidSourceFailure('源文件存在多硬链接，已拒绝读取。', 'sourceRef');
    }
    if (preStat.size === 0) {
      return {
        ok: false,
        failure: { code: 'UPLOAD_EMPTY_FILE', message: '上传文件不能为空。', field: 'sourceRef' }
      };
    }
    if (preStat.size > media.maxBytes) {
      return {
        ok: false,
        failure: {
          code: 'UPLOAD_TOO_LARGE',
          message: `上传文件超过限制（上限 ${Math.round(media.maxBytes / (1024 * 1024))} MB）。`,
          field: 'sourceRef'
        }
      };
    }

    handle = await open(safeTargetPath, fsConstants.O_RDONLY | NOFOLLOW_FLAG);
    const fdStat = await handle.stat();
    if (!fdStat.isFile() || fdStat.nlink > 1 || fdStat.dev !== preStat.dev || fdStat.ino !== preStat.ino) {
      await handle.close();
      return invalidSourceFailure('源文件状态已变更或非受控常规文件。', 'sourceRef');
    }

    const targetReal = await realpath(safeTargetPath);
    if (!isStrictlyInsideDir(rootReal, targetReal)) {
      await handle.close();
      return invalidSourceFailure('源文件真实路径越出受控根目录。', 'sourceRef');
    }

    const realStat = await lstat(targetReal);
    if (
      realStat.isSymbolicLink() ||
      !realStat.isFile() ||
      realStat.dev !== fdStat.dev ||
      realStat.ino !== fdStat.ino
    ) {
      await handle.close();
      return invalidSourceFailure('源文件真实节点与打开句柄不一致。', 'sourceRef');
    }

    if (fdStat.size === 0) {
      await handle.close();
      return {
        ok: false,
        failure: { code: 'UPLOAD_EMPTY_FILE', message: '上传文件不能为空。', field: 'sourceRef' }
      };
    }
    if (fdStat.size > media.maxBytes) {
      await handle.close();
      return {
        ok: false,
        failure: {
          code: 'UPLOAD_TOO_LARGE',
          message: `上传文件超过限制（上限 ${Math.round(media.maxBytes / (1024 * 1024))} MB）。`,
          field: 'sourceRef'
        }
      };
    }

    return { ok: true, handle, fileName, media };
  } catch (error: unknown) {
    if (handle !== null) {
      await handle.close().catch(() => {});
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      return invalidSourceFailure('源文件或路径包含非受控符号链接。', 'sourceRef');
    }
    return invalidSourceFailure('找不到对应的上传文件，请重新上传。', 'sourceRef');
  }
}

/**
 * 校验受控 `sourceRef` 指向的常规单硬链接文件是否存在且符合声明的输入模态（不将文件内容读入内存）。
 */
export async function verifyCaptureUploadRef(
  uploadDir: string,
  sourceRef: string,
  expectedModality: 'image' | 'voice'
): Promise<VerifyCaptureUploadOutcome> {
  const opened = await openVerifiedUpload(uploadDir, sourceRef);
  if (!opened.ok) {
    return opened;
  }
  await opened.handle.close();
  if (opened.media.modality !== expectedModality) {
    return invalidSourceFailure(
      `sourceRef 指向的文件不是${expectedModality === 'voice' ? '语音' : '图片'}格式。`,
      'sourceRef'
    );
  }
  return { ok: true };
}

/**
 * 根据受控 `sourceRef` 从 `uploadDir` 安全且有界地读取文件，防止路径穿越、父目录符号链接逃逸、多硬链接、TOCTOU 替换及超限读入内存。
 */
export async function readCaptureUpload(
  uploadDir: string,
  sourceRef: string
): Promise<ReadCaptureUploadOutcome> {
  const opened = await openVerifiedUpload(uploadDir, sourceRef);
  if (!opened.ok) {
    return opened;
  }
  try {
    const bytes = await readHandleBounded(opened.handle, opened.media.maxBytes);
    if (bytes === null) {
      return {
        ok: false,
        failure: {
          code: 'UPLOAD_TOO_LARGE',
          message: `上传文件超过限制（上限 ${Math.round(opened.media.maxBytes / (1024 * 1024))} MB）。`,
          field: 'sourceRef'
        }
      };
    }
    if (bytes.byteLength === 0) {
      return {
        ok: false,
        failure: { code: 'UPLOAD_EMPTY_FILE', message: '上传文件不能为空。', field: 'sourceRef' }
      };
    }

    return {
      ok: true,
      bytes,
      mimeType: opened.media.mimeType,
      modality: opened.media.modality,
      filename: opened.fileName
    };
  } finally {
    await opened.handle.close();
  }
}
