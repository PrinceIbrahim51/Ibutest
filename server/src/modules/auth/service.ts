import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type { AppContext } from '../../context.js';
import { sessions, users } from '../../db/schema.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { clientIp, userAgent } from '../../lib/http.js';
import { signAccessToken } from '../../lib/tokens.js';

export type UserRow = typeof users.$inferSelect;

/** The only user fields ever sent to clients (never hashes, secrets or counters). */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    mfaEnabled: u.mfaEnabled,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export function refreshCookieName(ctx: AppContext): string {
  return ctx.config.auth.cookieSecure ? '__Secure-ibt_rt' : 'ibt_rt';
}

function cookieOptions(ctx: AppContext) {
  return {
    httpOnly: true,
    secure: ctx.config.auth.cookieSecure,
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: ctx.config.auth.sessionMaxMs,
  };
}

export function setRefreshCookie(ctx: AppContext, res: Response, token: string) {
  res.cookie(refreshCookieName(ctx), token, cookieOptions(ctx));
}

export function clearRefreshCookie(ctx: AppContext, res: Response) {
  const { maxAge: _ignored, ...options } = cookieOptions(ctx);
  res.clearCookie(refreshCookieName(ctx), options);
}

/** Creates a new login session and returns the tokens for it. */
export async function startSession(ctx: AppContext, req: Request, res: Response, user: UserRow) {
  const refreshToken = randomToken(32);
  const [session] = await ctx.db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + ctx.config.auth.sessionMaxMs),
      ip: clientIp(req),
      userAgent: userAgent(req),
    })
    .returning({ id: sessions.id });
  if (!session) throw new Error('Failed to create session');

  await ctx.db
    .update(users)
    .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id));

  setRefreshCookie(ctx, res, refreshToken);
  const accessToken = await signAccessToken(
    { sub: user.id, sid: session.id },
    ctx.config.auth.jwtSecret,
    ctx.config.auth.accessTokenTtlSec,
  );
  return { accessToken, expiresIn: ctx.config.auth.accessTokenTtlSec, user: publicUser(user) };
}

/**
 * Records a failed credential check and locks the account after too many failures.
 * Returns true when this failure triggered a lock.
 */
export async function registerFailedAttempt(ctx: AppContext, userId: string): Promise<boolean> {
  const { loginMaxAttempts, lockoutMs } = ctx.config.auth;
  const [row] = await ctx.db
    .update(users)
    .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
    .where(eq(users.id, userId))
    .returning({ failed: users.failedLoginCount });
  if (row && row.failed >= loginMaxAttempts) {
    await ctx.db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + lockoutMs) })
      .where(eq(users.id, userId));
    return true;
  }
  return false;
}

export function isLocked(user: UserRow): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}

export async function revokeAllSessions(ctx: AppContext, userId: string, exceptSessionId?: string) {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(sessions.id, exceptSessionId));
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions));
}
