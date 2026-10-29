import { createRequirementSchema, escapeLike, linkTestCasesSchema, requirementQuery, updateRequirementSchema } from '@ibutest/shared';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { requirementLinks, requirements, testCases, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { pageResult, parseBody, parseQuery, uuidParam } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';
import { KEY_PREFIX, assertFolder, assertTestCasesInProject, displayKey, nextSeq, parseKeySearch } from '../common.js';

type RequirementRow = typeof requirements.$inferSelect;
export const requirementDto = (r: RequirementRow) => ({ ...r, key: displayKey(KEY_PREFIX.requirement, r.seq) });

export function requirementsRouter(ctx: AppContext) {
  const router = Router({ mergeParams: true });

  async function load(projectId: string, id: string) {
    const [row] = await ctx.db
      .select()
      .from(requirements)
      .where(and(eq(requirements.id, id), eq(requirements.projectId, projectId)))
      .limit(1);
    if (!row) throw notFound('Requirement');
    return row;
  }

  router.get('/', async (req, res) => {
    const p = projectOf(req);
    const q = parseQuery(requirementQuery, req);
    const conditions: SQL[] = [eq(requirements.projectId, p.id)];
    if (q.folderId) conditions.push(eq(requirements.folderId, q.folderId));
    if (q.status) conditions.push(eq(requirements.status, q.status));
    if (q.search) {
      const seq = parseKeySearch(q.search, KEY_PREFIX.requirement);
      const like = ilike(requirements.title, `%${escapeLike(q.search)}%`);
      conditions.push(seq !== null ? (or(like, eq(requirements.seq, seq)) as SQL) : like);
    }
    const where = and(...conditions);
    const linkCount = sql<number>`(select count(*)::int from ${requirementLinks} where ${requirementLinks.requirementId} = ${requirements.id})`;
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select({ requirement: requirements, linkedTestCases: linkCount })
        .from(requirements)
        .where(where)
        .orderBy(desc(requirements.seq))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      ctx.db.select({ n: count() }).from(requirements).where(where),
    ]);
    res.json(
      pageResult(
        rows.map((r) => ({ ...requirementDto(r.requirement), linkedTestCases: r.linkedTestCases })),
        total?.n ?? 0,
        q.page,
        q.pageSize,
      ),
    );
  });

  router.post('/', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const body = parseBody(createRequirementSchema, req);
    await assertFolder(ctx.db, p.id, body.folderId, 'requirement');
    const row = await ctx.db.transaction(async (tx) => {
      const seq = await nextSeq(tx, p.id, 'requirementSeq');
      const [created] = await tx
        .insert(requirements)
        .values({ ...body, projectId: p.id, seq, createdBy: me.userId, updatedBy: me.userId })
        .returning();
      return created!;
    });
    await audit(ctx, req, 'requirement.created', { entityType: 'requirement', entityId: row.id });
    res.status(201).json({ requirement: requirementDto(row) });
  });

  router.get('/:requirementId', async (req, res) => {
    const p = projectOf(req);
    const row = await load(p.id, uuidParam(req, 'requirementId', 'Requirement'));
    const linked = await ctx.db
      .select({ id: testCases.id, seq: testCases.seq, title: testCases.title, status: testCases.status, priority: testCases.priority })
      .from(requirementLinks)
      .innerJoin(testCases, eq(testCases.id, requirementLinks.testCaseId))
      .where(eq(requirementLinks.requirementId, row.id))
      .orderBy(testCases.seq);
    const [author] = row.createdBy
      ? await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, row.createdBy)).limit(1)
      : [];
    res.json({
      requirement: { ...requirementDto(row), createdByName: author?.name ?? null },
      testCases: linked.map((t) => ({ ...t, key: displayKey(KEY_PREFIX.testCase, t.seq) })),
    });
  });

  router.patch('/:requirementId', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const id = uuidParam(req, 'requirementId', 'Requirement');
    await load(p.id, id);
    const body = parseBody(updateRequirementSchema, req);
    if (body.folderId !== undefined) await assertFolder(ctx.db, p.id, body.folderId, 'requirement');
    const [row] = await ctx.db
      .update(requirements)
      .set({ ...body, updatedBy: me.userId })
      .where(and(eq(requirements.id, id), eq(requirements.projectId, p.id)))
      .returning();
    await audit(ctx, req, 'requirement.updated', { entityType: 'requirement', entityId: id });
    res.json({ requirement: requirementDto(row!) });
  });

  router.delete('/:requirementId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'requirementId', 'Requirement');
    const row = await load(p.id, id);
    await ctx.db.delete(requirements).where(and(eq(requirements.id, id), eq(requirements.projectId, p.id)));
    await audit(ctx, req, 'requirement.deleted', { entityType: 'requirement', entityId: id, details: { title: row.title } });
    res.status(204).end();
  });

  router.post('/:requirementId/links', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'requirementId', 'Requirement');
    await load(p.id, id);
    const body = parseBody(linkTestCasesSchema, req);
    const ids = await assertTestCasesInProject(ctx.db, p.id, body.testCaseIds);
    await ctx.db
      .insert(requirementLinks)
      .values(ids.map((testCaseId) => ({ requirementId: id, testCaseId })))
      .onConflictDoNothing();
    await audit(ctx, req, 'requirement.linked', { entityType: 'requirement', entityId: id, details: { testCaseIds: ids } });
    res.status(204).end();
  });

  router.delete('/:requirementId/links/:testCaseId', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'requirementId', 'Requirement');
    const testCaseId = uuidParam(req, 'testCaseId', 'Test case');
    await load(p.id, id);
    await ctx.db
      .delete(requirementLinks)
      .where(and(eq(requirementLinks.requirementId, id), eq(requirementLinks.testCaseId, testCaseId)));
    res.status(204).end();
  });

  return router;
}
