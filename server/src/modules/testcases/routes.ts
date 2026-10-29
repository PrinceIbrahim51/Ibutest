import { createTestCaseSchema, escapeLike, testCaseQuery, updateTestCaseSchema } from '@ibutest/shared';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.js';
import type { Executor } from '../../db/index.js';
import {
  requirementLinks,
  requirements,
  testCases,
  testCaseVersions,
  testCycles,
  testRuns,
  testSteps,
  users,
  type TestCaseSnapshot,
} from '../../db/schema.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { pageResult, parseBody, parseQuery, uuidParam } from '../../lib/http.js';
import { authOf } from '../../middleware/auth.js';
import { projectOf, requireProjectRole } from '../../middleware/project.js';
import { KEY_PREFIX, assertFolder, displayKey, nextSeq, parseKeySearch } from '../common.js';

type TestCaseRow = typeof testCases.$inferSelect;
type StepInput = { action: string; expected: string; testData: string };

export const testCaseDto = (t: TestCaseRow) => ({ ...t, key: displayKey(KEY_PREFIX.testCase, t.seq) });

function snapshotOf(t: TestCaseRow, steps: StepInput[]): TestCaseSnapshot {
  return {
    title: t.title,
    description: t.description,
    preconditions: t.preconditions,
    priority: t.priority,
    status: t.status,
    type: t.type,
    automationKey: t.automationKey,
    isAutomated: t.isAutomated,
    estimatedMinutes: t.estimatedMinutes,
    tags: t.tags,
    steps: steps.map(({ action, expected, testData }) => ({ action, expected, testData })),
  };
}

const CONTENT_FIELDS = [
  'title',
  'description',
  'preconditions',
  'priority',
  'type',
  'automationKey',
  'isAutomated',
  'estimatedMinutes',
  'tags',
] as const;

export async function loadSteps(db: Executor, testCaseId: string) {
  return db
    .select({ id: testSteps.id, position: testSteps.position, action: testSteps.action, expected: testSteps.expected, testData: testSteps.testData })
    .from(testSteps)
    .where(eq(testSteps.testCaseId, testCaseId))
    .orderBy(asc(testSteps.position));
}

/** Creates a test case with its steps and the first version snapshot (used by the API, AI and automation). */
export async function createTestCase(
  tx: Executor,
  projectId: string,
  userId: string,
  input: Omit<typeof testCases.$inferInsert, 'projectId' | 'seq'> & { steps: StepInput[] },
) {
  const { steps, ...fields } = input;
  const seq = await nextSeq(tx, projectId, 'testCaseSeq');
  const [created] = await tx
    .insert(testCases)
    .values({ ...fields, projectId, seq, version: 1, createdBy: userId, updatedBy: userId })
    .returning();
  if (!created) throw new Error('insert failed');
  if (steps.length) {
    await tx.insert(testSteps).values(steps.map((s, i) => ({ ...s, testCaseId: created.id, position: i })));
  }
  await tx.insert(testCaseVersions).values({ testCaseId: created.id, version: 1, snapshot: snapshotOf(created, steps), changedBy: userId });
  return created;
}

export function testCasesRouter(ctx: AppContext) {
  const router = Router({ mergeParams: true });

  async function load(db: Executor, projectId: string, id: string) {
    const [row] = await db
      .select()
      .from(testCases)
      .where(and(eq(testCases.id, id), eq(testCases.projectId, projectId)))
      .limit(1);
    if (!row) throw notFound('Test case');
    return row;
  }

  router.get('/', async (req, res) => {
    const p = projectOf(req);
    const q = parseQuery(testCaseQuery, req);
    const conditions: SQL[] = [eq(testCases.projectId, p.id)];
    if (q.folderId) conditions.push(eq(testCases.folderId, q.folderId));
    if (q.status) conditions.push(eq(testCases.status, q.status));
    if (q.priority) conditions.push(eq(testCases.priority, q.priority));
    if (q.search) {
      const seq = parseKeySearch(q.search, KEY_PREFIX.testCase);
      const pattern = `%${escapeLike(q.search)}%`;
      const text = or(ilike(testCases.title, pattern), ilike(testCases.automationKey, pattern)) as SQL;
      conditions.push(seq !== null ? (or(text, eq(testCases.seq, seq)) as SQL) : text);
    }
    const where = and(...conditions);
    const stepCount = sql<number>`(select count(*)::int from ${testSteps} where ${testSteps.testCaseId} = ${testCases.id})`;
    const reqCount = sql<number>`(select count(*)::int from ${requirementLinks} where ${requirementLinks.testCaseId} = ${testCases.id})`;
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select({ testCase: testCases, stepCount, requirementCount: reqCount })
        .from(testCases)
        .where(where)
        .orderBy(desc(testCases.seq))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      ctx.db.select({ n: count() }).from(testCases).where(where),
    ]);
    res.json(
      pageResult(
        rows.map((r) => ({ ...testCaseDto(r.testCase), stepCount: r.stepCount, requirementCount: r.requirementCount })),
        total?.n ?? 0,
        q.page,
        q.pageSize,
      ),
    );
  });

  router.post('/', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const body = parseBody(createTestCaseSchema, req);
    await assertFolder(ctx.db, p.id, body.folderId, 'test_case');
    const row = await ctx.db.transaction((tx) => createTestCase(tx, p.id, me.userId, body));
    await audit(ctx, req, 'test_case.created', { entityType: 'test_case', entityId: row.id });
    res.status(201).json({ testCase: testCaseDto(row) });
  });

  router.get('/:testCaseId', async (req, res) => {
    const p = projectOf(req);
    const row = await load(ctx.db, p.id, uuidParam(req, 'testCaseId', 'Test case'));
    const personIds = [row.createdBy, row.approvedBy].filter((v): v is string => !!v);
    const [steps, linked, runs, people] = await Promise.all([
      loadSteps(ctx.db, row.id),
      ctx.db
        .select({ id: requirements.id, seq: requirements.seq, title: requirements.title, status: requirements.status })
        .from(requirementLinks)
        .innerJoin(requirements, eq(requirements.id, requirementLinks.requirementId))
        .where(eq(requirementLinks.testCaseId, row.id))
        .orderBy(requirements.seq),
      ctx.db
        .select({
          id: testRuns.id,
          status: testRuns.status,
          executedAt: testRuns.executedAt,
          cycleId: testCycles.id,
          cycleName: testCycles.name,
        })
        .from(testRuns)
        .innerJoin(testCycles, eq(testCycles.id, testRuns.cycleId))
        .where(eq(testRuns.testCaseId, row.id))
        .orderBy(desc(testRuns.updatedAt))
        .limit(10),
      personIds.length
        ? ctx.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, personIds))
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const nameOf = (id: string | null) => people.find((u) => u.id === id)?.name ?? null;
    res.json({
      testCase: { ...testCaseDto(row), createdByName: nameOf(row.createdBy), approvedByName: nameOf(row.approvedBy) },
      steps,
      requirements: linked.map((r) => ({ ...r, key: displayKey(KEY_PREFIX.requirement, r.seq) })),
      recentRuns: runs,
    });
  });

  router.patch('/:testCaseId', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const id = uuidParam(req, 'testCaseId', 'Test case');
    const body = parseBody(updateTestCaseSchema, req);
    if (body.folderId !== undefined) await assertFolder(ctx.db, p.id, body.folderId, 'test_case');

    const updated = await ctx.db.transaction(async (tx) => {
      const current = await load(tx, p.id, id);
      const currentSteps = await loadSteps(tx, id);
      const { steps, ...fields } = body;
      const stepsChanged =
        steps !== undefined &&
        JSON.stringify(steps) !== JSON.stringify(currentSteps.map(({ action, expected, testData }) => ({ action, expected, testData })));
      const fieldsChanged = CONTENT_FIELDS.some(
        (f) => fields[f] !== undefined && JSON.stringify(fields[f]) !== JSON.stringify(current[f]),
      );
      const contentChanged = stepsChanged || fieldsChanged;
      const patch: Partial<typeof testCases.$inferInsert> = { ...fields, updatedBy: me.userId };
      if (contentChanged) {
        patch.version = current.version + 1;
        // Editing an approved test case invalidates the approval.
        if (current.status === 'approved' && fields.status === undefined) patch.status = 'ready';
        if (current.status === 'approved') {
          patch.approvedBy = null;
          patch.approvedAt = null;
        }
      }
      const [row] = await tx.update(testCases).set(patch).where(eq(testCases.id, id)).returning();
      if (!row) throw notFound('Test case');
      let finalSteps: StepInput[] = currentSteps;
      if (stepsChanged && steps) {
        await tx.delete(testSteps).where(eq(testSteps.testCaseId, id));
        if (steps.length) await tx.insert(testSteps).values(steps.map((s, i) => ({ ...s, testCaseId: id, position: i })));
        finalSteps = steps;
      }
      if (contentChanged) {
        await tx.insert(testCaseVersions).values({ testCaseId: id, version: row.version, snapshot: snapshotOf(row, finalSteps), changedBy: me.userId });
      }
      return row;
    });
    await audit(ctx, req, 'test_case.updated', { entityType: 'test_case', entityId: id, details: { version: updated.version } });
    res.json({ testCase: testCaseDto(updated) });
  });

  router.post('/:testCaseId/approve', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const id = uuidParam(req, 'testCaseId', 'Test case');
    const current = await load(ctx.db, p.id, id);
    if (current.status === 'deprecated') throw badRequest('Deprecated test cases cannot be approved');
    const [row] = await ctx.db
      .update(testCases)
      .set({ status: 'approved', approvedBy: me.userId, approvedAt: new Date(), updatedBy: me.userId })
      .where(eq(testCases.id, id))
      .returning();
    await audit(ctx, req, 'test_case.approved', { entityType: 'test_case', entityId: id, details: { version: current.version } });
    res.json({ testCase: testCaseDto(row!) });
  });

  router.post('/:testCaseId/clone', requireProjectRole('tester'), async (req, res) => {
    const p = projectOf(req);
    const me = authOf(req);
    const id = uuidParam(req, 'testCaseId', 'Test case');
    const row = await ctx.db.transaction(async (tx) => {
      const source = await load(tx, p.id, id);
      const steps = await loadSteps(tx, id);
      return createTestCase(tx, p.id, me.userId, {
        title: `Copy of ${source.title}`.slice(0, 255),
        description: source.description,
        preconditions: source.preconditions,
        priority: source.priority,
        status: 'draft',
        type: source.type,
        folderId: source.folderId,
        automationKey: null,
        isAutomated: source.isAutomated,
        estimatedMinutes: source.estimatedMinutes,
        tags: source.tags,
        steps: steps.map(({ action, expected, testData }) => ({ action, expected, testData })),
      });
    });
    await audit(ctx, req, 'test_case.created', { entityType: 'test_case', entityId: row.id, details: { clonedFrom: id } });
    res.status(201).json({ testCase: testCaseDto(row) });
  });

  router.delete('/:testCaseId', requireProjectRole('lead'), async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'testCaseId', 'Test case');
    const row = await load(ctx.db, p.id, id);
    await ctx.db.delete(testCases).where(and(eq(testCases.id, id), eq(testCases.projectId, p.id)));
    await audit(ctx, req, 'test_case.deleted', { entityType: 'test_case', entityId: id, details: { title: row.title } });
    res.status(204).end();
  });

  router.get('/:testCaseId/versions', async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'testCaseId', 'Test case');
    await load(ctx.db, p.id, id);
    const rows = await ctx.db
      .select({ version: testCaseVersions.version, createdAt: testCaseVersions.createdAt, changedByName: users.name })
      .from(testCaseVersions)
      .leftJoin(users, eq(users.id, testCaseVersions.changedBy))
      .where(eq(testCaseVersions.testCaseId, id))
      .orderBy(desc(testCaseVersions.version));
    res.json({ items: rows });
  });

  router.get('/:testCaseId/versions/:version', async (req, res) => {
    const p = projectOf(req);
    const id = uuidParam(req, 'testCaseId', 'Test case');
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) throw notFound('Version');
    await load(ctx.db, p.id, id);
    const [row] = await ctx.db
      .select()
      .from(testCaseVersions)
      .where(and(eq(testCaseVersions.testCaseId, id), eq(testCaseVersions.version, version)))
      .limit(1);
    if (!row) throw notFound('Version');
    res.json({ version: row });
  });

  return router;
}
