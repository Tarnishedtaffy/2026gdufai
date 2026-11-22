import { describe, expect, it } from 'vitest';
import {
  createCaptureExtractor,
  mergeDraftPatch,
  PROMPT_VERSION_FOLLOWUP,
  type CaptureAiProvider,
  type CaptureDraft
} from '../../src/modules/capture/index.ts';

const REFERENCE_TIME = '2026-11-19T12:00:00+08:00';

function createStubProvider(
  completeJson: CaptureAiProvider['completeJson']
): CaptureAiProvider {
  return {
    completeJson,
    completeVisionJson: async () => {
      throw new Error('not expected');
    },
    transcribeAudio: async () => {
      throw new Error('not expected');
    }
  };
}

describe('M1 第二阶段：追问修正与补丁抽取', () => {
  it('缺金额补充只返回 amount 补丁，合并后保留已确认商户、时间、方向与源引用', async () => {
    const currentDraft: CaptureDraft = {
      amount: null,
      merchant: '瑞幸咖啡',
      occurredAt: '2026-11-19T09:00:00+08:00',
      direction: 'expense',
      confidence: 0.85,
      rawText: '早上买了杯瑞幸',
      modality: 'image',
      sourceRef: 'uploads/2026/11/receipt-01.jpg'
    };

    const extractor = createCaptureExtractor({
      uploadDir: './uploads',
      provider: createStubProvider(async () => JSON.stringify({ patch: { amount: 28.5 } }))
    });

    const outcome = await extractor.extractFollowupPatch({
      currentDraft,
      followupText: '花了28块5',
      pendingFeedback: [{ field: 'amount', code: 'MISSING_AMOUNT', severity: 'blocking' }],
      referenceTime: REFERENCE_TIME
    });

    expect(outcome).toEqual({
      ok: true,
      promptVersion: PROMPT_VERSION_FOLLOWUP,
      patch: { amount: 28.5 }
    });

    if (!outcome.ok) return;
    const merged = mergeDraftPatch(currentDraft, outcome.patch);
    expect(merged).toEqual({
      ...currentDraft,
      amount: 28.5
    });
  });

  it('时间仍未知时不填充 referenceTime，也不生成无效清空补丁', async () => {
    const currentDraft: CaptureDraft = {
      amount: 35,
      merchant: '便利蜂',
      occurredAt: null,
      direction: 'expense',
      confidence: 0.8,
      rawText: '便利蜂花了35元',
      modality: 'text',
      sourceRef: null
    };

    const extractor = createCaptureExtractor({
      uploadDir: './uploads',
      provider: createStubProvider(async () =>
        JSON.stringify({ patch: { occurredAt: null } })
      )
    });

    const outcome = await extractor.extractFollowupPatch({
      currentDraft,
      followupText: '具体哪天我不记得了',
      pendingFeedback: [{ field: 'occurredAt', code: 'MISSING_TIME', severity: 'blocking' }],
      referenceTime: REFERENCE_TIME
    });

    expect(outcome).toEqual({
      ok: true,
      promptVersion: PROMPT_VERSION_FOLLOWUP,
      patch: {}
    });
    if (!outcome.ok) return;
    expect(mergeDraftPatch(currentDraft, outcome.patch).occurredAt).toBeNull();
  });

  it('原未来时间被用户澄清为不知道时允许显式置回 null 交由 M2 兜底', async () => {
    const currentDraft: CaptureDraft = {
      amount: 48,
      merchant: '食堂',
      occurredAt: '2030-01-01T12:00:00+08:00',
      direction: 'expense',
      confidence: 0.78,
      rawText: '食堂48元',
      modality: 'text',
      sourceRef: null
    };

    const extractor = createCaptureExtractor({
      uploadDir: './uploads',
      provider: createStubProvider(async () =>
        JSON.stringify({ patch: { occurredAt: null } })
      )
    });

    const outcome = await extractor.extractFollowupPatch({
      currentDraft,
      followupText: '写错了，具体哪天记不清了',
      pendingFeedback: [{ field: 'occurredAt', code: 'FUTURE_TIME', severity: 'blocking' }],
      referenceTime: REFERENCE_TIME
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.patch).toEqual({ occurredAt: null });
    expect(mergeDraftPatch(currentDraft, outcome.patch).occurredAt).toBeNull();
  });

  it('补充退款说明时追加 rawText 而不覆盖原有已确认字段', async () => {
    const currentDraft: CaptureDraft = {
      amount: 50,
      merchant: '某服装店',
      occurredAt: null,
      direction: null,
      confidence: 0.72,
      rawText: '某服装店 50 元',
      modality: 'text',
      sourceRef: null
    };

    const extractor = createCaptureExtractor({
      uploadDir: './uploads',
      provider: createStubProvider(async () =>
        JSON.stringify({
          patch: { occurredAt: '2026-11-18T12:00:00+08:00' },
          appendRawText: true
        })
      )
    });

    const outcome = await extractor.extractFollowupPatch({
      currentDraft,
      followupText: '这笔是昨天退衣服的退款',
      referenceTime: REFERENCE_TIME
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const merged = mergeDraftPatch(currentDraft, outcome.patch);
    expect(merged.amount).toBe(50);
    expect(merged.merchant).toBe('某服装店');
    expect(merged.occurredAt).toBe('2026-11-18T12:00:00+08:00');
    expect(merged.rawText).toContain('某服装店 50 元');
    expect(merged.rawText).toContain('退款');
  });

  it('pendingFeedback 包含未知码或已废弃 REFUND_NOT_SUPPORTED 时在调用 AI 前返回 INVALID_CAPTURE_INPUT', async () => {
    let aiCalls = 0;
    const currentDraft: CaptureDraft = {
      amount: 50,
      merchant: '某服装店',
      occurredAt: null,
      direction: null,
      confidence: 0.8,
      rawText: '退货 50',
      modality: 'text',
      sourceRef: null
    };

    const extractor = createCaptureExtractor({
      uploadDir: './uploads',
      provider: createStubProvider(async () => {
        aiCalls++;
        return JSON.stringify({ patch: {} });
      })
    });

    for (const invalidCode of ['REFUND_NOT_SUPPORTED', 'NON_EXISTENT_CODE']) {
      const outcome = await extractor.extractFollowupPatch({
        currentDraft,
        followupText: '补充说明',
        pendingFeedback: [{ field: 'amount', code: invalidCode, severity: 'blocking' }],
        referenceTime: REFERENCE_TIME
      });
      expect(outcome).toEqual({
        ok: false,
        failure: {
          code: 'INVALID_CAPTURE_INPUT',
          field: 'pendingFeedback[0].code',
          message: expect.stringContaining(invalidCode)
        }
      });
    }
    expect(aiCalls).toBe(0);
  });

  it('放行契约 v1.5 现行反馈码，且忽略模型擅自回传的 patch.rawText 覆盖', async () => {
    const activeV15Codes = [
      'ORIGINAL_AMOUNT_ADJUSTED',
      'REFUND_EXCESS_AS_INCOME',
      'REPAYMENT_EXCESS_AS_EXPENSE',
      'ORIGINAL_TRANSACTION_AGED',
      'PARTIAL_REPAYMENT_RECORDED',
      'AMBIGUOUS_LOAN_PAYMENT',
      'ORIGINAL_ALREADY_SETTLED'
    ];
    const currentDraft: CaptureDraft = {
      amount: 500,
      merchant: '贷款银行',
      occurredAt: '2026-11-19T10:00:00+08:00',
      direction: null,
      confidence: 0.85,
      rawText: '还房贷 500 元',
      modality: 'text',
      sourceRef: null
    };

    const extractor = createCaptureExtractor({
      uploadDir: './uploads',
      provider: createStubProvider(async () =>
        JSON.stringify({
          patch: { amount: 450, rawText: '模型擅自改写原文' }
        })
      )
    });

    for (const code of activeV15Codes) {
      const outcome = await extractor.extractFollowupPatch({
        currentDraft,
        followupText: '本金450元',
        pendingFeedback: [{ field: 'originalTransactionId', code, severity: 'blocking' }],
        referenceTime: REFERENCE_TIME
      });
      expect(outcome).toEqual({
        ok: true,
        promptVersion: PROMPT_VERSION_FOLLOWUP,
        patch: { amount: 450 }
      });
      if (outcome.ok) {
        expect(mergeDraftPatch(currentDraft, outcome.patch).rawText).toBe('还房贷 500 元');
      }
    }
  });
});
