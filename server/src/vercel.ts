/**
 * Vercel serverless entry point. The Express app (and its database connection) is created once
 * per function instance and reused across invocations.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { openDatabase } from './db/index.js';
import { createLogger } from './lib/logger.js';
import { createAiService } from './modules/ai/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let appPromise: Promise<ReturnType<typeof createApp>> | undefined;

async function init() {
  const config = loadConfig({ MIGRATIONS_DIR: path.join(here, 'drizzle'), ...process.env });
  const logger = createLogger(config.logLevel);
  const database = await openDatabase(config);
  await database.migrate();
  return createApp({ config, db: database.db, logger, ai: createAiService(config, logger) });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= init().catch((err) => {
    appPromise = undefined;
    throw err;
  });
  const app = await appPromise;
  app(req as never, res as never);
}
