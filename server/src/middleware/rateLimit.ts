import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Config } from '../config/env.js';
import { tooMany } from '../lib/errors.js';

function limiter(windowMs: number, limit: number, keyGenerator?: (req: Request) => string, message?: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, _res, next) => next(tooMany(message)),
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? '0.0.0.0');

export function createRateLimiters(config: Config) {
  const { apiPerMin, authPer15Min, aiPerHour } = config.rateLimits;
  return {
    /** Global safety net for every API request, per client IP. */
    api: limiter(60_000, apiPerMin, ipKey),
    /** Credential endpoints (login, MFA, setup, registration), per client IP. */
    auth: limiter(15 * 60_000, authPer15Min, ipKey, 'Too many authentication attempts, please try again later'),
    /** Token refresh is cheap but should still be bounded. */
    refresh: limiter(15 * 60_000, Math.max(authPer15Min * 10, 100), ipKey),
    /** AI endpoints cost money: limited per user rather than per IP. */
    ai: limiter(60 * 60_000, aiPerHour, (req) => req.auth?.userId ?? ipKey(req), 'AI request limit reached, try again later'),
    /** Automation result uploads, per API token. */
    automation: limiter(60_000, 60, (req) => req.apiToken?.tokenId ?? ipKey(req)),
    /** File uploads, per user. */
    upload: limiter(60 * 60_000, 200, (req) => req.auth?.userId ?? ipKey(req)),
  };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
