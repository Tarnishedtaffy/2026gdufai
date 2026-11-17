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
  assert.notEqual(process.getuid(), 0);
  const db = new Database(process.env.DATABASE_PATH);
  assert.ok(db.pragma('user_version', { simple: true }) >= 1);
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM categories').get().count >= 11);
  db.exec("CREATE TABLE ci_probe (value TEXT); INSERT INTO ci_probe VALUES ('persisted')");
  db.close();
  writeFileSync(process.env.UPLOAD_DIR + '/ci-probe.txt', 'persisted');
`);
compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120');
compose('exec', '-T', 'app', 'node', '--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  import Database from 'better-sqlite3';
  import { readFileSync } from 'node:fs';
  const db = new Database(process.env.DATABASE_PATH);
  assert.equal(db.prepare('SELECT value FROM ci_probe').get().value, 'persisted');
  db.exec('DROP TABLE ci_probe');
  db.close();
  assert.equal(readFileSync(process.env.UPLOAD_DIR + '/ci-probe.txt', 'utf8'), 'persisted');
`);
console.log('Container smoke passed: frontend, API 404, SQLite, non-root user, persistent volumes.');
