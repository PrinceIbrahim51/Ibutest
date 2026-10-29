import { createApiTokenSchema, createProjectSchema, updateProjectSchema, upsertMemberSchema } from '@ibutest/shared';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { apiTokens, projectMembers, projects, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { parseBody, uuidParam } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { denyWritesWhenArchived, loadProject, projectOf, requireProjectRole } from '../../middleware/project.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import { aiRouter } from '../ai/routes.js';
import { attachmentsRouter } from '../attachments/routes.js';
import { defectsRouter } from '../defects/routes.js';
import { executionRouter } from '../execution/routes.js';
import { foldersRouter } from '../folders/routes.js';
import { reportsRouter } from '../reports/routes.js';
import { requirementsRouter } from '../requirements/routes.js';
import { testCasesRouter } from '../testcases/routes.js';

export function projectsRouter(ctx: AppContext, limiters: RateLimiters) {
  const router = Router();

  router.get('/', async (req, res) => {
    const me = authOf(req);
    const base = ctx.db
      .select({
        id: projects.id,
        key: projects.key,
        name: projects.name,
        description: projects.description,
        isArchived: projects.isArchived,
        aiEnabled: projects.aiEnabled,
        createdAt: projects.createdAt,
        role: projectMembers.role,
      })
      .from(projects);
    const rows =
      me.role === 'admin'
        ? await base
            .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, me.userId)))
            .orderBy(projects.name)
        : await base
            .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, me.userId)))
            .orderBy(projects.name);
    res.json({ items: rows.map((r) => ({ ...r, role: me.role === 'admin' ? 'manager' : r.role })) });
  });

  router.post('/', async (req, res) => {
    const me = authOf(req);
    if (me.role !== 'admin') throw forbidden('Only administrators can create projects');
    const body = parseBody(createProjectSchema, req);
    const project = await ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({ ...body, createdBy: me.userId })
        .onConflictDoNothing({ target: projects.key })
        .returning();
      if (!created) return null;
      await tx.insert(projectMembers).values({ projectId: created.id, userId: me.userId, role: 'manager' });
      return created;
    });
    if (!project) throw conflict(`Project key "${body.key}" is already in use`);
    await audit(ctx, req, 'project.created', { entityType: 'project', entityId: project.id, projectId: project.id });
    res.status(201).json({ project: { ...project, role: 'manager' } });
  });

  // ------------------------------------------------------------------ project scoped
  const scoped = Router({ mergeParams: true });
  router.use('/:projectId', loadProject(ctx), scoped);

  scoped.get('/', async (req, res) => {
    const p = projectOf(req);
    const [project] = await ctx.db.select().from(projects).where(eq(projects.id, p.id)).limit(1);
    if (!project) throw notFound('Project');
    const { requirementSeq: _r, testCaseSeq: _t, defectSeq: _d, ...rest } = project;
    res.json({ project: { ...rest, role: p.role } });
  });

  scoped.patch('/', requireProjectRole('manager'), async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(updateProjectSchema, req);
    const [project] = await ctx.db.update(projects).set(body).where(eq(projects.id, p.id)).returning();
    if (!project) throw notFound('Project');
    await audit(ctx, req, 'project.updated', { entityType: 'project', entityId: p.id, details: body });
    const { requirementSeq: _r, testCaseSeq: _t, defectSeq: _d, ...rest } = project;
    res.json({ project: { ...rest, role: p.role } });
  });

  scoped.delete('/', async (req, res) => {
    const me = authOf(req);
    const p = projectOf(req);
    if (me.role !== 'admin') throw forbidden('Only administrators can delete projects');
    await ctx.db.delete(projects).where(eq(projects.id, p.id));
    await audit(ctx, req, 'project.deleted', { entityType: 'project', entityId: p.id, details: { key: p.key, name: p.name } });
    res.status(204).end();
  });

  // ------------------------------------------------------------------ members
  scoped.get('/members', async (req, res) => {
    const p = projectOf(req);
    const rows = await ctx.db
      .select({ userId: users.id, name: users.name, email: users.email, role: projectMembers.role, isActive: users.isActive, addedAt: projectMembers.createdAt })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, p.id))
      .orderBy(users.name);
    res.json({ items: rows });
  });

  async function managerCount(projectId: string) {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'manager')));
    return row?.n ?? 0;
  }

  scoped.put('/members', requireProjectRole('manager'), async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(upsertMemberSchema, req);
    const [user] = await ctx.db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, body.userId)).limit(1);
    if (!user || !user.isActive) throw badRequest('User does not exist or is inactive');
    const [existing] = await ctx.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, body.userId)))
      .limit(1);
    if (existing?.role === 'manager' && body.role !== 'manager' && (await managerCount(p.id)) <= 1) {
      throw badRequest('A project must keep at least one manager');
    }
    await ctx.db
      .insert(projectMembers)
      .values({ projectId: p.id, userId: body.userId, role: body.role })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: body.role } });
    await audit(ctx, req, existing ? 'project.member_role_changed' : 'project.member_added', {
      entityType: 'user',
      entityId: body.userId,
      details: { role: body.role, previousRole: existing?.role ?? null },
    });
    res.status(204).end();
  });

  scoped.delete('/members/:userId', requireProjectRole('manager'), async (req, res) => {
    const p = projectOf(req);
    const userId = uuidParam(req, 'userId', 'Member');
    const [existing] = await ctx.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!existing) throw notFound('Member');
    if (existing.role === 'manager' && (await managerCount(p.id)) <= 1) throw badRequest('A project must keep at least one manager');
    await ctx.db.delete(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId)));
    // Tokens issued for this project by the removed member stop working immediately.
    await ctx.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.projectId, p.id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
    await audit(ctx, req, 'project.member_removed', { entityType: 'user', entityId: userId });
    res.status(204).end();
  });

  // ------------------------------------------------------------------ automation API tokens
  scoped.get('/api-tokens', requireProjectRole('tester'), async (req, res) => {
    const me = authOf(req);
    const p = projectOf(req);
    const rows = await ctx.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
        ownerId: users.id,
        ownerName: users.name,
      })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(and(eq(apiTokens.projectId, p.id), p.role === 'manager' ? undefined : eq(apiTokens.userId, me.userId)))
      .orderBy(desc(apiTokens.createdAt));
    res.json({ items: rows });
  });

  scoped.post('/api-tokens', requireProjectRole('tester'), async (req, res) => {
    const me = authOf(req);
    const p = projectOf(req);
    const body = parseBody(createApiTokenSchema, req);
    const secret = randomToken(32);
    const token = `ibt_${secret}`;
    const [row] = await ctx.db
      .insert(apiTokens)
      .values({
        userId: me.userId,
        projectId: p.id,
        name: body.name,
        tokenPrefix: `ibt_${secret.slice(0, 6)}`,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + body.expiresInDays * 24 * 3600 * 1000),
      })
      .returning({ id: apiTokens.id, name: apiTokens.name, tokenPrefix: apiTokens.tokenPrefix, expiresAt: apiTokens.expiresAt });
    await audit(ctx, req, 'project.api_token_created', { entityType: 'api_token', entityId: row?.id, details: { name: body.name } });
    // The plaintext token is returned once and never stored.
    res.status(201).json({ token, apiToken: row });
  });

  scoped.delete('/api-tokens/:tokenId', requireProjectRole('tester'), async (req, res) => {
    const me = authOf(req);
    const p = projectOf(req);
    const tokenId = uuidParam(req, 'tokenId', 'API token');
    const [row] = await ctx.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.projectId, p.id),
          isNull(apiTokens.revokedAt),
          p.role === 'manager' ? undefined : eq(apiTokens.userId, me.userId),
        ),
      )
      .returning({ id: apiTokens.id });
    if (!row) throw notFound('API token');
    await audit(ctx, req, 'project.api_token_revoked', { entityType: 'api_token', entityId: tokenId });
    res.status(204).end();
  });

  // ------------------------------------------------------------------ domain modules
  // Registered after the settings routes above, so it only guards domain data (archived = read-only).
  scoped.use(denyWritesWhenArchived);
  scoped.use('/folders', foldersRouter(ctx));
  scoped.use('/requirements', requirementsRouter(ctx));
  scoped.use('/test-cases', testCasesRouter(ctx));
  scoped.use('/', executionRouter(ctx));
  scoped.use('/defects', defectsRouter(ctx));
  scoped.use('/reports', reportsRouter(ctx));
  scoped.use('/attachments', attachmentsRouter(ctx, limiters));
  scoped.use('/ai', aiRouter(ctx, limiters));

  return router;
}
