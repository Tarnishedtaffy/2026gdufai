import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// 只在独立 CI Compose project 中写入虚构探针数据，避免污染日常开发数据库。
assert.match(process.env.COMPOSE_PROJECT_NAME ?? '', /^gdufai-ci-[a-z0-9-]+$/);
const origin = `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
const compose = (...args) => {
  const result = spawnSync('docker', ['compose', ...args], { stdio: 'inherit' });
  assert.equal(result.status, 0, `docker compose ${args[0]} failed`);
};
for (const path of ['/', '/stats', '/transactions', '/budget']) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /<div id="app">/);
}
const missing = await fetch(`${origin}/api/ci-not-found`, { signal: AbortSignal.timeout(5000) });
assert.equal(missing.status, 404);
assert.match(missing.headers.get('content-type'), /application\/json/);
compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import Database from 'better-sqlite3';
  import { writeFileSync } from 'node:fs';
  import { createCaptureSession } from '@gduf/capture-flow';
  assert.equal(typeof createCaptureSession, 'function');
  assert.notEqual(process.getuid(), 0);
  const db = new Database(process.env.DATABASE_PATH);
  assert.ok(db.pragma('user_version', { simple: true }) >= 1);
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM categories').get().count >= 11);
  db.exec("CREATE TABLE ci_probe (value TEXT); INSERT INTO ci_probe VALUES ('persisted')");
  db.close();
  writeFileSync(process.env.UPLOAD_DIR + '/ci-probe.txt', 'persisted');
`);
// 模拟旧卷为 root 所有且 node 不可写；只操作本脚本限定的隔离 CI project。
compose('stop', 'app');
compose('run', '--rm', '--no-deps', '--user', '0:0', '--entrypoint', 'sh', 'app', '-c',
  'chown -hR root:root /app/data /app/uploads && chmod 500 /app/data /app/uploads && chmod 000 /app/data/app.db /app/uploads/ci-probe.txt');
compose('run', '--rm', '--no-deps', '--user', '0:0', '--entrypoint', 'repair-volume-permissions', 'app');
compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120');
compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import Database from 'better-sqlite3';
  import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
  const db = new Database(process.env.DATABASE_PATH);
  assert.equal(db.prepare('SELECT value FROM ci_probe').get().value, 'persisted');
  db.exec('DROP TABLE ci_probe');
  db.close();
  assert.equal(readFileSync(process.env.UPLOAD_DIR + '/ci-probe.txt', 'utf8'), 'persisted');
  appendFileSync(process.env.UPLOAD_DIR + '/ci-probe.txt', '-writable');
  writeFileSync(process.env.UPLOAD_DIR + '/ci-new.txt', 'new upload');
`);
console.log('Container smoke passed: frontend, API 404, SQLite, non-root user, repaired persistent volumes.');
