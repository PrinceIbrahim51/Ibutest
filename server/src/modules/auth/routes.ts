import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  changePasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  registerSchema,
  setupSchema,
  updateProfileSchema,
} from '@ibutest/shared';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { type Request, Router } from 'express';
import type { AppContext } from '../../context.js';
import { sessions, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { parseBody, uuidParam } from '../../lib/http.js';
import { hashPassword, verifyDummy, verifyPassword } from '../../lib/password.js';
import { signAccessToken, signMfaToken, verifyMfaToken } from '../../lib/tokens.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../../lib/totp.js';
import { authenticate, authOf } from '../../middleware/auth.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import { isAllowedOrigin } from '../../middleware/security.js';
import {
  clearRefreshCookie,
  isLocked,
  publicUser,
  refreshCookieName,
  registerFailedAttempt,
  revokeAllSessions,
  setRefreshCookie,
  startSession,
} from './service.js';

const INVALID_CREDENTIALS = 'Invalid email or password, or the account is temporarily locked';
/** Window in which a just-rotated refresh token is treated as a benign multi-tab race. */
const ROTATION_GRACE_MS = 30_000;

export function authRouter(ctx: AppContext, limiters: RateLimiters) {
  const router = Router();
  const auth = authenticate(ctx);
  const authAllowingPasswordChange = authenticate(ctx, { allowPasswordChangeRequired: true });

  /** Cookie-authenticated endpoints need CSRF protection: custom header + Origin check. */
  function requireCsrf(req: Request) {
    if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) throw forbidden('Missing anti-CSRF header');
    const origin = req.get('origin');
    if (origin && !isAllowedOrigin(ctx.config, origin, req)) throw forbidden('Request origin is not allowed');
  }

  async function userCount() {
    const [row] = await ctx.db.select({ n: count() }).from(users);
    return row?.n ?? 0;
  }

  router.get('/status', async (_req, res) => {
    const setupRequired = (await userCount()) === 0;
    res.json({
      setupRequired,
      setupTokenRequired: setupRequired && (!!ctx.config.auth.setupToken || ctx.config.isProd),
      registrationEnabled: ctx.config.auth.allowRegistration,
      aiAvailable: !!ctx.ai,
    });
  });

  // First-run bootstrap: creates the initial administrator while no users exist.
  router.post('/setup', limiters.auth, async (req, res) => {
    const body = parseBody(setupSchema, req);
    const expected = ctx.config.auth.setupToken;
    if (ctx.config.isProd && !expected) {
      throw forbidden('Initial setup over HTTP is disabled. Set SETUP_TOKEN or run "npm run create-admin".');
    }
    if (expected) {
      const provided = body.setupToken ?? req.get('x-setup-token') ?? '';
      if (!safeEqual(provided, expected)) throw forbidden('Invalid setup token');
    }
    const passwordHash = await hashPassword(body.password);
    const user = await ctx.db.transaction(async (tx) => {
      // Serialise concurrent setup attempts so only one administrator can ever be bootstrapped.
      await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);
      const [existing] = await tx.select({ n: count() }).from(users);
      if ((existing?.n ?? 0) > 0) return null;
      const [created] = await tx
        .insert(users)
        .values({ email: body.email, name: body.name, passwordHash, role: 'admin' })
        .returning();
      return created ?? null;
    });
    if (!user) throw conflict('Setup has already been completed', 'SETUP_DONE');
    await audit(ctx, req, 'auth.setup', { entityType: 'user', entityId: user.id, actor: { id: user.id, email: user.email } });
    res.status(201).json(await startSession(ctx, req, res, user));
  });

  router.post('/register', limiters.auth, async (req, res) => {
    if (!ctx.config.auth.allowRegistration) throw notFound('Endpoint');
    const body = parseBody(registerSchema, req);
    const passwordHash = await hashPassword(body.password);
    const [user] = await ctx.db
      .insert(users)
      .values({ email: body.email, name: body.name, passwordHash, role: 'user' })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (!user) throw conflict('An account with this email already exists');
    await audit(ctx, req, 'auth.register', { entityType: 'user', entityId: user.id, actor: { id: user.id, email: user.email } });
    res.status(201).json(await startSession(ctx, req, res, user));
  });

  router.post('/login', limiters.auth, async (req, res) => {
    const body = parseBody(loginSchema, req);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email)).limit(1);

    if (!user) {
      await verifyDummy(body.password);
      await audit(ctx, req, 'auth.login_failed', { details: { email: body.email, reason: 'unknown_user' }, actor: null });
      throw unauthorized(INVALID_CREDENTIALS);
    }
    const actor = { id: user.id, email: user.email };
    if (isLocked(user)) {
      await verifyDummy(body.password);
      await audit(ctx, req, 'auth.login_failed', { details: { reason: 'locked' }, actor });
      throw unauthorized(INVALID_CREDENTIALS);
    }
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      const locked = await registerFailedAttempt(ctx, user.id);
      await audit(ctx, req, locked ? 'auth.account_locked' : 'auth.login_failed', { details: { reason: 'bad_password' }, actor });
      throw unauthorized(INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      await audit(ctx, req, 'auth.login_failed', { details: { reason: 'inactive' }, actor });
      throw forbidden('This account has been deactivated');
    }
    if (user.mfaEnabled) {
      res.json({ mfaRequired: true, mfaToken: await signMfaToken(user.id, ctx.config.auth.jwtSecret) });
      return;
    }
    await audit(ctx, req, 'auth.login', { actor });
    res.json(await startSession(ctx, req, res, user));
  });

  router.post('/mfa/verify', limiters.auth, async (req, res) => {
    const body = parseBody(mfaVerifySchema, req);
    const userId = await verifyMfaToken(body.mfaToken, ctx.config.auth.jwtSecret);
    if (!userId) throw unauthorized('Your sign-in attempt expired, please start again');
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecretEnc || isLocked(user)) {
      throw unauthorized(INVALID_CREDENTIALS);
    }
    const actor = { id: user.id, email: user.email };
    const step = verifyTotp(decryptSecret(user.mfaSecretEnc, ctx.config.auth.encryptionKey), body.code, user.mfaLastStep);
    if (step === null) {
      const locked = await registerFailedAttempt(ctx, user.id);
      await audit(ctx, req, locked ? 'auth.account_locked' : 'auth.mfa_failed', { actor });
      throw unauthorized('Invalid verification code');
    }
    await ctx.db.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
    await audit(ctx, req, 'auth.login', { actor, details: { mfa: true } });
    res.json(await startSession(ctx, req, res, user));
  });

  router.post('/refresh', limiters.refresh, async (req, res) => {
    requireCsrf(req);
    const token: unknown = req.cookies?.[refreshCookieName(ctx)];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
      clearRefreshCookie(ctx, res);
      throw unauthorized('No active session');
    }
    const hash = sha256(token);
    const now = Date.now();
    const [session] = await ctx.db.select().from(sessions).where(eq(sessions.tokenHash, hash)).limit(1);

    if (session) {
      const idleExpired = now - session.lastUsedAt.getTime() > ctx.config.auth.sessionIdleMs;
      if (session.revokedAt || session.expiresAt.getTime() < now || idleExpired) {
        clearRefreshCookie(ctx, res);
        throw unauthorized('Session has ended, please sign in again');
      }
      const [user] = await ctx.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
      if (!user || !user.isActive) {
        clearRefreshCookie(ctx, res);
        throw unauthorized('Session has ended, please sign in again');
      }
      // Rotate: every refresh token is single-use.
      const next = randomToken(32);
      const [rotated] = await ctx.db
        .update(sessions)
        .set({ tokenHash: sha256(next), previousTokenHash: hash, rotatedAt: new Date(now), lastUsedAt: new Date(now) })
        .where(and(eq(sessions.id, session.id), eq(sessions.tokenHash, hash)))
        .returning({ id: sessions.id });
      if (!rotated) throw new AppError(409, 'REFRESH_RACE', 'Session was refreshed concurrently, retry');
      setRefreshCookie(ctx, res, next);
      const accessToken = await signAccessToken(
        { sub: user.id, sid: session.id },
        ctx.config.auth.jwtSecret,
        ctx.config.auth.accessTokenTtlSec,
      );
      res.json({ accessToken, expiresIn: ctx.config.auth.accessTokenTtlSec, user: publicUser(user) });
      return;
    }

    const [previous] = await ctx.db.select().from(sessions).where(eq(sessions.previousTokenHash, hash)).limit(1);
    if (previous && !previous.revokedAt) {
      if (previous.rotatedAt && now - previous.rotatedAt.getTime() < ROTATION_GRACE_MS) {
        // Another tab rotated the token a moment ago; the browser already holds the new cookie.
        throw new AppError(409, 'REFRESH_RACE', 'Session was refreshed concurrently, retry');
      }
      // A rotated-out token was replayed: assume it was stolen and kill the whole session.
      await ctx.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, previous.id));
      await audit(ctx, req, 'auth.refresh_token_reuse', {
        entityType: 'session',
        entityId: previous.id,
        actor: { id: previous.userId, email: '' },
      });
    }
    clearRefreshCookie(ctx, res);
    throw unauthorized('Session has ended, please sign in again');
  });

  router.post('/logout', async (req, res) => {
    requireCsrf(req);
    const token: unknown = req.cookies?.[refreshCookieName(ctx)];
    if (typeof token === 'string' && token.length <= 200) {
      const [session] = await ctx.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id, userId: sessions.userId });
      if (session) {
        await audit(ctx, req, 'auth.logout', { entityType: 'session', entityId: session.id, actor: { id: session.userId, email: '' } });
      }
    }
    clearRefreshCookie(ctx, res);
    res.status(204).end();
  });

  // ---------------------------------------------------------------- profile
  router.get('/me', authAllowingPasswordChange, async (req, res) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, authOf(req).userId)).limit(1);
    if (!user) throw unauthorized();
    res.json({ user: publicUser(user) });
  });

  router.patch('/me', auth, async (req, res) => {
    const body = parseBody(updateProfileSchema, req);
    const [user] = await ctx.db.update(users).set({ name: body.name }).where(eq(users.id, authOf(req).userId)).returning();
    if (!user) throw unauthorized();
    res.json({ user: publicUser(user) });
  });

  router.post('/change-password', limiters.auth, authAllowingPasswordChange, async (req, res) => {
    const me = authOf(req);
    const body = parseBody(changePasswordSchema, req);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, me.userId)).limit(1);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      await registerFailedAttempt(ctx, user.id);
      throw badRequest('Current password is incorrect');
    }
    if (body.newPassword === body.currentPassword) throw badRequest('New password must be different');
    const localPart = user.email.split('@')[0] ?? '';
    if (localPart.length >= 4 && body.newPassword.toLowerCase().includes(localPart)) {
      throw badRequest('Password must not contain your email address');
    }
    await ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, passwordChangedAt: new Date() })
      .where(eq(users.id, user.id));
    await revokeAllSessions(ctx, user.id, me.sessionId);
    await audit(ctx, req, 'auth.password_changed', { entityType: 'user', entityId: user.id });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- MFA (TOTP)
  router.post('/mfa/setup', auth, async (req, res) => {
    const me = authOf(req);
    if (me.mfaEnabled) throw conflict('Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await ctx.db
      .update(users)
      .set({ mfaPendingSecretEnc: encryptSecret(secret, ctx.config.auth.encryptionKey) })
      .where(eq(users.id, me.userId));
    res.json({ secret, otpauthUrl: totpUri(secret, me.email) });
  });

  router.post('/mfa/enable', limiters.auth, auth, async (req, res) => {
    const me = authOf(req);
    const body = parseBody(mfaCodeSchema, req);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, me.userId)).limit(1);
    if (!user?.mfaPendingSecretEnc) throw badRequest('Start two-factor setup first');
    const step = verifyTotp(decryptSecret(user.mfaPendingSecretEnc, ctx.config.auth.encryptionKey), body.code, null);
    if (step === null) throw badRequest('Invalid verification code');
    await ctx.db
      .update(users)
      .set({ mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaLastStep: step })
      .where(eq(users.id, user.id));
    await revokeAllSessions(ctx, user.id, me.sessionId);
    await audit(ctx, req, 'auth.mfa_enabled', { entityType: 'user', entityId: user.id });
    res.status(204).end();
  });

  router.post('/mfa/disable', limiters.auth, auth, async (req, res) => {
    const me = authOf(req);
    const body = parseBody(mfaDisableSchema, req);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, me.userId)).limit(1);
    if (!user?.mfaEnabled || !user.mfaSecretEnc) throw badRequest('Two-factor authentication is not enabled');
    const passwordOk = await verifyPassword(user.passwordHash, body.password);
    const step = verifyTotp(decryptSecret(user.mfaSecretEnc, ctx.config.auth.encryptionKey), body.code, user.mfaLastStep);
    if (!passwordOk || step === null) {
      await registerFailedAttempt(ctx, user.id);
      throw badRequest('Password or verification code is incorrect');
    }
    await ctx.db
      .update(users)
      .set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastStep: null })
      .where(eq(users.id, user.id));
    await audit(ctx, req, 'auth.mfa_disabled', { entityType: 'user', entityId: user.id });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- sessions
  router.get('/sessions', auth, async (req, res) => {
    const me = authOf(req);
    const rows = await ctx.db
      .select({
        id: sessions.id,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, me.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt))
      .limit(50);
    res.json({ items: rows.map((s) => ({ ...s, current: s.id === me.sessionId })) });
  });

  router.delete('/sessions/:sessionId', auth, async (req, res) => {
    const me = authOf(req);
    const sessionId = uuidParam(req, 'sessionId', 'Session');
    const [row] = await ctx.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, me.userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!row) throw notFound('Session');
    await audit(ctx, req, 'auth.session_revoked', { entityType: 'session', entityId: sessionId });
    res.status(204).end();
  });

  router.post('/sessions/revoke-others', auth, async (req, res) => {
    const me = authOf(req);
    await revokeAllSessions(ctx, me.userId, me.sessionId);
    await audit(ctx, req, 'auth.sessions_revoked', { entityType: 'user', entityId: me.userId });
    res.status(204).end();
  });

  return router;
}
