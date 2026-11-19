import { computed, inject, shallowRef, type InjectionKey } from 'vue';
import { createCaptureSession, type CaptureContext, type CaptureDependencies, type CaptureDraft } from '@gduf/capture-flow';
import { importBatch } from '../api/index';
import { getDemoUserId, isMockEnabled } from '../api/request';
import { nowIso } from '../utils/datetime';

/** 由已验证的会话提供身份；不得把模型输出或表单字段作为身份来源。 */
export type CaptureContextProvider = () => CaptureContext;
export const captureContextKey: InjectionKey<CaptureContextProvider> = Symbol('captureContext');

interface CaptureUiDependencies extends CaptureDependencies {
  isMock: () => boolean;
  now: () => string;
}

/** 包装共享流程并保留响应式快照；只有 confirm 会调用注入的 M2 客户端。 */
export function createCaptureFlow(deps: CaptureUiDependencies) {
  const session = createCaptureSession(deps);
  const snapshot = shallowRef(session.getSnapshot());
  const inputError = shallowRef<string | null>(null);
  const contextProvider = shallowRef<CaptureContextProvider | null>(null);
  const demoSessionId = deps.newId();
  const canPrepare = computed(() => deps.isMock() || contextProvider.value !== null);

  function context(): CaptureContext {
    if (contextProvider.value) return contextProvider.value();
    if (!deps.isMock()) throw new Error('真实记账尚未接入登录会话，暂不能提交。');
    const sentAt = deps.now();
    return { sessionId: demoSessionId, userId: getDemoUserId(), sentAt, chatAt: sentAt };
  }

  function apply(action: () => void): boolean {
    inputError.value = null;
    try {
      action();
      snapshot.value = session.getSnapshot();
      return true;
    } catch (error: unknown) {
      inputError.value = error instanceof Error ? error.message : '草稿处理失败';
      return false;
    }
  }

  /** 接收经过校验的识别草稿；准备和修改均不触发导入。 */
  function prepare(drafts: CaptureDraft[]): boolean {
    return apply(() => { session.prepare(context(), drafts); });
  }

  /** 只合并用户明确修改的字段，身份与幂等键交由共享流程保持。 */
  function update(recordId: string, patch: Partial<CaptureDraft>): boolean {
    return apply(() => { session.update(recordId, patch); });
  }

  /** 仅清除本地草稿；提交中由共享流程拒绝，不向服务端发送撤销操作。 */
  function discard(): boolean {
    return apply(() => { session.discard(); });
  }

  /** 显式确认或重试原载荷；跨账号时阻止复用之前的待提交记录。 */
  async function confirm(): Promise<void> {
    inputError.value = null;
    try {
      const current = context();
      const first = snapshot.value.records[0];
      if (current.sessionId !== snapshot.value.sessionId || first?.record.userId !== current.userId) {
        throw new Error('登录会话已变化，请返回原会话处理这笔待提交记录。');
      }
      const pending = session.submit();
      snapshot.value = session.getSnapshot();
      await pending;
    } catch (error: unknown) {
      inputError.value = error instanceof Error ? error.message : '提交失败';
    } finally {
      snapshot.value = session.getSnapshot();
    }
  }

  return {
    snapshot, inputError, canPrepare, prepare, update, confirm, discard,
    setContextProvider: (provider: CaptureContextProvider | null) => { contextProvider.value = provider; },
  };
}

// 仅留在当前页面内存中，SPA 切页仍保留待追问记录与未决提交的幂等键。
const sharedFlow = createCaptureFlow({ importBatch, newId: () => crypto.randomUUID(), isMock: isMockEnabled, now: nowIso });

// 绑定共享会话生命周期，切到其他 SPA 页面后仍保护未决传输的原载荷与幂等键。
function protectUnresolved(event: BeforeUnloadEvent): void {
  const phase = sharedFlow.snapshot.value.phase;
  if (phase === 'submitting' || phase === 'retry') { event.preventDefault(); event.returnValue = ''; }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', protectUnresolved);
  import.meta.hot?.dispose(() => window.removeEventListener('beforeunload', protectUnresolved));
}

/** 复用会话状态；真实模式必须由应用的可信会话层提供 captureContextKey。 */
export function useCaptureFlow() {
  sharedFlow.setContextProvider(inject(captureContextKey, null));
  return sharedFlow;
}
