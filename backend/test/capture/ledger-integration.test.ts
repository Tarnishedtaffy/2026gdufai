import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportBatch } from '../../src/modules/capture/index.ts';
import { nowIsoShanghai } from '../../src/shared/time.ts';
import { createLedgerHarness, type LedgerHarness } from './ledger-harness.ts';

const opened: LedgerHarness[] = [];
function ledger(env: NodeJS.ProcessEnv = {}) {
  const harness = createLedgerHarness(env);
  opened.push(harness);
  return harness;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map(harness => harness.close()));
  vi.useRealTimers();
});

describe('M1 与当前 M2 契约 v1.2 的真实集成', () => {
  it.each([undefined, 'u_capture_custom'])('确认前不入库，确认后按服务端演示用户 %s 入库并能查出', async userId => {
    const h = ledger(userId === undefined ? {} : { DEMO_USER_ID: userId });
    expect(h.context.userId).toBe(userId ?? 'u_001');
    const prepared = h.session.prepare(h.context, [h.draft()]);
    h.session.update(prepared.records[0]!.record.recordId, { amount: 18.75 });
    expect(h.batches).toHaveLength(0);
    expect(h.transactionCount()).toBe(0);
    const result = await h.session.submit();
    expect(result.phase).toBe('complete');
    expect(result.records[0]!.result?.status).toBe('confirmed');
    expect(h.responses[0]?.statusCode).toBe(201);
    expect(h.db.prepare('SELECT user_id, amount_cents FROM transactions').get()).toEqual({
      user_id: userId ?? 'u_001', amount_cents: 1875,
    });
    const list = await h.app.inject({ method: 'GET', url: '/api/transactions' });
    expect(list.json()).toMatchObject({ summary: { count: 1, expenseCents: 1875 },
      items: [{ id: result.records[0]!.result!.transactionId, amountCents: 1875 }] });
    if (userId === undefined) console.info('M1_REAL_M2_EVIDENCE ' + JSON.stringify({
      transport: 'app.inject + SQLite :memory:', batchId: h.batches[0]!.batchId,
      recordId: h.batches[0]!.records[0]!.recordId, statusCode: h.responses[0]!.statusCode,
      rawResponse: h.responses[0]!.rawResponse,
    }));
  });

  it('入站用户不匹配整批拒收，不部分写入或伪装为成功', async () => {
    const h = ledger({ DEMO_USER_ID: 'u_capture_custom' });
    h.session.prepare({ ...h.context, userId: 'u_001' }, [h.draft(), h.draft({ amount: 20 })]);
    const result = await h.session.submit();
    expect(result.phase).toBe('retry');
    expect(result.error).toContain('INVALID_BATCH');
    expect(h.responses[0]).toMatchObject({ statusCode: 400,
      body: { error: { code: 'INVALID_BATCH', field: 'records[0].userId' } } });
    expect(h.transactionCount()).toBe(0);
  });

  it.each([undefined, 'Bearer incorrect-test-token'])('Bearer 鉴权拒绝 %s，改正后沿原批次重试', async authorization => {
    const h = ledger({ APP_AUTH_TOKEN: 'capture-test-token' });
    h.setAuthorization(authorization);
    h.session.prepare(h.context, [h.draft()]);
    expect((await h.session.submit()).error).toContain('UNAUTHORIZED');
    expect(h.responses[0]).toMatchObject({ statusCode: 401, body: { error: { code: 'UNAUTHORIZED' } } });
    expect(h.transactionCount()).toBe(0);
    h.setAuthorization('Bearer capture-test-token');
    expect((await h.session.submit()).phase).toBe('complete');
    expect(h.batches[1]).toEqual(h.batches[0]);
    expect(h.transactionCount()).toBe(1);
  });

  it.each(['', 'change-me'])('未配置真实 token（%s）时开发模式放行', async token => {
    const h = ledger({ APP_AUTH_TOKEN: token });
    expect(h.config.authToken).toBeNull();
    h.session.prepare(h.context, [h.draft()]);
    expect((await h.session.submit()).phase).toBe('complete');
    expect(h.transactionCount()).toBe(1);
  });

  it('缺金额只补发待追问项，recordId、幂等键不变，成功项不重复写入', async () => {
    const h = ledger();
    const prepared = h.session.prepare(h.context, [h.draft(), h.draft({ amount: null })]);
    const first = await h.session.submit();
    expect(first.phase).toBe('pending_followup');
    expect(first.records[1]!.messages[0]).toMatchObject({ code: 'MISSING_AMOUNT', severity: 'blocking' });
    expect(h.transactionCount()).toBe(1);
    const record = prepared.records[1]!.record;
    h.session.update(record.recordId, { amount: 25 });
    const second = await h.session.submit();
    expect(second.phase).toBe('complete');
    expect(second.records[0]!.result?.transactionId).toBe(first.records[0]!.result?.transactionId);
    expect(h.batches[1]?.records).toMatchObject([{ recordId: record.recordId, idempotencyKey: record.idempotencyKey, amount: 25 }]);
    expect(h.batches[1]?.records).toHaveLength(1);
    expect(h.transactionCount()).toBe(2);
  });

  it('不存在的日历日期在 M1 被拦截，绕过 M1 仍由 M2 整批拒收', async () => {
    const h = ledger();
    const invalid = `${new Date().getUTCFullYear()}-02-31T12:00:00+08:00`;
    expect(() => h.session.prepare(h.context, [h.draft({ occurredAt: invalid })])).toThrow();
    expect(h.batches).toHaveLength(0);
    const valid = h.session.prepare(h.context, [h.draft()]);
    const batch: ImportBatch = { version: 1, batchId: 'b_invalid_calendar', sentAt: h.context.sentAt,
      records: [{ ...valid.records[0]!.record, occurredAt: invalid }] };
    await h.importBatch(batch);
    expect(h.responses[0]).toMatchObject({ statusCode: 400,
      body: { error: { code: 'INVALID_BATCH', field: 'records[0].occurredAt' } } });
    expect(h.transactionCount()).toBe(0);
  });

  it.each([
    { seconds: 300, expected: 'confirmed' },
    { seconds: 301, expected: 'pending_followup' },
  ])('未来 $seconds 秒的边界由 M2 判定为 $expected', async ({ seconds, expected }) => {
    const clock = Math.floor(Date.now() / 1000) * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    const h = ledger();
    h.session.prepare(h.context, [h.draft({ occurredAt: nowIsoShanghai(new Date(clock + seconds * 1000)) })]);
    const first = await h.session.submit();
    expect(first.records[0]!.result?.status).toBe(expected);
    if (expected === 'confirmed') {
      expect(first.records[0]!.messages.some(message => message.code === 'FUTURE_TIME')).toBe(false);
      expect(h.transactionCount()).toBe(1);
    } else {
      expect(first.records[0]!.messages[0]).toMatchObject({ code: 'FUTURE_TIME', severity: 'blocking' });
      expect(h.transactionCount()).toBe(0);
      const second = await h.session.submit();
      expect(second.phase).toBe('complete');
      expect(second.records[0]!.result?.occurredAt).toBe(h.context.sentAt);
      expect(second.records[0]!.messages[0]?.code).toBe('TIME_DEFAULTED_TO_CHAT_TIME');
    }
  });

  it('真实本地 HTTP 回执丢失后复用原载荷，M2 返回 warning duplicate 而不重复入库', async () => {
    const h = ledger({ DEMO_USER_ID: 'u_http_capture', APP_AUTH_TOKEN: 'local-http-test-token' });
    const address = await h.app.listen({ port: 0, host: '127.0.0.1' });
    const unauthorized = await fetch(`${address}/api/transactions`);
    expect(unauthorized.status).toBe(401);
    await unauthorized.arrayBuffer();
    const headers = { 'content-type': 'application/json', authorization: 'Bearer local-http-test-token' };
    const payloads: ImportBatch[] = [];
    const session = h.newSession(async batch => {
      payloads.push(structuredClone(batch));
      const response = await fetch(`${address}/api/transactions/import`, { method: 'POST', headers, body: JSON.stringify(batch) });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      if (payloads.length === 1) throw new Error('Discarded response after real M2 commit');
      return body;
    });
    session.prepare(h.context, [h.draft({ amount: 13.25 })]);
    expect(h.transactionCount()).toBe(0);
    expect((await session.submit()).phase).toBe('retry');
    expect(h.transactionCount()).toBe(1);
    const retry = await session.submit();
    expect(retry.phase).toBe('complete');
    expect(retry.records[0]!.result?.status).toBe('duplicate');
    expect(retry.records[0]!.messages[0]).toMatchObject({ code: 'DUPLICATE_RECORD', severity: 'warning' });
    expect(payloads[1]).toEqual(payloads[0]);
    const listed = await fetch(`${address}/api/transactions`, { headers });
    expect(listed.status).toBe(200);
    const body: unknown = await listed.json();
    expect(body).toMatchObject({ summary: { count: 1, expenseCents: 1325 },
      items: [{ id: retry.records[0]!.result!.transactionId, amountCents: 1325 }] });
    expect(h.transactionCount()).toBe(1);
  });
});
