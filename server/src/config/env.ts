import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ package root (works for both src/ via tsx and dist/ bundles). */
export const SERVER_ROOT = path.resolve(here, '..', here.endsWith(path.join('src', 'config')) ? '..' : '');

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? fallback : ['true', '1', 'yes'].includes(v)));

const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

/** Values copied from .env.example that must never be used for real deployments. */
const PLACEHOLDER = /change[-_ ]?me|replace[-_ ]?me|example|placeholder|your[-_]/i;

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: int(4000, 0, 65535),
    PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: z.string().default('false'),

    DB_DRIVER: z.enum(['postgres', 'pglite']).default('pglite'),
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
    DATABASE_SSL_CA_FILE: z.string().optional(),
    DATABASE_POOL_MAX: int(10, 1, 200),
    PGLITE_DATA_DIR: z.string().default('./data/pglite'),
    MIGRATIONS_DIR: z.string().optional(),
    CLIENT_DIST_DIR: z.string().optional(),
    UPLOAD_DIR: z.string().default('./data/uploads'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64 encoded'),
    ACCESS_TOKEN_TTL_MIN: int(15, 1, 60),
    SESSION_MAX_DAYS: int(7, 1, 90),
    SESSION_IDLE_HOURS: int(12, 1, 24 * 30),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    ALLOW_REGISTRATION: bool(false),
    SETUP_TOKEN: z.string().min(16).optional(),
    ADMIN_REQUIRE_MFA: bool(false),
    LOGIN_MAX_ATTEMPTS: int(5, 3, 20),
    LOCKOUT_MINUTES: int(15, 1, 1440),

    RATE_LIMIT_API_PER_MIN: int(300, 10, 100000),
    RATE_LIMIT_AUTH_PER_15MIN: int(20, 3, 1000),
    AI_REQUESTS_PER_HOUR: int(30, 1, 10000),
    AI_DAILY_TOKEN_LIMIT: int(300000, 1000, 100000000),

    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-opus-5-5'),
    AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.DB_DRIVER === 'postgres' && !env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DATABASE_URL is required when DB_DRIVER=postgres' });
    }
    if (env.CORS_ORIGINS.split(',').some((o) => o.trim() === '*')) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Wildcard CORS origins are not allowed' });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY', 'SETUP_TOKEN'] as const) {
        const value = env[key];
        if (value && PLACEHOLDER.test(value)) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} still contains a placeholder value` });
        }
      }
      if (env.JWT_SECRET.length < 48) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'Use at least 48 random characters in production' });
      }
      if (env.COOKIE_SECURE === 'false') {
        ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE cannot be false in production' });
      }
      if (env.ANTHROPIC_API_KEY !== undefined && env.ANTHROPIC_API_KEY !== '' && PLACEHOLDER.test(env.ANTHROPIC_API_KEY)) {
        ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'ANTHROPIC_API_KEY contains a placeholder value' });
      }
    }
  });

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // e.g. "loopback", "10.0.0.0/8"
}

export type Config = ReturnType<typeof loadConfig>;

/**
 * Validates environment variables once at start-up. Invalid or insecure configuration
 * aborts the process with a list of problems (secret values are never printed).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const e = result.data;
  const isProd = e.NODE_ENV === 'production';
  const corsOrigins = e.CORS_ORIGINS.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (e.PUBLIC_URL) corsOrigins.push(new URL(e.PUBLIC_URL).origin);

  return {
    env: e.NODE_ENV,
    isProd,
    isTest: e.NODE_ENV === 'test',
    host: e.HOST,
    port: e.PORT,
    publicUrl: e.PUBLIC_URL,
    corsOrigins: [...new Set(corsOrigins)],
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    db: {
      driver: e.DB_DRIVER,
      url: e.DATABASE_URL,
      ssl: e.DATABASE_SSL,
      sslCaFile: e.DATABASE_SSL_CA_FILE,
      poolMax: e.DATABASE_POOL_MAX,
      pgliteDataDir: e.PGLITE_DATA_DIR,
      migrationsDir: e.MIGRATIONS_DIR ?? path.join(SERVER_ROOT, 'drizzle'),
    },
    clientDistDir: e.CLIENT_DIST_DIR,
    uploadDir: path.resolve(e.UPLOAD_DIR),
    auth: {
      jwtSecret: new TextEncoder().encode(e.JWT_SECRET),
      encryptionKey: Buffer.from(e.ENCRYPTION_KEY, 'base64'),
      accessTokenTtlSec: e.ACCESS_TOKEN_TTL_MIN * 60,
      sessionMaxMs: e.SESSION_MAX_DAYS * 24 * 60 * 60 * 1000,
      sessionIdleMs: e.SESSION_IDLE_HOURS * 60 * 60 * 1000,
      cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : isProd,
      allowRegistration: e.ALLOW_REGISTRATION,
      setupToken: e.SETUP_TOKEN,
      adminRequireMfa: e.ADMIN_REQUIRE_MFA,
      loginMaxAttempts: e.LOGIN_MAX_ATTEMPTS,
      lockoutMs: e.LOCKOUT_MINUTES * 60 * 1000,
    },
    rateLimits: {
      apiPerMin: e.RATE_LIMIT_API_PER_MIN,
      authPer15Min: e.RATE_LIMIT_AUTH_PER_15MIN,
      aiPerHour: e.AI_REQUESTS_PER_HOUR,
      aiDailyTokens: e.AI_DAILY_TOKEN_LIMIT,
    },
    ai: {
      apiKey: e.ANTHROPIC_API_KEY || undefined,
      model: e.AI_MODEL,
      effort: e.AI_EFFORT,
    },
    logLevel: e.LOG_LEVEL,
  };
}
