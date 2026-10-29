import type { Config } from './config/env.js';
import type { Database } from './db/index.js';
import type { Logger } from './lib/logger.js';
import type { AiService } from './modules/ai/service.js';

/** Dependencies shared by every route module (makes the app easy to instantiate in tests). */
export interface AppContext {
  config: Config;
  db: Database;
  logger: Logger;
  ai: AiService | null;
}
