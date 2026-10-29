import { toCsv } from '@ibutest/shared';
import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import { type Response, Router } from 'express';
import type { AppContext } from '../../context.js';
import {
  auditLogs,
  defects,
  requirementLinks,
  requirements,
  testCases,
  testCycles,
  testLogs,
  testRuns,
  testSteps,
  users,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { uuidParam } from '../../lib/http.js';
import { projectOf } from '../../middleware/project.js';
import { KEY_PREFIX, displayKey } from '../common.js';
import { runCountsByCycle } from '../execution/routes.js';

const EXPORT_LIMIT = 10000;
const OPEN_DEFECT = notInArray(defects.status, ['resolved', 'closed']);

function sendCsv(res: Response, filename: string, headers: string[], rows: unknown[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  // UTF-8 BOM so spreadsheet tools detect the encoding.
  res.send(`\uFEFF${toCsv(headers, rows)}`);
}

export function reportsRouter(ctx: AppContext) {
  const router = Router({ mergeParams: true });

  router.get('/dashboard', async (req, res) => {
    const p = projectOf(req);
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const [
      [reqTotal],
      tcByStatus,
      [automated],
      [covered],
      openBySeverity,
      defectsByStatus,
      cycles,
      trend,
      activity,
    ] = await Promise.all([
      ctx.db.select({ n: count() }).from(requirements).where(eq(requirements.projectId, p.id)),
      ctx.db
        .select({ status: testCases.status, n: count() })
        .from(testCases)
        .where(eq(testCases.projectId, p.id))
        .groupBy(testCases.status),
      ctx.db
        .select({ n: count() })
        .from(testCases)
        .where(and(eq(testCases.projectId, p.id), eq(testCases.isAutomated, true))),
      ctx.db
        .select({ n: countDistinct(requirementLinks.requirementId) })
        .from(requirementLinks)
        .innerJoin(requirements, eq(requirements.id, requirementLinks.requirementId))
        .where(eq(requirements.projectId, p.id)),
      ctx.db
        .select({ severity: defects.severity, n: count() })
        .from(defects)
        .where(and(eq(defects.projectId, p.id), OPEN_DEFECT))
        .groupBy(defects.severity),
      ctx.db
        .select({ status: defects.status, n: count() })
        .from(defects)
        .where(eq(defects.projectId, p.id))
        .groupBy(defects.status),
      ctx.db
        .select({ id: testCycles.id, name: testCycles.name, status: testCycles.status, endDate: testCycles.endDate })
        .from(testCycles)
        .where(and(eq(testCycles.projectId, p.id), or(eq(testCycles.status, 'active'), eq(testCycles.status, 'planned'))))
        .orderBy(desc(testCycles.createdAt))
        .limit(6),
      ctx.db
        .select({ day: sql<string>`to_char(date_trunc('day', ${testLogs.executedAt}), 'YYYY-MM-DD')`, status: testLogs.status, n: count() })
        .from(testLogs)
        .innerJoin(testRuns, eq(testRuns.id, testLogs.testRunId))
        .where(and(eq(testRuns.projectId, p.id), gte(testLogs.executedAt, since)))
        .groupBy(sql`1`, testLogs.status),
      ctx.db
        .select({ action: auditLogs.action, actorEmail: auditLogs.actorEmail, entityType: auditLogs.entityType, createdAt: auditLogs.createdAt })
        .from(auditLogs)
        .where(eq(auditLogs.projectId, p.id))
        .orderBy(desc(auditLogs.createdAt))
        .limit(12),
    ]);
    const counts = await runCountsByCycle(ctx.db, p.id, cycles.map((c) => c.id));
    const testCaseTotal = tcByStatus.reduce((sum, r) => sum + r.n, 0);
    res.json({
      requirements: { total: reqTotal?.n ?? 0, covered: covered?.n ?? 0 },
      testCases: {
        total: testCaseTotal,
        automated: automated?.n ?? 0,
        byStatus: Object.fromEntries(tcByStatus.map((r) => [r.status, r.n])),
      },
      defects: {
        openBySeverity: Object.fromEntries(openBySeverity.map((r) => [r.severity, r.n])),
        byStatus: Object.fromEntries(defectsByStatus.map((r) => [r.status, r.n])),
      },
      activeCycles: cycles.map((c) => ({ ...c, counts: counts.get(c.id) ?? null })),
      executionTrend: trend,
      recentActivity: activity,
    });
  });

  router.get('/traceability', async (req, res) => {
    const p = projectOf(req);
    const reqs = await ctx.db
      .select({ id: requirements.id, seq: requirements.seq, title: requirements.title, status: requirements.status, priority: requirements.priority })
      .from(requirements)
      .where(eq(requirements.projectId, p.id))
      .orderBy(requirements.seq)
      .limit(2000);
    const links = reqs.length
      ? await ctx.db
          .select({ requirementId: requirementLinks.requirementId, testCaseId: testCases.id, seq: testCases.seq, title: testCases.title })
          .from(requirementLinks)
          .innerJoin(testCases, eq(testCases.id, requirementLinks.testCaseId))
          .where(inArray(requirementLinks.requirementId, reqs.map((r) => r.id)))
      : [];
    const tcIds = [...new Set(links.map((l) => l.testCaseId))];
    const latest = tcIds.length
      ? await ctx.db
          .selectDistinctOn([testRuns.testCaseId], { testCaseId: testRuns.testCaseId, status: testRuns.status, executedAt: testRuns.executedAt })
          .from(testRuns)
          .where(and(eq(testRuns.projectId, p.id), inArray(testRuns.testCaseId, tcIds), isNotNull(testRuns.executedAt)))
          .orderBy(testRuns.testCaseId, desc(testRuns.executedAt))
      : [];
    const latestBy = new Map(latest.map((l) => [l.testCaseId, l]));
    res.json({
      items: reqs.map((r) => {
        const tcs = links
          .filter((l) => l.requirementId === r.id)
          .map((l) => ({
            id: l.testCaseId,
            key: displayKey(KEY_PREFIX.testCase, l.seq),
            title: l.title,
            lastStatus: latestBy.get(l.testCaseId)?.status ?? 'not_run',
            lastExecutedAt: latestBy.get(l.testCaseId)?.executedAt ?? null,
          }));
        return { ...r, key: displayKey(KEY_PREFIX.requirement, r.seq), testCases: tcs };
      }),
    });
  });

  router.get('/cycles/:cycleId', async (req, res) => {
    const p = projectOf(req);
    const cycleId = uuidParam(req, 'cycleId', 'Test cycle');
    const [cycle] = await ctx.db
      .select()
      .from(testCycles)
      .where(and(eq(testCycles.id, cycleId), eq(testCycles.projectId, p.id)))
      .limit(1);
    if (!cycle) throw notFound('Test cycle');
    const [counts, byAssignee, problems, cycleDefects] = await Promise.all([
      runCountsByCycle(ctx.db, p.id, [cycle.id]),
      ctx.db
        .select({ assignee: users.name, status: testRuns.status, n: count() })
        .from(testRuns)
        .leftJoin(users, eq(users.id, testRuns.assigneeId))
        .where(eq(testRuns.cycleId, cycle.id))
        .groupBy(users.name, testRuns.status),
      ctx.db
        .select({ id: testRuns.id, status: testRuns.status, comment: testRuns.comment, seq: testCases.seq, title: testCases.title })
        .from(testRuns)
        .innerJoin(testCases, eq(testCases.id, testRuns.testCaseId))
        .where(and(eq(testRuns.cycleId, cycle.id), inArray(testRuns.status, ['failed', 'blocked'])))
        .orderBy(testCases.seq)
        .limit(200),
      ctx.db
        .select({ id: defects.id, seq: defects.seq, title: defects.title, severity: defects.severity, status: defects.status })
        .from(defects)
        .innerJoin(testRuns, eq(testRuns.id, defects.testRunId))
        .where(eq(testRuns.cycleId, cycle.id))
        .orderBy(defects.seq),
    ]);
    const assignees = new Map<string, Record<string, number>>();
    for (const row of byAssignee) {
      const name = row.assignee ?? 'Unassigned';
      const entry = assignees.get(name) ?? { total: 0 };
      entry[row.status] = (entry[row.status] ?? 0) + row.n;
      entry.total = (entry.total ?? 0) + row.n;
      assignees.set(name, entry);
    }
    res.json({
      cycle,
      counts: counts.get(cycle.id) ?? null,
      byAssignee: [...assignees.entries()].map(([name, c]) => ({ name, ...c })),
      problemRuns: problems.map((r) => ({ ...r, testCaseKey: displayKey(KEY_PREFIX.testCase, r.seq) })),
      defects: cycleDefects.map((d) => ({ ...d, key: displayKey(KEY_PREFIX.defect, d.seq) })),
    });
  });

  // ---------------------------------------------------------------- CSV exports
  router.get('/export/test-cases.csv', async (req, res) => {
    const p = projectOf(req);
    const rows = await ctx.db
      .select()
      .from(testCases)
      .where(eq(testCases.projectId, p.id))
      .orderBy(testCases.seq)
      .limit(EXPORT_LIMIT);
    const steps = rows.length
      ? await ctx.db
          .select()
          .from(testSteps)
          .where(inArray(testSteps.testCaseId, rows.map((r) => r.id)))
          .orderBy(testSteps.testCaseId, testSteps.position)
      : [];
    const stepsBy = new Map<string, string[]>();
    for (const s of steps) {
      const list = stepsBy.get(s.testCaseId) ?? [];
      list.push(`${s.position + 1}. ${s.action}${s.expected ? ` => ${s.expected}` : ''}`);
      stepsBy.set(s.testCaseId, list);
    }
    await audit(ctx, req, 'export.test_cases', { details: { rows: rows.length } });
    sendCsv(
      res,
      `${p.key}-test-cases.csv`,
      ['Key', 'Title', 'Status', 'Priority', 'Type', 'Automated', 'Automation key', 'Tags', 'Version', 'Preconditions', 'Steps', 'Updated'],
      rows.map((t) => [
        displayKey(KEY_PREFIX.testCase, t.seq),
        t.title,
        t.status,
        t.priority,
        t.type,
        t.isAutomated ? 'yes' : 'no',
        t.automationKey ?? '',
        t.tags.join(' '),
        t.version,
        t.preconditions,
        (stepsBy.get(t.id) ?? []).join('\n'),
        t.updatedAt,
      ]),
    );
  });

  router.get('/export/requirements.csv', async (req, res) => {
    const p = projectOf(req);
    const rows = await ctx.db
      .select()
      .from(requirements)
      .where(eq(requirements.projectId, p.id))
      .orderBy(requirements.seq)
      .limit(EXPORT_LIMIT);
    await audit(ctx, req, 'export.requirements', { details: { rows: rows.length } });
    sendCsv(
      res,
      `${p.key}-requirements.csv`,
      ['Key', 'Title', 'Status', 'Priority', 'Type', 'External ref', 'Description', 'Updated'],
      rows.map((r) => [displayKey(KEY_PREFIX.requirement, r.seq), r.title, r.status, r.priority, r.type, r.externalRef, r.description, r.updatedAt]),
    );
  });

  router.get('/export/defects.csv', async (req, res) => {
    const p = projectOf(req);
    const rows = await ctx.db
      .select({ d: defects, assigneeName: users.name })
      .from(defects)
      .leftJoin(users, eq(users.id, defects.assigneeId))
      .where(eq(defects.projectId, p.id))
      .orderBy(defects.seq)
      .limit(EXPORT_LIMIT);
    await audit(ctx, req, 'export.defects', { details: { rows: rows.length } });
    sendCsv(
      res,
      `${p.key}-defects.csv`,
      ['Key', 'Title', 'Severity', 'Priority', 'Status', 'Assignee', 'Environment', 'External ref', 'Steps to reproduce', 'Expected', 'Actual', 'Created'],
      rows.map(({ d, assigneeName }) => [
        displayKey(KEY_PREFIX.defect, d.seq),
        d.title,
        d.severity,
        d.priority,
        d.status,
        assigneeName ?? '',
        d.environment,
        d.externalRef,
        d.stepsToReproduce,
        d.expectedResult,
        d.actualResult,
        d.createdAt,
      ]),
    );
  });

  router.get('/export/cycles/:cycleId/runs.csv', async (req, res) => {
    const p = projectOf(req);
    const cycleId = uuidParam(req, 'cycleId', 'Test cycle');
    const [cycle] = await ctx.db
      .select({ id: testCycles.id, name: testCycles.name })
      .from(testCycles)
      .where(and(eq(testCycles.id, cycleId), eq(testCycles.projectId, p.id)))
      .limit(1);
    if (!cycle) throw notFound('Test cycle');
    const rows = await ctx.db
      .select({ r: testRuns, seq: testCases.seq, title: testCases.title, assigneeName: users.name })
      .from(testRuns)
      .innerJoin(testCases, eq(testCases.id, testRuns.testCaseId))
      .leftJoin(users, eq(users.id, testRuns.assigneeId))
      .where(eq(testRuns.cycleId, cycle.id))
      .orderBy(testCases.seq)
      .limit(EXPORT_LIMIT);
    await audit(ctx, req, 'export.runs', { entityType: 'cycle', entityId: cycle.id, details: { rows: rows.length } });
    sendCsv(
      res,
      `${p.key}-${cycle.name}-runs.csv`,
      ['Test case', 'Title', 'Status', 'Assignee', 'Executed at', 'Duration (s)', 'Comment'],
      rows.map(({ r, seq, title, assigneeName }) => [
        displayKey(KEY_PREFIX.testCase, seq),
        title,
        r.status,
        assigneeName ?? '',
        r.executedAt ?? '',
        r.durationSeconds ?? '',
        r.comment,
      ]),
    );
  });

  return router;
}
