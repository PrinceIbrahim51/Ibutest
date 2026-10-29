import { randomBytes } from 'node:crypto';
import { auditQuery, createUserSchema, escapeLike, paginationQuery, updateUserSchema } from '@ibutest/shared';
import { and, count, desc, eq, ilike, isNull, ne, or, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { APP_VERSION } from '../../version.js';
import type { AppContext } from '../../context.js';
import { auditLogs, projects, sessions, testCases, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { pageResult, parseBody, parseQuery, uuidParam } from '../../lib/http.js';
import { hashPassword } from '../../lib/password.js';
import { authOf, requireAdmin } from '../../middleware/auth.js';
import { publicUser, revokeAllSessions } from '../auth/service.js';

/** Generates a readable temporary password that satisfies the password policy. */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

export function adminRouter(ctx: AppContext) {
  const router = Router();
  router.use(requireAdmin(ctx));

  async function getUser(id: string) {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw notFound('User');
    return user;
  }

  async function activeAdminCount(excludingId?: string) {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true), excludingId ? ne(users.id, excludingId) : undefined));
    return row?.n ?? 0;
  }

  router.get('/system', async (_req, res) => {
    const [[u], [p], [t]] = await Promise.all([
      ctx.db.select({ n: count() }).from(users),
      ctx.db.select({ n: count() }).from(projects),
      ctx.db.select({ n: count() }).from(testCases),
    ]);
    res.json({
      version: APP_VERSION,
      environment: ctx.config.env,
      database: ctx.config.db.driver,
      aiConfigured: !!ctx.ai,
      aiModel: ctx.ai ? ctx.config.ai.model : null,
      registrationEnabled: ctx.config.auth.allowRegistration,
      adminRequireMfa: ctx.config.auth.adminRequireMfa,
      counts: { users: u?.n ?? 0, projects: p?.n ?? 0, testCases: t?.n ?? 0 },
    });
  });

  router.get('/users', async (req, res) => {
    const q = parseQuery(paginationQuery, req);
    const where = q.search
      ? or(ilike(users.email, `%${escapeLike(q.search)}%`), ilike(users.name, `%${escapeLike(q.search)}%`))
      : undefined;
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select()
        .from(users)
        .where(where)
        .orderBy(users.name)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      ctx.db.select({ n: count() }).from(users).where(where),
    ]);
    res.json(
      pageResult(
        rows.map((u) => ({ ...publicUser(u), lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null })),
        total?.n ?? 0,
        q.page,
        q.pageSize,
      ),
    );
  });

  router.post('/users', async (req, res) => {
    const body = parseBody(createUserSchema, req);
    const generated = body.password ? null : temporaryPassword();
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: body.email,
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(body.password ?? (generated as string)),
        mustChangePassword: true,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (!user) throw conflict('A user with this email already exists');
    await audit(ctx, req, 'admin.user_created', { entityType: 'user', entityId: user.id, details: { email: user.email, role: user.role } });
    // The temporary password is shown exactly once to the administrator.
    res.status(201).json({ user: publicUser(user), temporaryPassword: generated });
  });

  router.patch('/users/:userId', async (req, res) => {
    const me = authOf(req);
    const userId = uuidParam(req, 'userId', 'User');
    const body = parseBody(updateUserSchema, req);
    const target = await getUser(userId);
    const demoting = body.role === 'user' && target.role === 'admin';
    const deactivating = body.isActive === false && target.isActive;
    if (userId === me.userId && (demoting || deactivating)) {
      throw badRequest('You cannot remove your own administrator access or deactivate yourself');
    }
    if ((demoting || deactivating) && target.role === 'admin' && (await activeAdminCount(userId)) === 0) {
      throw badRequest('At least one active administrator is required');
    }
    const [user] = await ctx.db.update(users).set(body).where(eq(users.id, userId)).returning();
    if (!user) throw notFound('User');
    if (deactivating || demoting) await revokeAllSessions(ctx, userId);
    await audit(ctx, req, 'admin.user_updated', { entityType: 'user', entityId: userId, details: body });
    res.json({ user: publicUser(user) });
  });

  router.post('/users/:userId/reset-password', async (req, res) => {
    const userId = uuidParam(req, 'userId', 'User');
    await getUser(userId);
    const password = temporaryPassword();
    await ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, userId));
    await revokeAllSessions(ctx, userId);
    await audit(ctx, req, 'admin.password_reset', { entityType: 'user', entityId: userId });
    res.json({ temporaryPassword: password });
  });

  router.post('/users/:userId/unlock', async (req, res) => {
    const userId = uuidParam(req, 'userId', 'User');
    await getUser(userId);
    await ctx.db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    await audit(ctx, req, 'admin.user_unlocked', { entityType: 'user', entityId: userId });
    res.status(204).end();
  });

  router.delete('/users/:userId/mfa', async (req, res) => {
    const userId = uuidParam(req, 'userId', 'User');
    await getUser(userId);
    await ctx.db
      .update(users)
      .set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaLastStep: null })
      .where(eq(users.id, userId));
    await revokeAllSessions(ctx, userId);
    await audit(ctx, req, 'admin.mfa_reset', { entityType: 'user', entityId: userId });
    res.status(204).end();
  });

  router.post('/users/:userId/revoke-sessions', async (req, res) => {
    const userId = uuidParam(req, 'userId', 'User');
    await getUser(userId);
    await revokeAllSessions(ctx, userId);
    await audit(ctx, req, 'admin.sessions_revoked', { entityType: 'user', entityId: userId });
    res.status(204).end();
  });

  router.get('/users/:userId/sessions', async (req, res) => {
    const userId = uuidParam(req, 'userId', 'User');
    const rows = await ctx.db
      .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastUsedAt))
      .limit(50);
    res.json({ items: rows });
  });

  router.get('/audit-logs', async (req, res) => {
    const q = parseQuery(auditQuery, req);
    const conditions: SQL[] = [];
    if (q.action) conditions.push(ilike(auditLogs.action, `${escapeLike(q.action)}%`));
    if (q.actorId) conditions.push(eq(auditLogs.actorId, q.actorId));
    if (q.projectId) conditions.push(eq(auditLogs.projectId, q.projectId));
    if (q.search) conditions.push(ilike(auditLogs.actorEmail, `%${escapeLike(q.search)}%`));
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      ctx.db.select({ n: count() }).from(auditLogs).where(where),
    ]);
    res.json(pageResult(rows, total?.n ?? 0, q.page, q.pageSize));
  });

  return router;
}
