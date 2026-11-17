import { buildApp } from './app.ts';
import { loadConfig } from './config/index.ts';
import { openDatabase } from './db/client.ts';
import { seedCategories } from './db/seed/categories.ts';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerFrontend } from './frontend.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);
seedCategories(db);

const app = buildApp({ config, db });
const frontendRoot = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
if (existsSync(`${frontendRoot}/index.html`)) {
  await registerFrontend(app, frontendRoot);
} else if (config.nodeEnv === 'production') {
  throw new Error('生产启动前必须先构建 frontend/dist');
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`收到 ${signal}，正在关闭服务`);
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
