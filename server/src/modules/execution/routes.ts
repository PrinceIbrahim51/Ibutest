import {
  addRunsSchema,
  createCycleSchema,
  createReleaseSchema,
  cycleQuery,
  executeRunSchema,
  updateCycleSchema,
  updateReleaseSchema,
  updateRunSchema,
} from '@ibutest/shared';
import { and, count, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import type { Executor } from '../../db/index.js';
import { defects, folders, releases, testCases, testCycles, testLogs, testRuns, users, type StepResult } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parseBody, parseQuery, uuidParam } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';
import { KEY_PREFIX, assertMember, assertTestCasesInProject, displayKey } from '../common.js';
import { loadSteps } from '../testcases/routes.js';

export type RunCounts = Record<'total' | 'not_run' | 'in_progress' | 'passed' | 'failed' | 'blocked' | 'skipped', number>;

const emptyCounts = (): RunCounts => ({ total: 0, not_run: 0, in_progress: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 });

/** Run status breakdown per cycle. */
export async function runCountsByCycle(db: Executor, projectId: string, cycleIds?: string[]) {
  const conditions: SQL[] = [eq(testRuns.projectId, projectId)];
  if (cycleIds) {
    if (cycleIds.length === 0) return new Map<string, RunCounts>();
    conditions.push(inArray(testRuns.cycleId, cycleIds));
  }
  const rows = await db
    .select({ cycleId: testRuns.cycleId, status: testRuns.status, n: count() })
    .from(testRuns)
    .where(and(...conditions))
    .groupBy(testRuns.cycleId, testRuns.status);
  const map = new Map<string, RunCounts>();
  for (const r of rows) {
    const c = map.get(r.cycleId) ?? emptyCounts();
    c[r.status] += r.n;
    c.total += r.n;
    map.set(r.cycleId, c);
  }
  return map;
}

export function executionRouter(ctx: AppContext) {
  const router = Router({ mergeParams: true });

  async function loadRelease(projectId: string, id: string) {
    const [row] = await ctx.db.select().from(releases).where(and(eq(releases.id, id), eq(releases.projectId, projectId))).limit(1);
    if (!row) throw notFound('Release');
    return row;
  }

  async function loadCycle(projectId: string, id: string) {
    const [row] = await ctx.db.select().from(testCycles).where(and(eq(testCycles.id, id), eq(testCycles.projectId, projectId))).limit(1);
    if (!row) throw notFound('Test cycle');
    return row;
  }

  async function loadRun(projectId: string, id: string) {
    const [row] = await ctx.db.select().from(testRuns).where(and(eq(testRuns.id, id), eq(testRuns.projectId, projectId))).limit(1);
    if (!row) throw notFound('Test run');
    return row;
  }

  // ---------------------------------------------------------------- releases
  router.get('/releases', async (req, res) => {
    const p = projectOf(req);
    const cycleCount = ctx.db
      .select({ releaseId: testCycles.releaseId, n: count().as('n') })
      .from(testCycles)
      .where(eq(testCycles.projectId, p.id))
      .groupBy(testCycles.releaseId)
      .as('cc');
    const rows = await ctx.db
      .select({ release: releases, cycles: cycleCount.n })
      .from(releases)
      .leftJoin(cycleCount, eq(cycleCount.releaseId, releases.id))
      .where(eq(releases.projectId, p.id))
      .orderBy(desc(releases.createdAt));
    res.json({ items: rows.map((r) => ({ ...r.release, cycleCount: Number(r.cycles ?? 0) })) });
  });

  router.post('/releases', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(createReleaseSchema, req);
    const [row] = await ctx.db.insert(releases).values({ ...body, projectId: p.id }).returning();
    await audit(ctx, req, 'release.created', { entityType: 'release', entityId: row?.id });
    res.status(201).json({ release: row });
  });

  router.get('/releases/:releaseId', async (req, res) => {
    const p = projectOf(req);
    res.json({ release: await loadRelease(p.id, uuidParam(req, 'releaseId', 'Release')) });
  });

  router.patch('/releases/:releaseId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'releaseId', 'Release');
    const current = await loadRelease(p.id, id);
    const body = parseBody(updateReleaseSchema, req);
    const start = body.startDate !== undefined ? body.startDate : current.startDate;
    const end = body.endDate !== undefined ? body.endDate : current.endDate;
    if (start && end && start > end) throw badRequest('End date must be after start date');
    const [row] = await ctx.db.update(releases).set(body).where(eq(releases.id, id)).returning();
    await audit(ctx, req, 'release.updated', { entityType: 'release', entityId: id });
    res.json({ release: row });
  });

  router.delete('/releases/:releaseId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'releaseId', 'Release');
    await loadRelease(p.id, id);
    await ctx.db.delete(releases).where(eq(releases.id, id));
    await audit(ctx, req, 'release.deleted', { entityType: 'release', entityId: id });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- cycles
  router.get('/cycles', async (req, res) => {
    const p = projectOf(req);
    const q = parseQuery(cycleQuery, req);
    const rows = await ctx.db
      .select({ cycle: testCycles, releaseName: releases.name })
      .from(testCycles)
      .leftJoin(releases, eq(releases.id, testCycles.releaseId))
      .where(and(eq(testCycles.projectId, p.id), q.releaseId ? eq(testCycles.releaseId, q.releaseId) : undefined))
      .orderBy(desc(testCycles.createdAt));
    const counts = await runCountsByCycle(ctx.db, p.id, rows.map((r) => r.cycle.id));
    res.json({
      items: rows.map((r) => ({ ...r.cycle, releaseName: r.releaseName, counts: counts.get(r.cycle.id) ?? emptyCounts() })),
    });
  });

  router.post('/cycles', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const body = parseBody(createCycleSchema, req);
    if (body.releaseId) await loadRelease(p.id, body.releaseId);
    const [row] = await ctx.db.insert(testCycles).values({ ...body, projectId: p.id, createdBy: me.userId }).returning();
    await audit(ctx, req, 'cycle.created', { entityType: 'cycle', entityId: row?.id });
    res.status(201).json({ cycle: row });
  });

  router.get('/cycles/:cycleId', async (req, res) => {
    const p = projectOf(req);
    const cycle = await loadCycle(p.id, uuidParam(req, 'cycleId', 'Test cycle'));
    const counts = await runCountsByCycle(ctx.db, p.id, [cycle.id]);
    const release = cycle.releaseId ? await loadRelease(p.id, cycle.releaseId) : null;
    res.json({ cycle: { ...cycle, releaseName: release?.name ?? null, counts: counts.get(cycle.id) ?? emptyCounts() } });
  });

  router.patch('/cycles/:cycleId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'cycleId', 'Test cycle');
    const current = await loadCycle(p.id, id);
    const body = parseBody(updateCycleSchema, req);
    if (body.releaseId) await loadRelease(p.id, body.releaseId);
    const start = body.startDate !== undefined ? body.startDate : current.startDate;
    const end = body.endDate !== undefined ? body.endDate : current.endDate;
    if (start && end && start > end) throw badRequest('End date must be after start date');
    const [row] = await ctx.db.update(testCycles).set(body).where(eq(testCycles.id, id)).returning();
    await audit(ctx, req, 'cycle.updated', { entityType: 'cycle', entityId: id });
    res.json({ cycle: row });
  });

  router.delete('/cycles/:cycleId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'cycleId', 'Test cycle');
    await loadCycle(p.id, id);
    await ctx.db.delete(testCycles).where(eq(testCycles.id, id));
    await audit(ctx, req, 'cycle.deleted', { entityType: 'cycle', entityId: id });
    res.status(204).end();
  });

  // ---------------------------------------------------------------- runs
  router.get('/cycles/:cycleId/runs', async (req, res) => {
    const p = projectOf(req);
    const cycle = await loadCycle(p.id, uuidParam(req, 'cycleId', 'Test cycle'));
    const rows = await ctx.db
      .select({
        run: testRuns,
        testCaseSeq: testCases.seq,
        testCaseTitle: testCases.title,
        priority: testCases.priority,
        isAutomated: testCases.isAutomated,
        currentVersion: testCases.version,
        assigneeName: users.name,
      })
      .from(testRuns)
      .innerJoin(testCases, eq(testCases.id, testRuns.testCaseId))
      .leftJoin(users, eq(users.id, testRuns.assigneeId))
      .where(eq(testRuns.cycleId, cycle.id))
      .orderBy(testCases.seq);
    res.json({
      items: rows.map((r) => ({
        ...r.run,
        testCaseKey: displayKey(KEY_PREFIX.testCase, r.testCaseSeq),
        testCaseTitle: r.testCaseTitle,
        priority: r.priority,
        isAutomated: r.isAutomated,
        outdated: r.currentVersion !== r.run.testCaseVersion,
        assigneeName: r.assigneeName,
      })),
    });
  });

  router.post('/cycles/:cycleId/runs', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const cycle = await loadCycle(p.id, uuidParam(req, 'cycleId', 'Test cycle'));
    if (cycle.status === 'closed') throw conflict('This test cycle is closed');
    const body = parseBody(addRunsSchema, req);
    await assertMember(ctx.db, p.id, body.assigneeId);

    let ids: string[] = [];
    if (body.testCaseIds?.length) ids = await assertTestCasesInProject(ctx.db, p.id, body.testCaseIds);
    if (body.folderId) {
      const all = await ctx.db
        .select({ id: folders.id, parentId: folders.parentId })
        .from(folders)
        .where(and(eq(folders.projectId, p.id), eq(folders.kind, 'test_case')));
      if (!all.some((f) => f.id === body.folderId)) throw badRequest('Folder does not exist in this project');
      const tree = new Set([body.folderId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of all) {
          if (f.parentId && tree.has(f.parentId) && !tree.has(f.id)) {
            tree.add(f.id);
            grew = true;
          }
        }
      }
      const inFolder = await ctx.db
        .select({ id: testCases.id })
        .from(testCases)
        .where(and(eq(testCases.projectId, p.id), inArray(testCases.folderId, [...tree]), ne(testCases.status, 'deprecated')));
      ids = [...new Set([...ids, ...inFolder.map((t) => t.id)])];
    }
    if (ids.length === 0) throw badRequest('No test cases to add');
    if (ids.length > 2000) throw badRequest('Too many test cases in one request');

    const cases = await ctx.db
      .select({ id: testCases.id, version: testCases.version })
      .from(testCases)
      .where(and(eq(testCases.projectId, p.id), inArray(testCases.id, ids)));
    const inserted = await ctx.db
      .insert(testRuns)
      .values(
        cases.map((c) => ({
          projectId: p.id,
          cycleId: cycle.id,
          testCaseId: c.id,
          testCaseVersion: c.version,
          assigneeId: body.assigneeId ?? null,
        })),
      )
      .onConflictDoNothing({ target: [testRuns.cycleId, testRuns.testCaseId] })
      .returning({ id: testRuns.id });
    await audit(ctx, req, 'cycle.runs_added', { entityType: 'cycle', entityId: cycle.id, details: { added: inserted.length } });
    res.status(201).json({ added: inserted.length, skipped: cases.length - inserted.length });
  });

  router.get('/runs/:runId', async (req, res) => {
    const p = projectOf(req);
    const run = await loadRun(p.id, uuidParam(req, 'runId', 'Test run'));
    const [[testCase], steps, logs, runDefects, cycle] = await Promise.all([
      ctx.db.select().from(testCases).where(eq(testCases.id, run.testCaseId)).limit(1),
      loadSteps(ctx.db, run.testCaseId),
      ctx.db
        .select({ log: testLogs, executedByName: users.name })
        .from(testLogs)
        .leftJoin(users, eq(users.id, testLogs.executedBy))
        .where(eq(testLogs.testRunId, run.id))
        .orderBy(desc(testLogs.executedAt))
        .limit(50),
      ctx.db
        .select({ id: defects.id, seq: defects.seq, title: defects.title, status: defects.status, severity: defects.severity })
        .from(defects)
        .where(and(eq(defects.projectId, p.id), eq(defects.testRunId, run.id))),
      loadCycle(p.id, run.cycleId),
    ]);
    if (!testCase) throw notFound('Test case');
    res.json({
      run,
      cycle: { id: cycle.id, name: cycle.name, status: cycle.status },
      testCase: { ...testCase, key: displayKey(KEY_PREFIX.testCase, testCase.seq) },
      steps,
      logs: logs.map((l) => ({ ...l.log, executedByName: l.executedByName })),
      defects: runDefects.map((d) => ({ ...d, key: displayKey(KEY_PREFIX.defect, d.seq) })),
    });
  });

  router.patch('/runs/:runId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'runId', 'Test run');
    await loadRun(p.id, id);
    const body = parseBody(updateRunSchema, req);
    await assertMember(ctx.db, p.id, body.assigneeId);
    const [row] = await ctx.db.update(testRuns).set({ assigneeId: body.assigneeId }).where(eq(testRuns.id, id)).returning();
    res.json({ run: row });
  });

  router.delete('/runs/:runId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'runId', 'Test run');
    await loadRun(p.id, id);
    await ctx.db.delete(testRuns).where(eq(testRuns.id, id));
    await audit(ctx, req, 'run.deleted', { entityType: 'run', entityId: id });
    res.status(204).end();
  });

  router.post('/runs/:runId/execute', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const run = await loadRun(p.id, uuidParam(req, 'runId', 'Test run'));
    const cycle = await loadCycle(p.id, run.cycleId);
    if (cycle.status === 'closed') throw conflict('This test cycle is closed');
    const body = parseBody(executeRunSchema, req);
    const steps = await loadSteps(ctx.db, run.testCaseId);
    const provided = new Map(body.stepResults.map((s) => [s.position, s]));
    for (const position of provided.keys()) {
      if (position >= steps.length) throw badRequest(`Step ${position + 1} does not exist`);
    }
    const stepResults: StepResult[] = steps.map((s) => ({
      position: s.position,
      action: s.action,
      expected: s.expected,
      status: provided.get(s.position)?.status ?? 'not_run',
      actual: provided.get(s.position)?.actual ?? '',
    }));
    const now = new Date();
    const updated = await ctx.db.transaction(async (tx) => {
      await tx.insert(testLogs).values({
        testRunId: run.id,
        status: body.status,
        executedBy: me.userId,
        executedAt: now,
        durationSeconds: body.durationSeconds,
        comment: body.comment,
        stepResults,
        source: 'manual',
      });
      const [row] = await tx
        .update(testRuns)
        .set({ status: body.status, executedBy: me.userId, executedAt: now, durationSeconds: body.durationSeconds, comment: body.comment })
        .where(eq(testRuns.id, run.id))
        .returning();
      if (cycle.status === 'planned') await tx.update(testCycles).set({ status: 'active' }).where(eq(testCycles.id, cycle.id));
      return row;
    });
    await audit(ctx, req, 'run.executed', { entityType: 'run', entityId: run.id, details: { status: body.status } });
    res.json({ run: updated });
  });

  return router;
}
