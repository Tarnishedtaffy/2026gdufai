/** M1 公共入口；纯流程由前后端共用的 workspace 包维护。 */
export * from '@gduf/capture-flow';
export {
  createCaptureExtractor,
  type CaptureExtractor,
  type CaptureExtractorDeps,
  type ExtractFollowupInput,
  type ExtractMediaInput,
  type ExtractTextInput
} from './extractor.ts';
export { createOpenAiCompatibleProvider } from './provider.ts';
export {
  buildFollowupExtractionPrompts,
  PROMPT_VERSION_FOLLOWUP,
  type FollowupPromptInput
} from './prompts/extract-followup.ts';
export {
  buildReceiptExtractionPrompts,
  PROMPT_VERSION_RECEIPT,
  type ReceiptPromptInput
} from './prompts/extract-receipt.ts';
export {
  buildTextExtractionPrompts,
  PROMPT_VERSION_TEXT,
  type TextPromptInput
} from './prompts/extract-text.ts';
export {
  ACTIVE_CONTRACT_FEEDBACK_CODES,
  isControlledSourceRef,
  mergeDraftPatch,
  normalizeAmount,
  normalizeMerchant,
  normalizeOccurredAt,
  normalizeReferenceTime,
  parseExtractedDrafts,
  parseExtractedFollowupPatch,
  parseExtractedReceipt,
  parseJsonPayload,
  validateCaptureDraft,
  validatePendingFeedbackHints,
  type ParsedReceiptResult
} from './schema.ts';
export { registerCaptureRoutes, type CaptureRoutesOptions } from './routes.ts';
export {
  readCaptureUpload,
  saveCaptureUpload,
  verifyCaptureUploadRef,
  type ReadCaptureUploadOutcome,
  type SaveCaptureUploadInput,
  type VerifyCaptureUploadOutcome
} from './storage.ts';
export {
  CaptureProviderError,
  type AudioTranscriptionInput,
  type CaptureAiProvider,
  type CaptureDirection,
  type CaptureDraftPatch,
  type CaptureFailure,
  type CaptureFailureCode,
  type CaptureModality,
  type CaptureProviderErrorCode,
  type DraftExtractionOutcome,
  type PatchExtractionOutcome,
  type PendingFeedbackHint,
  type SavedCaptureUpload,
  type TextCompletionInput,
  type UploadSaveOutcome,
  type VisionCompletionInput
} from './types.ts';
