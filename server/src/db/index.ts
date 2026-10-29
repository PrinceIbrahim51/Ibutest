import fs from 'node:fs';
import path from 'node:path';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Config } from '../config/env.js';
import * as schema from './schema.js';

export { schema };
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A database handle or an open transaction (both expose the same query builder). */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;

export interface DatabaseHandle {
  db: Database;
  driver: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens the configured database. PostgreSQL is recommended for multi-user deployments;
 * the embedded PGlite engine (PostgreSQL compiled to WebAssembly) powers local/dev and
 * desktop "local workspace" mode with the exact same schema and SQL.
 */
export async function openDatabase(config: Config): Promise<DatabaseHandle> {
  const migrationsFolder = config.db.migrationsDir;

  if (config.db.driver === 'postgres') {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const ssl =
      config.db.ssl === 'disable'
        ? false
        : {
            rejectUnauthorized: config.db.ssl === 'verify-full',
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from server config
            ca: config.db.sslCaFile ? fs.readFileSync(config.db.sslCaFile, 'utf8') : undefined,
          };
    const pool = new pg.Pool({
      connectionString: config.db.url,
      ssl,
      max: config.db.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Abort runaway queries instead of letting them pile up.
      statement_timeout: 30_000,
      application_name: 'ibutest',
    });
    const db = drizzle(pool, { schema }) as unknown as Database;
    return {
      db,
      driver: 'postgres',
      migrate: () => migrate(db as never, { migrationsFolder }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dataDir = config.db.pgliteDataDir;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from server config
  if (!dataDir.startsWith('memory://')) fs.mkdirSync(path.resolve(dataDir), { recursive: true, mode: 0o700 });
  const client = new PGlite(dataDir.startsWith('memory://') ? dataDir : path.resolve(dataDir));
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db,
    driver: 'pglite',
    migrate: () => migrate(db as never, { migrationsFolder }),
    close: () => client.close(),
  };
}
