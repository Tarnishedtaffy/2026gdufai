import { expect, it } from 'vitest';
import * as captureFlow from '@gduf/capture-flow';
import { feedbackText } from './src/types/contract';

it('前端与确认流程使用同一份只读反馈表，避免复制后发生契约漂移', () => {
  const sharedText: unknown = Reflect.get(captureFlow, 'captureFeedbackText');
  expect(feedbackText).toBe(sharedText);
  expect(Object.isFrozen(sharedText)).toBe(true);
});
