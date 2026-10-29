import { createDefectSchema, defectQuery, escapeLike, updateDefectSchema } from '@ibutest/shared';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { defects, testCases, testRuns, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { pageResult, parseBody, parseQuery, uuidParam } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';
import { KEY_PREFIX, assertMember, displayKey, nextSeq, parseKeySearch } from '../common.js';

type DefectRow = typeof defects.$inferSelect;
export const defectDto = (d: DefectRow) => ({ ...d, key: displayKey(KEY_PREFIX.defect, d.seq) });

const assignee = alias(users, 'assignee');
const reporter = alias(users, 'reporter');

export function defectsRouter(ctx: AppContext) {
  const router = Router({ mergeParams: true });

  async function load(projectId: string, id: string) {
    const [row] = await ctx.db.select().from(defects).where(and(eq(defects.id, id), eq(defects.projectId, projectId))).limit(1);
    if (!row) throw notFound('Defect');
    return row;
  }

  router.get('/', async (req, res) => {
    const p = projectOf(req);
    const q = parseQuery(defectQuery, req);
    const conditions: SQL[] = [eq(defects.projectId, p.id)];
    if (q.status) conditions.push(eq(defects.status, q.status));
    if (q.severity) conditions.push(eq(defects.severity, q.severity));
    if (q.assigneeId) conditions.push(eq(defects.assigneeId, q.assigneeId));
    if (q.search) {
      const seq = parseKeySearch(q.search, KEY_PREFIX.defect);
      const like = ilike(defects.title, `%${escapeLike(q.search)}%`);
      conditions.push(seq !== null ? (or(like, eq(defects.seq, seq)) as SQL) : like);
    }
    const where = and(...conditions);
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select({ defect: defects, assigneeName: assignee.name, reporterName: reporter.name })
        .from(defects)
        .leftJoin(assignee, eq(assignee.id, defects.assigneeId))
        .leftJoin(reporter, eq(reporter.id, defects.reporterId))
        .where(where)
        .orderBy(desc(defects.seq))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      ctx.db.select({ n: count() }).from(defects).where(where),
    ]);
    res.json(
      pageResult(
        rows.map((r) => ({ ...defectDto(r.defect), assigneeName: r.assigneeName, reporterName: r.reporterName })),
        total?.n ?? 0,
        q.page,
        q.pageSize,
      ),
    );
  });

  router.post('/', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const body = parseBody(createDefectSchema, req);
    await assertMember(ctx.db, p.id, body.assigneeId);
    let testCaseId = body.testCaseId;
    if (body.testRunId) {
      const [run] = await ctx.db
        .select({ testCaseId: testRuns.testCaseId })
        .from(testRuns)
        .where(and(eq(testRuns.id, body.testRunId), eq(testRuns.projectId, p.id)))
        .limit(1);
      if (!run) throw badRequest('Test run does not exist in this project');
      testCaseId ??= run.testCaseId;
    }
    if (testCaseId) {
      const [tc] = await ctx.db
        .select({ id: testCases.id })
        .from(testCases)
        .where(and(eq(testCases.id, testCaseId), eq(testCases.projectId, p.id)))
        .limit(1);
      if (!tc) throw badRequest('Test case does not exist in this project');
    }
    const row = await ctx.db.transaction(async (tx) => {
      const seq = await nextSeq(tx, p.id, 'defectSeq');
      const [created] = await tx
        .insert(defects)
        .values({ ...body, testCaseId, projectId: p.id, seq, reporterId: me.userId })
        .returning();
      return created!;
    });
    await audit(ctx, req, 'defect.created', { entityType: 'defect', entityId: row.id });
    res.status(201).json({ defect: defectDto(row) });
  });

  router.get('/:defectId', async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'defectId', 'Defect');
    const [row] = await ctx.db
      .select({ defect: defects, assigneeName: assignee.name, reporterName: reporter.name, testCaseSeq: testCases.seq, testCaseTitle: testCases.title })
      .from(defects)
      .leftJoin(assignee, eq(assignee.id, defects.assigneeId))
      .leftJoin(reporter, eq(reporter.id, defects.reporterId))
      .leftJoin(testCases, eq(testCases.id, defects.testCaseId))
      .where(and(eq(defects.id, id), eq(defects.projectId, p.id)))
      .limit(1);
    if (!row) throw notFound('Defect');
    res.json({
      defect: {
        ...defectDto(row.defect),
        assigneeName: row.assigneeName,
        reporterName: row.reporterName,
        testCaseKey: row.testCaseSeq ? displayKey(KEY_PREFIX.testCase, row.testCaseSeq) : null,
        testCaseTitle: row.testCaseTitle,
      },
    });
  });

  router.patch('/:defectId', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'defectId', 'Defect');
    const current = await load(p.id, id);
    const body = parseBody(updateDefectSchema, req);
    if (body.assigneeId !== undefined) await assertMember(ctx.db, p.id, body.assigneeId);
    const closing = body.status && ['resolved', 'closed'].includes(body.status) && !['resolved', 'closed'].includes(current.status);
    const reopening = body.status && !['resolved', 'closed'].includes(body.status);
    const [row] = await ctx.db
      .update(defects)
      .set({ ...body, ...(closing ? { resolvedAt: new Date() } : reopening ? { resolvedAt: null } : {}) })
      .where(eq(defects.id, id))
      .returning();
    await audit(ctx, req, 'defect.updated', {
      entityType: 'defect',
      entityId: id,
      details: body.status && body.status !== current.status ? { status: { from: current.status, to: body.status } } : {},
    });
    res.json({ defect: defectDto(row!) });
  });

  router.delete('/:defectId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'defectId', 'Defect');
    const row = await load(p.id, id);
    await ctx.db.delete(defects).where(eq(defects.id, id));
    await audit(ctx, req, 'defect.deleted', { entityType: 'defect', entityId: id, details: { title: row.title } });
    res.status(204).end();
  });

  return router;
}
