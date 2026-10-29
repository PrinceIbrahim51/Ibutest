import { automationResultsSchema } from '@ibutest/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { type Request, Router } from 'express';
import type { AppContext } from '../../context.js';
import { projects, releases, testCases, testCycles, testLogs, testRuns, users } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { parseBody } from '../../lib/http.js';
import { authenticateApiToken } from '../../middleware/auth.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import { createTestCase } from '../testcases/routes.js';

/**
 * CI/CD integration (comparable to qTest Launch / automation uploads). Authenticated with a
 * project-scoped API token: `Authorization: Bearer ibt_...`.
 */
export function automationRouter(ctx: AppContext, limiters: RateLimiters) {
  const router = Router();
  router.use(authenticateApiToken(ctx), limiters.automation);

  function tokenOf(req: Request) {
    if (!req.apiToken) throw unauthorized();
    return req.apiToken;
  }

  router.get('/v1/ping', async (req, res) => {
    const token = tokenOf(req);
    const [project] = await ctx.db
      .select({ id: projects.id, key: projects.key, name: projects.name })
      .from(projects)
      .where(eq(projects.id, token.projectId))
      .limit(1);
    res.json({ ok: true, project });
  });

  router.post('/v1/results', async (req, res) => {
    const token = tokenOf(req);
    const body = parseBody(automationResultsSchema, req);
    const [project] = await ctx.db.select().from(projects).where(eq(projects.id, token.projectId)).limit(1);
    if (!project) throw unauthorized();
    if (project.isArchived) throw conflict('This project is archived and read-only', 'PROJECT_ARCHIVED');
    const [owner] = await ctx.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, token.userId)).limit(1);

    const summary = await ctx.db.transaction(async (tx) => {
      // Resolve (or create) the target cycle inside the token's project only.
      let cycle: typeof testCycles.$inferSelect | undefined;
      if (body.cycleId) {
        [cycle] = await tx
          .select()
          .from(testCycles)
          .where(and(eq(testCycles.id, body.cycleId), eq(testCycles.projectId, project.id)))
          .limit(1);
        if (!cycle) throw badRequest('Test cycle does not exist in this project');
      } else if (body.cycleName) {
        [cycle] = await tx
          .select()
          .from(testCycles)
          .where(and(eq(testCycles.projectId, project.id), eq(testCycles.name, body.cycleName)))
          .limit(1);
        if (!cycle) {
          if (body.releaseId) {
            const [release] = await tx
              .select({ id: releases.id })
              .from(releases)
              .where(and(eq(releases.id, body.releaseId), eq(releases.projectId, project.id)))
              .limit(1);
            if (!release) throw badRequest('Release does not exist in this project');
          }
          [cycle] = await tx
            .insert(testCycles)
            .values({ projectId: project.id, name: body.cycleName, status: 'active', releaseId: body.releaseId ?? null, createdBy: token.userId })
            .returning();
        }
      }
      if (!cycle) throw badRequest('Provide cycleId or cycleName');
      if (cycle.status === 'closed') throw conflict('This test cycle is closed');

      const keys = [...new Set(body.results.map((r) => r.automationKey))];
      const existing = await tx
        .select({ id: testCases.id, automationKey: testCases.automationKey, version: testCases.version })
        .from(testCases)
        .where(and(eq(testCases.projectId, project.id), inArray(testCases.automationKey, keys)));
      const byKey = new Map(existing.map((t) => [t.automationKey as string, t]));

      let createdCases = 0;
      const results: { automationKey: string; testCaseId: string | null; runId: string | null; status: string; error?: string }[] = [];
      const now = new Date();
      for (const r of body.results) {
        let tc = byKey.get(r.automationKey);
        if (!tc) {
          if (!body.createMissing) {
            results.push({ automationKey: r.automationKey, testCaseId: null, runId: null, status: 'skipped', error: 'No test case with this automation key' });
            continue;
          }
          const created = await createTestCase(tx, project.id, token.userId, {
            title: (r.name ?? r.automationKey).slice(0, 255),
            description: 'Created automatically from an automation result upload.',
            preconditions: '',
            priority: 'medium',
            status: 'ready',
            type: 'regression',
            folderId: null,
            automationKey: r.automationKey,
            isAutomated: true,
            estimatedMinutes: null,
            tags: ['automated'],
            steps: [],
          });
          tc = { id: created.id, automationKey: r.automationKey, version: created.version };
          byKey.set(r.automationKey, tc);
          createdCases++;
        }
        const duration = r.durationSeconds === undefined ? null : Math.round(r.durationSeconds);
        const [run] = await tx
          .insert(testRuns)
          .values({
            projectId: project.id,
            cycleId: cycle.id,
            testCaseId: tc.id,
            testCaseVersion: tc.version,
            status: r.status,
            executedBy: token.userId,
            executedAt: now,
            durationSeconds: duration,
            comment: r.message ?? '',
          })
          .onConflictDoUpdate({
            target: [testRuns.cycleId, testRuns.testCaseId],
            set: { status: r.status, executedBy: token.userId, executedAt: now, durationSeconds: duration, comment: r.message ?? '' },
          })
          .returning({ id: testRuns.id });
        await tx.insert(testLogs).values({
          testRunId: run!.id,
          status: r.status,
          executedBy: token.userId,
          executedAt: now,
          durationSeconds: duration,
          comment: r.message ?? '',
          stepResults: [],
          source: 'automation',
        });
        results.push({ automationKey: r.automationKey, testCaseId: tc.id, runId: run!.id, status: r.status });
      }
      return { cycleId: cycle.id, cycleName: cycle.name, createdTestCases: createdCases, results };
    });

    await audit(ctx, req, 'automation.results_uploaded', {
      projectId: project.id,
      entityType: 'cycle',
      entityId: summary.cycleId,
      actor: owner ? { id: owner.id, email: owner.email } : null,
      details: { results: summary.results.length, createdTestCases: summary.createdTestCases, tokenId: token.tokenId },
    });
    res.json(summary);
  });

  return router;
}
