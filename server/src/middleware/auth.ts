import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import type { AppContext } from '../context.js';
import { apiTokens, projectMembers, sessions, users } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

function bearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 && token.length < 4096 ? token : null;
}

interface AuthOptions {
  /** Allow users that must change their password (only the password/profile endpoints). */
  allowPasswordChangeRequired?: boolean;
}

/**
 * Verifies the JWT access token *and* that its session is still valid in the database,
 * so logout, password changes and admin deactivation take effect immediately.
 */
export function authenticate(ctx: AppContext, options: AuthOptions = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    if (token.startsWith('ibt_')) throw unauthorized('API tokens are only accepted by the automation API');
    const claims = await verifyAccessToken(token, ctx.config.auth.jwtSecret);
    if (!claims) throw unauthorized('Invalid or expired access token');

    const [row] = await ctx.db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        mfaEnabled: users.mfaEnabled,
        mustChangePassword: users.mustChangePassword,
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, claims.sid), eq(sessions.userId, claims.sub)))
      .limit(1);

    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now() || !row.isActive) {
      throw unauthorized('Session has ended, please sign in again');
    }
    if (row.mustChangePassword && !options.allowPasswordChangeRequired) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing');
    }

    req.auth = {
      userId: row.userId,
      sessionId: claims.sid,
      email: row.email,
      name: row.name,
      role: row.role,
      mfaEnabled: row.mfaEnabled,
      mustChangePassword: row.mustChangePassword,
    };
    next();
  };
}

/** Admin-only routes. Optionally insists on MFA for administrators. */
export function requireAdmin(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || req.auth.role !== 'admin') throw forbidden('Administrator access required');
    if (ctx.config.auth.adminRequireMfa && !req.auth.mfaEnabled) {
      throw new AppError(403, 'MFA_REQUIRED', 'Enable two-factor authentication to use administrator features');
    }
    next();
  };
}

/**
 * Authenticates automation clients using project-scoped API tokens. The token owner must
 * still be an active member of the project with at least the "tester" role.
 */
export function authenticateApiToken(ctx: AppContext) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token || !token.startsWith('ibt_')) throw unauthorized('A project API token is required');
    const [row] = await ctx.db
      .select({
        tokenId: apiTokens.id,
        userId: apiTokens.userId,
        projectId: apiTokens.projectId,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
        isActive: users.isActive,
        userRole: users.role,
        memberRole: projectMembers.role,
      })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, apiTokens.projectId), eq(projectMembers.userId, apiTokens.userId)),
      )
      .where(eq(apiTokens.tokenHash, sha256(token)))
      .limit(1);

    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now() || !row.isActive) {
      throw unauthorized('Invalid, expired or revoked API token');
    }
    const role = row.userRole === 'admin' ? 'manager' : row.memberRole;
    if (!role || role === 'viewer') throw forbidden('Token owner no longer has write access to this project');

    await ctx.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
    req.apiToken = { tokenId: row.tokenId, userId: row.userId, projectId: row.projectId };
    next();
  };
}

/** Returns the authenticated caller (for handlers mounted behind `authenticate`). */
export function authOf(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
