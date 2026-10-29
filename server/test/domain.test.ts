import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiService } from '../src/modules/ai/service.js';
import { addMember, bearer, createProject, createTestApp, createUser, setupAdmin, type TestApp } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const usage = { model: 'claude-opus-5-5', inputTokens: 100, outputTokens: 50 };
const fakeAi: AiService = {
  async generateTestCases({ count }) {
    return {
      usage,
      data: {
        testCases: Array.from({ length: count }, (_, i) => ({
          title: `Generated case ${i + 1}`,
          description: 'Objective',
          preconditions: 'User exists',
          priority: 'high' as const,
          type: 'functional' as const,
          steps: [{ action: 'Open login page', expected: 'Form is shown', testData: '' }],
        })),
      },
    };
  },
  async reviewTestCase() {
    return { usage, data: { score: 72, summary: 'OK', issues: [], suggestedAdditionalTests: ['Try an expired password'] } };
  },
  async draftDefect() {
    return {
      usage,
      data: {
        title: 'Login fails',
        description: 'd',
        stepsToReproduce: '1. Open',
        expectedResult: 'e',
        actualResult: 'a',
        severity: 'major' as const,
        priority: 'high' as const,
      },
    };
  },
  async summarizeCycle() {
    return { usage, data: { summary: 'Mostly passing', readiness: 'at_risk' as const, risks: ['Login'], recommendations: ['Fix login'] } };
  },
};

let t: TestApp;
let admin: { token: string; userId: string };
let tester: { token: string; userId: string };
let viewer: { token: string; userId: string };
let projectId: string;
let base: string;

beforeAll(async () => {
  t = await createTestApp({ AI_DAILY_TOKEN_LIMIT: '1000' }, fakeAi);
  admin = await setupAdmin(t);
  tester = await createUser(t, admin.token, 'tester@ibutest.dev');
  viewer = await createUser(t, admin.token, 'viewer@ibutest.dev');
  projectId = await createProject(t, admin.token, 'SHOP');
  base = `/api/projects/${projectId}`;
  await addMember(t, admin.token, projectId, tester.userId, 'tester');
  await addMember(t, admin.token, projectId, viewer.userId, 'viewer');
});
afterAll(async () => {
  await t.close();
});

describe('test management workflow', () => {
  let requirementId: string;
  let testCaseId: string;
  let cycleId: string;
  let runId: string;

  it('organises requirements and test cases in folders with project keys', async () => {
    const folder = await t.request.post(`${base}/folders`).set(bearer(tester.token)).send({ kind: 'test_case', name: 'Checkout' }).expect(201);
    const sub = await t.request
      .post(`${base}/folders`)
      .set(bearer(tester.token))
      .send({ kind: 'test_case', name: 'Payments', parentId: folder.body.folder.id })
      .expect(201);
    // A folder cannot be moved into its own subtree.
    await t.request.patch(`${base}/folders/${folder.body.folder.id}`).set(bearer(tester.token)).send({ parentId: sub.body.folder.id }).expect(400);

    const req = await t.request
      .post(`${base}/requirements`)
      .set(bearer(tester.token))
      .send({ title: 'Users can pay by card', description: 'Visa and Mastercard', priority: 'high' })
      .expect(201);
    requirementId = req.body.requirement.id;
    expect(req.body.requirement.key).toBe('RQ-1');

    const tc = await t.request
      .post(`${base}/test-cases`)
      .set(bearer(tester.token))
      .send({
        title: 'Pay with a valid Visa card',
        folderId: sub.body.folder.id,
        priority: 'critical',
        tags: ['Smoke', 'payments'],
        steps: [
          { action: 'Add an item to the cart', expected: 'Cart shows 1 item' },
          { action: 'Pay with card 4111 1111 1111 1111', expected: 'Order confirmation is shown', testData: '4111111111111111' },
        ],
      })
      .expect(201);
    testCaseId = tc.body.testCase.id;
    expect(tc.body.testCase.key).toBe('TC-1');
    expect(tc.body.testCase.tags).toEqual(['smoke', 'payments']);

    await t.request.post(`${base}/requirements/${requirementId}/links`).set(bearer(tester.token)).send({ testCaseIds: [testCaseId] }).expect(204);
    const detail = await t.request.get(`${base}/requirements/${requirementId}`).set(bearer(viewer.token)).expect(200);
    expect(detail.body.testCases).toHaveLength(1);

    const search = await t.request.get(`${base}/test-cases`).query({ search: 'TC-1' }).set(bearer(viewer.token)).expect(200);
    expect(search.body.items).toHaveLength(1);
  });

  it('versions test cases and resets approval when an approved case changes', async () => {
    await t.request.post(`${base}/test-cases/${testCaseId}/approve`).set(bearer(admin.token)).expect(200);
    // Status-only changes do not create a new version.
    const moved = await t.request.patch(`${base}/test-cases/${testCaseId}`).set(bearer(tester.token)).send({ folderId: null }).expect(200);
    expect(moved.body.testCase.version).toBe(1);
    expect(moved.body.testCase.status).toBe('approved');

    const edited = await t.request
      .patch(`${base}/test-cases/${testCaseId}`)
      .set(bearer(tester.token))
      .send({
        steps: [
          { action: 'Add an item to the cart', expected: 'Cart shows 1 item' },
          { action: 'Pay with a valid Visa card', expected: 'Order confirmation is shown' },
          { action: 'Open order history', expected: 'Order is listed as paid' },
        ],
      })
      .expect(200);
    expect(edited.body.testCase.version).toBe(2);
    expect(edited.body.testCase.status).toBe('ready');
    expect(edited.body.testCase.approvedBy).toBeNull();

    const versions = await t.request.get(`${base}/test-cases/${testCaseId}/versions`).set(bearer(viewer.token)).expect(200);
    expect(versions.body.items.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const v1 = await t.request.get(`${base}/test-cases/${testCaseId}/versions/1`).set(bearer(viewer.token)).expect(200);
    expect(v1.body.version.snapshot.steps).toHaveLength(2);

    // Approval status cannot be set directly through the update API.
    await t.request.patch(`${base}/test-cases/${testCaseId}`).set(bearer(tester.token)).send({ status: 'approved' }).expect(400);
  });

  it('plans and executes a test cycle step by step', async () => {
    const release = await t.request.post(`${base}/releases`).set(bearer(admin.token)).send({ name: 'v2.0', startDate: '2026-11-01', endDate: '2026-11-30' }).expect(201);
    await t.request.post(`${base}/releases`).set(bearer(admin.token)).send({ name: 'bad', startDate: '2026-12-01', endDate: '2026-11-01' }).expect(400);
    const cycle = await t.request
      .post(`${base}/cycles`)
      .set(bearer(admin.token))
      .send({ name: 'Sprint 12 regression', releaseId: release.body.release.id })
      .expect(201);
    cycleId = cycle.body.cycle.id;

    const added = await t.request.post(`${base}/cycles/${cycleId}/runs`).set(bearer(admin.token)).send({ testCaseIds: [testCaseId], assigneeId: tester.userId }).expect(201);
    expect(added.body.added).toBe(1);
    const again = await t.request.post(`${base}/cycles/${cycleId}/runs`).set(bearer(admin.token)).send({ testCaseIds: [testCaseId] }).expect(201);
    expect(again.body.added).toBe(0);

    const runs = await t.request.get(`${base}/cycles/${cycleId}/runs`).set(bearer(tester.token)).expect(200);
    runId = runs.body.items[0].id;
    expect(runs.body.items[0].assigneeName).toBe('tester');

    await t.request.post(`${base}/runs/${runId}/execute`).set(bearer(viewer.token)).send({ status: 'passed' }).expect(403);
    await t.request
      .post(`${base}/runs/${runId}/execute`)
      .set(bearer(tester.token))
      .send({ status: 'failed', stepResults: [{ position: 99, status: 'failed' }] })
      .expect(400);
    const exec = await t.request
      .post(`${base}/runs/${runId}/execute`)
      .set(bearer(tester.token))
      .send({
        status: 'failed',
        comment: 'Payment gateway timeout',
        durationSeconds: 95,
        stepResults: [
          { position: 0, status: 'passed' },
          { position: 1, status: 'failed', actual: 'Spinner never stops' },
        ],
      })
      .expect(200);
    expect(exec.body.run.status).toBe('failed');

    const run = await t.request.get(`${base}/runs/${runId}`).set(bearer(viewer.token)).expect(200);
    expect(run.body.logs).toHaveLength(1);
    expect(run.body.logs[0].stepResults[1]).toMatchObject({ status: 'failed', actual: 'Spinner never stops' });
    expect(run.body.cycle.status).toBe('active');
  });

  it('raises defects linked to failed runs and reports on them', async () => {
    const defect = await t.request
      .post(`${base}/defects`)
      .set(bearer(tester.token))
      .send({ title: 'Card payment times out', severity: 'critical', testRunId: runId, assigneeId: tester.userId })
      .expect(201);
    expect(defect.body.defect.key).toBe('DF-1');
    expect(defect.body.defect.testCaseId).toBe(testCaseId);
    // Assignees must be project members.
    await t.request.post(`${base}/defects`).set(bearer(tester.token)).send({ title: 'x', assigneeId: admin.userId }).expect(201);
    const outsider = await createUser(t, admin.token, 'outsider@ibutest.dev');
    await t.request.post(`${base}/defects`).set(bearer(tester.token)).send({ title: 'x', assigneeId: outsider.userId }).expect(400);

    const resolved = await t.request.patch(`${base}/defects/${defect.body.defect.id}`).set(bearer(tester.token)).send({ status: 'resolved' }).expect(200);
    expect(resolved.body.defect.resolvedAt).toBeTruthy();

    const dashboard = await t.request.get(`${base}/reports/dashboard`).set(bearer(viewer.token)).expect(200);
    expect(dashboard.body.requirements).toEqual({ total: 1, covered: 1 });
    expect(dashboard.body.testCases.total).toBe(1);
    expect(dashboard.body.activeCycles[0].counts.failed).toBe(1);

    const trace = await t.request.get(`${base}/reports/traceability`).set(bearer(viewer.token)).expect(200);
    expect(trace.body.items[0].testCases[0].lastStatus).toBe('failed');

    const cycleReport = await t.request.get(`${base}/reports/cycles/${cycleId}`).set(bearer(viewer.token)).expect(200);
    expect(cycleReport.body.problemRuns).toHaveLength(1);
    expect(cycleReport.body.defects).toHaveLength(1);

    const csv = await t.request.get(`${base}/reports/export/cycles/${cycleId}/runs.csv`).set(bearer(viewer.token)).expect(200);
    expect(csv.text).toContain('TC-1');
  });

  it('closed cycles cannot be executed', async () => {
    await t.request.patch(`${base}/cycles/${cycleId}`).set(bearer(admin.token)).send({ status: 'closed' }).expect(200);
    await t.request.post(`${base}/runs/${runId}/execute`).set(bearer(tester.token)).send({ status: 'passed' }).expect(409);
    await t.request.patch(`${base}/cycles/${cycleId}`).set(bearer(admin.token)).send({ status: 'active' }).expect(200);
  });
});

describe('attachments', () => {
  let testCaseId: string;
  beforeAll(async () => {
    const tc = await t.request.post(`${base}/test-cases`).set(bearer(tester.token)).send({ title: 'With evidence' }).expect(201);
    testCaseId = tc.body.testCase.id;
  });

  it('accepts real images and serves them as downloads', async () => {
    const up = await t.request
      .post(`${base}/attachments`)
      .set(bearer(tester.token))
      .field('entityType', 'test_case')
      .field('entityId', testCaseId)
      .attach('file', PNG, { filename: 'screen shot.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body.attachment.mimeType).toBe('image/png');
    const dl = await t.request.get(`${base}/attachments/${up.body.attachment.id}/download`).set(bearer(viewer.token)).expect(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects disguised or dangerous files based on content, not name', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    for (const [name, type] of [
      ['evil.png', 'image/png'],
      ['evil.html', 'text/html'],
      ['evil.svg', 'image/svg+xml'],
    ] as const) {
      await t.request
        .post(`${base}/attachments`)
        .set(bearer(tester.token))
        .field('entityType', 'test_case')
        .field('entityId', testCaseId)
        .attach('file', html, { filename: name, contentType: type })
        .expect(400);
    }
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
    await t.request
      .post(`${base}/attachments`)
      .set(bearer(tester.token))
      .field('entityType', 'test_case')
      .field('entityId', testCaseId)
      .attach('file', exe, { filename: 'notes.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('enforces size limits and target ownership', async () => {
    await t.request
      .post(`${base}/attachments`)
      .set(bearer(tester.token))
      .field('entityType', 'test_case')
      .field('entityId', testCaseId)
      .attach('file', Buffer.alloc(11 * 1024 * 1024, 65), { filename: 'big.txt', contentType: 'text/plain' })
      .expect(413);
    await t.request
      .post(`${base}/attachments`)
      .set(bearer(viewer.token))
      .field('entityType', 'test_case')
      .field('entityId', testCaseId)
      .attach('file', PNG, { filename: 'a.png' })
      .expect(403);
    const other = await createProject(t, admin.token, 'OTHER');
    await t.request
      .post(`/api/projects/${other}/attachments`)
      .set(bearer(admin.token))
      .field('entityType', 'test_case')
      .field('entityId', testCaseId)
      .attach('file', PNG, { filename: 'a.png' })
      .expect(400);
  });
});

describe('automation API', () => {
  it('ingests CI results with a project-scoped token', async () => {
    const created = await t.request.post(`${base}/api-tokens`).set(bearer(tester.token)).send({ name: 'GitHub Actions', expiresInDays: 30 }).expect(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^ibt_/);
    const listed = await t.request.get(`${base}/api-tokens`).set(bearer(tester.token)).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(token);

    // API tokens are not accepted by the interactive API and vice versa.
    await t.request.get('/api/projects').set(bearer(token)).expect(401);
    await t.request.get('/api/automation/v1/ping').set(bearer(tester.token)).expect(401);

    const ping = await t.request.get('/api/automation/v1/ping').set(bearer(token)).expect(200);
    expect(ping.body.project.key).toBe('SHOP');

    const upload = await t.request
      .post('/api/automation/v1/results')
      .set(bearer(token))
      .send({
        cycleName: 'Nightly 2026-10-29',
        results: [
          { automationKey: 'checkout.spec.ts::pays with visa', status: 'passed', durationSeconds: 3.2 },
          { automationKey: 'checkout.spec.ts::rejects expired card', status: 'failed', message: 'AssertionError' },
        ],
      })
      .expect(200);
    expect(upload.body.createdTestCases).toBe(2);
    expect(upload.body.results.every((r: { runId: string }) => r.runId)).toBe(true);

    const again = await t.request
      .post('/api/automation/v1/results')
      .set(bearer(token))
      .send({ cycleId: upload.body.cycleId, results: [{ automationKey: 'checkout.spec.ts::rejects expired card', status: 'passed' }] })
      .expect(200);
    expect(again.body.createdTestCases).toBe(0);

    await t.request.delete(`${base}/api-tokens/${created.body.apiToken.id}`).set(bearer(tester.token)).expect(204);
    await t.request.get('/api/automation/v1/ping').set(bearer(token)).expect(401);
  });

  it('stops working when the owner loses write access', async () => {
    const created = await t.request.post(`${base}/api-tokens`).set(bearer(tester.token)).send({ name: 'CI' }).expect(201);
    await addMember(t, admin.token, projectId, tester.userId, 'viewer');
    await t.request.get('/api/automation/v1/ping').set(bearer(created.body.token)).expect(403);
    await addMember(t, admin.token, projectId, tester.userId, 'tester');
  });
});

describe('AI assistant', () => {
  it('generates draft test cases from a requirement without saving them', async () => {
    const req = await t.request.post(`${base}/requirements`).set(bearer(tester.token)).send({ title: 'Password reset by email' }).expect(201);
    const before = await t.request.get(`${base}/test-cases`).set(bearer(tester.token)).expect(200);
    const res = await t.request
      .post(`${base}/ai/generate-test-cases`)
      .set(bearer(tester.token))
      .send({ requirementId: req.body.requirement.id, count: 3 })
      .expect(200);
    expect(res.body.testCases).toHaveLength(3);
    const after = await t.request.get(`${base}/test-cases`).set(bearer(tester.token)).expect(200);
    expect(after.body.total).toBe(before.body.total);
  });

  it('is restricted to testers and can be disabled per project', async () => {
    await t.request.post(`${base}/ai/generate-test-cases`).set(bearer(viewer.token)).send({ text: 'Some requirement text' }).expect(403);
    await t.request.patch(base).set(bearer(admin.token)).send({ aiEnabled: false }).expect(200);
    const res = await t.request.post(`${base}/ai/generate-test-cases`).set(bearer(tester.token)).send({ text: 'Some requirement text' }).expect(403);
    expect(res.body.error.code).toBe('AI_DISABLED');
    await t.request.patch(base).set(bearer(admin.token)).send({ aiEnabled: true }).expect(200);
  });

  it('enforces the daily token quota', async () => {
    // 150 tokens per call, quota 1000: the first call above already used 150.
    let status = 200;
    for (let i = 0; i < 10 && status === 200; i++) {
      status = (await t.request.post(`${base}/ai/generate-test-cases`).set(bearer(admin.token)).send({ text: 'Quota requirement text', count: 1 })).status;
    }
    expect(status).toBe(429);
  });

  it('reports AI as unavailable when no API key is configured', async () => {
    const noAi = await createTestApp();
    try {
      const a = await setupAdmin(noAi);
      const p = await createProject(noAi, a.token, 'NOAI');
      const res = await noAi.request.post(`/api/projects/${p}/ai/generate-test-cases`).set(bearer(a.token)).send({ text: 'Some requirement text' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
    } finally {
      await noAi.close();
    }
  });
});
