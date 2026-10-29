import type { Server } from 'node:http';
import { createApp } from './app.js';
import { type Config, loadConfig } from './config/env.js';
import type { AppContext } from './context.js';
import { openDatabase } from './db/index.js';
import { createLogger } from './lib/logger.js';
import { createAiService } from './modules/ai/service.js';

export interface RunningServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

/** Boots the API: validates config, migrates the database and starts listening. */
export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<RunningServer> {
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (err) {
    console.error((err as Error).message);
    throw err;
  }
  const logger = createLogger(config.logLevel);
  const database = await openDatabase(config);
  await database.migrate();
  const ctx: AppContext = { config, db: database.db, logger, ai: createAiService(config, logger) };
  const app = createApp(ctx);

  const server = app.listen(config.port, config.host);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  // Slow-client protections.
  server.headersTimeout = 20_000;
  server.requestTimeout = 300_000;
  server.keepAliveTimeout = 5_000;
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info(
    { host: config.host, port, env: config.env, db: database.driver, ai: !!ctx.ai, cors: config.corsOrigins },
    'IbuTest server started',
  );

  return {
    server,
    port,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.close();
    },
  };
}
