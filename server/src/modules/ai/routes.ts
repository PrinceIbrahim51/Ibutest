import { aiDraftDefectSchema, aiGenerateTestCasesSchema, aiReviewTestCaseSchema, aiSummarizeCycleSchema } from '@ibutest/shared';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { type NextFunction, type Request, type Response, Router } from 'express';
import type { AppContext } from '../../context.js';
import { aiUsage, defects, requirements, testCases, testCycles, testLogs, testRuns } from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { AppError, notFound, tooMany } from '../../lib/errors.js';
import { parseBody } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';
import type { RateLimiters } from '../../middleware/rateLimit.js';
import { KEY_PREFIX, displayKey } from '../common.js';
import { runCountsByCycle } from '../execution/routes.js';
import { loadSteps } from '../testcases/routes.js';
import type { AiService, AiUsage } from './service.js';

export function aiRouter(ctx: AppContext, limiters: RateLimiters) {
  const router = Router({ mergeParams: true });

  async function tokensUsedToday(userId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [row] = await ctx.db
      .select({ n: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)));
    return row?.n ?? 0;
  }

  router.get('/status', async (req, res) => {
    const p = projectOf(req);
    const used = await tokensUsedToday(authOf(req).userId);
    res.json({
      available: !!ctx.ai,
      enabledForProject: p.aiEnabled,
      dailyTokenLimit: ctx.config.rateLimits.aiDailyTokens,
      tokensUsedToday: used,
    });
  });

  /** Gate: AI configured, enabled for the project, role, per-user rate limit and daily token quota. */
  const gate = [
    requireProjectRole('tester'),
    async (req: Request, _res: Response, next: NextFunction) => {
      if (!ctx.ai) throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI features are not configured on this server');
      if (!projectOf(req).aiEnabled) throw new AppError(403, 'AI_DISABLED', 'AI features are disabled for this project');
      if ((await tokensUsedToday(authOf(req).userId)) >= ctx.config.rateLimits.aiDailyTokens) {
        throw tooMany('Daily AI usage limit reached, try again tomorrow');
      }
      next();
    },
    limiters.ai,
  ];

  const ai = (): AiService => {
    if (!ctx.ai) throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI features are not configured on this server');
    return ctx.ai;
  };

  async function record(req: Request, feature: string, usage: AiUsage) {
    await ctx.db.insert(aiUsage).values({
      userId: authOf(req).userId,
      projectId: projectOf(req).id,
      feature,
      model: usage.model.slice(0, 64),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    await audit(ctx, req, `ai.${feature}`, { details: { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } });
  }

  async function testCaseForAi(projectId: string, testCaseId: string) {
    const [tc] = await ctx.db
      .select()
      .from(testCases)
      .where(and(eq(testCases.id, testCaseId), eq(testCases.projectId, projectId)))
      .limit(1);
    if (!tc) throw notFound('Test case');
    const steps = await loadSteps(ctx.db, tc.id);
    return { tc, input: { title: tc.title, description: tc.description, preconditions: tc.preconditions, steps } };
  }

  router.post('/generate-test-cases', ...gate, async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(aiGenerateTestCasesSchema, req);
    let title = 'Ad-hoc requirement';
    let description = body.text ?? '';
    if (body.requirementId) {
      const [r] = await ctx.db
        .select()
        .from(requirements)
        .where(and(eq(requirements.id, body.requirementId), eq(requirements.projectId, p.id)))
        .limit(1);
      if (!r) throw notFound('Requirement');
      title = r.title;
      description = [r.description, body.text].filter(Boolean).join('\n\n');
    }
    const { data, usage } = await ai().generateTestCases({ title, description, count: body.count, focus: body.focus });
    await record(req, 'generate_test_cases', usage);
    // Drafts only: nothing is saved until a person reviews and accepts them.
    res.json({ requirementId: body.requirementId ?? null, testCases: data.testCases });
  });

  router.post('/review-test-case', ...gate, async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(aiReviewTestCaseSchema, req);
    const { input } = await testCaseForAi(p.id, body.testCaseId);
    const { data, usage } = await ai().reviewTestCase(input);
    await record(req, 'review_test_case', usage);
    res.json({ review: data });
  });

  router.post('/draft-defect', ...gate, async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(aiDraftDefectSchema, req);
    const [run] = await ctx.db
      .select()
      .from(testRuns)
      .where(and(eq(testRuns.id, body.testRunId), eq(testRuns.projectId, p.id)))
      .limit(1);
    if (!run) throw notFound('Test run');
    const { input } = await testCaseForAi(p.id, run.testCaseId);
    const [log] = await ctx.db
      .select()
      .from(testLogs)
      .where(eq(testLogs.testRunId, run.id))
      .orderBy(desc(testLogs.executedAt))
      .limit(1);
    const { data, usage } = await ai().draftDefect({
      testCase: input,
      status: run.status,
      comment: run.comment,
      stepResults: (log?.stepResults ?? []).map((s) => ({ position: s.position, status: s.status, actual: s.actual })),
    });
    await record(req, 'draft_defect', usage);
    res.json({ testRunId: run.id, testCaseId: run.testCaseId, defect: data });
  });

  router.post('/summarize-cycle', ...gate, async (req, res) => {
    const p = projectOf(req);
    const body = parseBody(aiSummarizeCycleSchema, req);
    const [cycle] = await ctx.db
      .select()
      .from(testCycles)
      .where(and(eq(testCycles.id, body.cycleId), eq(testCycles.projectId, p.id)))
      .limit(1);
    if (!cycle) throw notFound('Test cycle');
    const counts = (await runCountsByCycle(ctx.db, p.id, [cycle.id])).get(cycle.id) ?? {};
    const problems = await ctx.db
      .select({ status: testRuns.status, comment: testRuns.comment, seq: testCases.seq, title: testCases.title })
      .from(testRuns)
      .innerJoin(testCases, eq(testCases.id, testRuns.testCaseId))
      .where(and(eq(testRuns.cycleId, cycle.id), inArray(testRuns.status, ['failed', 'blocked'])))
      .limit(50);
    const cycleDefects = await ctx.db
      .select({ seq: defects.seq, title: defects.title, severity: defects.severity, status: defects.status })
      .from(defects)
      .innerJoin(testRuns, eq(testRuns.id, defects.testRunId))
      .where(eq(testRuns.cycleId, cycle.id))
      .limit(50);
    const { data, usage } = await ai().summarizeCycle({
      name: cycle.name,
      counts,
      problems: problems.map((r) => ({ key: displayKey(KEY_PREFIX.testCase, r.seq), title: r.title, status: r.status, comment: r.comment })),
      defects: cycleDefects.map((d) => ({ key: displayKey(KEY_PREFIX.defect, d.seq), title: d.title, severity: d.severity, status: d.status })),
    });
    await record(req, 'summarize_cycle', usage);
    res.json({ cycleId: cycle.id, summary: data });
  });

  return router;
}
