import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config/index.ts';
import { openDatabase } from '../../src/db/client.ts';
import { seedCategories } from '../../src/db/seed/categories.ts';
import { seedDemoUser } from '../../src/db/seed/users.ts';
import { nowIsoShanghai } from '../../src/shared/time.ts';
import { createCaptureSession } from '../../src/modules/capture/index.ts';
import type { CaptureContext, CaptureDraft, ImportBatch } from '../../src/modules/capture/index.ts';

/** Real current M2 routes and SQLite; only the caller's transport is injected into M1. */
export function createLedgerHarness(env: NodeJS.ProcessEnv = {}) {
  const config = { ...loadConfig({ NODE_ENV: 'test', ...env }), port: 0, databasePath: ':memory:' };
  const db = openDatabase(':memory:');
  seedCategories(db);
  seedDemoUser(db, config.demoUserId);
  const app = buildApp({ config, db });
  const batches: ImportBatch[] = [];
  const responses: { statusCode: number; body: unknown; rawResponse: string }[] = [];
  let serial = 0;
  let authorization = config.authToken === null ? undefined : `Bearer ${config.authToken}`;
  const context: CaptureContext = {
    sessionId: 'session_capture_integration', userId: config.demoUserId,
    sentAt: nowIsoShanghai(), chatAt: null,
  };
  const importBatch = async (batch: ImportBatch): Promise<unknown> => {
    batches.push(structuredClone(batch));
    const response = await app.inject({ method: 'POST', url: '/api/transactions/import', payload: batch,
      headers: authorization === undefined ? {} : { authorization } });
    const body: unknown = response.json();
    responses.push({ statusCode: response.statusCode, body, rawResponse: response.body });
    return body;
  };
  const newSession = (transport = importBatch) => createCaptureSession({
    importBatch: transport, newId: () => String(++serial),
  });
  const draft = (patch: Partial<CaptureDraft> = {}): CaptureDraft => ({
    amount: 12.5, merchant: '虚构食堂', direction: null, confidence: 0.9,
    occurredAt: nowIsoShanghai(new Date(Date.now() - 60 * 60 * 1000)),
    rawText: '演示午餐 12.50 元', modality: 'text', sourceRef: null, ...patch,
  });
  return {
    app, db, config, context, draft, batches, responses, importBatch, newSession, session: newSession(),
    setAuthorization: (value: string | undefined) => { authorization = value; },
    transactionCount: () => (db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count,
    close: async () => { await app.close(); db.close(); },
  };
}

export type LedgerHarness = ReturnType<typeof createLedgerHarness>;
