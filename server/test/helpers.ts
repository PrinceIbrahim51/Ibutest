import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { AppContext } from '../src/context.js';
import { openDatabase } from '../src/db/index.js';
import { createLogger } from '../src/lib/logger.js';
import type { AiService } from '../src/modules/ai/service.js';

export const ADMIN = { name: 'Ada Admin', email: 'admin@ibutest.dev', password: 'Correct-Horse-Battery-9' };
export const CSRF = { 'X-Requested-With': 'IbuTest' };

/**
 * Tests run against in-memory PGlite by default. Set TEST_DATABASE_URL (a PostgreSQL URL with
 * CREATEDB rights) to run the same suite against a real server: each app gets a fresh database.
 */
async function freshPostgres(): Promise<{ url: string; drop: () => Promise<void> } | null> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) return null;
  const { default: pg } = await import('pg');
  const name = `ibutest_test_${randomBytes(6).toString('hex')}`;
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    async drop() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function createTestApp(env: Record<string, string> = {}, ai: AiService | null = null) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibutest-uploads-'));
  const pgDb = await freshPostgres();
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-only-jwt-secret-that-is-long-enough-123456',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PGLITE_DATA_DIR: 'memory://',
    UPLOAD_DIR: uploadDir,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_AUTH_PER_15MIN: '1000',
    RATE_LIMIT_API_PER_MIN: '100000',
    ...(pgDb ? { DB_DRIVER: 'postgres', DATABASE_URL: pgDb.url } : {}),
    ...env,
  });
  const database = await openDatabase(config);
  await database.migrate();
  const ctx: AppContext = { config, db: database.db, logger: createLogger('silent'), ai };
  const app = createApp(ctx);
  const request = supertest(app);
  return {
    app,
    ctx,
    request,
    async close() {
      await database.close();
      await pgDb?.drop();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export function refreshCookie(res: supertest.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('ibt_rt=') || c.startsWith('__Secure-ibt_rt='));
  if (!cookie) throw new Error('no refresh cookie in response');
  return cookie.split(';')[0]!;
}

export async function setupAdmin(t: TestApp) {
  const res = await t.request.post('/api/auth/setup').send(ADMIN).expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string, cookie: refreshCookie(res) };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Creates a user through the admin API and completes the forced password change. */
export async function createUser(t: TestApp, adminToken: string, email: string, role: 'admin' | 'user' = 'user') {
  const initial = 'Initial-Password-123x';
  const password = 'Changed-Password-456y';
  const created = await t.request
    .post('/api/admin/users')
    .set(bearer(adminToken))
    .send({ email, name: email.split('@')[0], role, password: initial })
    .expect(201);
  const login = await t.request.post('/api/auth/login').send({ email, password: initial }).expect(200);
  await t.request
    .post('/api/auth/change-password')
    .set(bearer(login.body.accessToken))
    .send({ currentPassword: initial, newPassword: password })
    .expect(204);
  return { token: login.body.accessToken as string, userId: created.body.user.id as string, password };
}

export async function createProject(t: TestApp, adminToken: string, key = 'DEMO') {
  const res = await t.request
    .post('/api/projects')
    .set(bearer(adminToken))
    .send({ key, name: `${key} project`, description: 'Test project' })
    .expect(201);
  return res.body.project.id as string;
}

export async function addMember(t: TestApp, managerToken: string, projectId: string, userId: string, role: string) {
  await t.request.put(`/api/projects/${projectId}/members`).set(bearer(managerToken)).send({ userId, role }).expect(204);
}
