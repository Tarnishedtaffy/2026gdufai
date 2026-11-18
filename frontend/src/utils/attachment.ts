/** 按 MIME 推断附件模态；非音频一律按图片处理，与手工录入的 text 区分。 */
export function modalityFromMimeType(mimeType: string): 'image' | 'voice' {
  return mimeType.startsWith('audio/') ? 'voice' : 'image';
}
