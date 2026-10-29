import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bearer, createProject, createTestApp, createUser, setupAdmin, type TestApp } from './helpers.js';

let t: TestApp;
let admin: { token: string; userId: string };
let viewer: { token: string; userId: string };
let tester: { token: string; userId: string };
let lead: { token: string; userId: string };
let outsider: { token: string; userId: string };
let projectA: string;
let projectB: string;

beforeAll(async () => {
  t = await createTestApp();
  admin = await setupAdmin(t);
  [viewer, tester, lead, outsider] = await Promise.all([
    createUser(t, admin.token, 'viewer@ibutest.dev'),
    createUser(t, admin.token, 'tester@ibutest.dev'),
    createUser(t, admin.token, 'lead@ibutest.dev'),
    createUser(t, admin.token, 'outsider@ibutest.dev'),
  ]);
  projectA = await createProject(t, admin.token, 'ALPHA');
  projectB = await createProject(t, admin.token, 'BRAVO');
  await addMember(t, admin.token, projectA, viewer.userId, 'viewer');
  await addMember(t, admin.token, projectA, tester.userId, 'tester');
  await addMember(t, admin.token, projectA, lead.userId, 'lead');
  await addMember(t, admin.token, projectB, outsider.userId, 'manager');
});
afterAll(async () => {
  await t.close();
});

describe('admin routes', () => {
  it('are forbidden for non-admins', async () => {
    for (const path of ['/api/admin/users', '/api/admin/audit-logs', '/api/admin/system']) {
      const res = await t.request.get(path).set(bearer(tester.token));
      expect(res.status).toBe(403);
    }
    await t.request.post('/api/admin/users').set(bearer(lead.token)).send({ email: 'x@ibutest.dev', name: 'X' }).expect(403);
    await t.request.get('/api/admin/users').expect(401);
  });

  it('work for admins and never leak password hashes or MFA secrets', async () => {
    const res = await t.request.get('/api/admin/users').set(bearer(admin.token)).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash|password_hash|mfaSecret|argon2/);
  });

  it('prevent an admin from locking themselves out', async () => {
    await t.request.patch(`/api/admin/users/${admin.userId}`).set(bearer(admin.token)).send({ role: 'user' }).expect(400);
    await t.request.patch(`/api/admin/users/${admin.userId}`).set(bearer(admin.token)).send({ isActive: false }).expect(400);
  });

  it('can require MFA for administrators', async () => {
    const strict = await createTestApp({ ADMIN_REQUIRE_MFA: 'true' });
    try {
      const a = await setupAdmin(strict);
      const res = await strict.request.get('/api/admin/users').set(bearer(a.token)).expect(403);
      expect(res.body.error.code).toBe('MFA_REQUIRED');
    } finally {
      await strict.close();
    }
  });
});

describe('project access control', () => {
  it('hides projects from non-members (404, not 403)', async () => {
    await t.request.get(`/api/projects/${projectA}`).set(bearer(outsider.token)).expect(404);
    const list = await t.request.get('/api/projects').set(bearer(outsider.token)).expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([projectB]);
  });

  it('only admins create projects', async () => {
    await t.request.post('/api/projects').set(bearer(lead.token)).send({ key: 'NOPE', name: 'Nope' }).expect(403);
  });

  it('enforces role hierarchy: viewer < tester < lead < manager', async () => {
    const base = `/api/projects/${projectA}`;
    await t.request.get(`${base}/test-cases`).set(bearer(viewer.token)).expect(200);
    await t.request.post(`${base}/test-cases`).set(bearer(viewer.token)).send({ title: 'x' }).expect(403);

    const created = await t.request.post(`${base}/test-cases`).set(bearer(tester.token)).send({ title: 'Login works' }).expect(201);
    const tcId = created.body.testCase.id;
    await t.request.delete(`${base}/test-cases/${tcId}`).set(bearer(tester.token)).expect(403);
    await t.request.post(`${base}/test-cases/${tcId}/approve`).set(bearer(tester.token)).expect(403);
    await t.request.post(`${base}/test-cases/${tcId}/approve`).set(bearer(lead.token)).expect(200);

    await t.request.post(`${base}/releases`).set(bearer(tester.token)).send({ name: 'R1' }).expect(403);
    await t.request.post(`${base}/releases`).set(bearer(lead.token)).send({ name: 'R1' }).expect(201);

    await t.request.put(`${base}/members`).set(bearer(lead.token)).send({ userId: outsider.userId, role: 'viewer' }).expect(403);
    await t.request.patch(base).set(bearer(lead.token)).send({ name: 'Renamed' }).expect(403);
    await t.request.delete(`${base}/test-cases/${tcId}`).set(bearer(lead.token)).expect(204);
  });

  it('prevents IDOR: items of project A are not reachable through project B', async () => {
    const tc = await t.request.post(`/api/projects/${projectA}/test-cases`).set(bearer(tester.token)).send({ title: 'Secret' }).expect(201);
    const id = tc.body.testCase.id;
    // outsider is manager of B and tries to read/modify A's test case through B's URL.
    await t.request.get(`/api/projects/${projectB}/test-cases/${id}`).set(bearer(outsider.token)).expect(404);
    await t.request.patch(`/api/projects/${projectB}/test-cases/${id}`).set(bearer(outsider.token)).send({ title: 'pwn' }).expect(404);
    await t.request.delete(`/api/projects/${projectB}/test-cases/${id}`).set(bearer(outsider.token)).expect(404);
    // linking A's test case from a requirement in B is rejected
    const req = await t.request.post(`/api/projects/${projectB}/requirements`).set(bearer(outsider.token)).send({ title: 'R' }).expect(201);
    await t.request
      .post(`/api/projects/${projectB}/requirements/${req.body.requirement.id}/links`)
      .set(bearer(outsider.token))
      .send({ testCaseIds: [id] })
      .expect(400);
  });

  it('treats malformed ids as not found (never a server error)', async () => {
    for (const bad of ['1', "1' OR '1'='1", '../../etc/passwd', '00000000-0000-0000-0000-000000000000']) {
      const res = await t.request.get(`/api/projects/${encodeURIComponent(bad)}`).set(bearer(admin.token));
      expect(res.status).toBe(404);
    }
    const res = await t.request.get(`/api/projects/${projectA}/test-cases/not-a-uuid`).set(bearer(admin.token));
    expect(res.status).toBe(404);
  });

  it('archived projects are read-only', async () => {
    const p = await createProject(t, admin.token, 'ARCH');
    await t.request.patch(`/api/projects/${p}`).set(bearer(admin.token)).send({ isArchived: true }).expect(200);
    const res = await t.request.post(`/api/projects/${p}/test-cases`).set(bearer(admin.token)).send({ title: 'x' });
    expect(res.status).toBe(409);
    await t.request.get(`/api/projects/${p}/test-cases`).set(bearer(admin.token)).expect(200);
    await t.request.patch(`/api/projects/${p}`).set(bearer(admin.token)).send({ isArchived: false }).expect(200);
  });

  it('user directory lookup is limited to admins and managers', async () => {
    await t.request.get('/api/users/lookup?q=a').set(bearer(tester.token)).expect(403);
    await t.request.get('/api/users/lookup?q=a').set(bearer(outsider.token)).expect(200);
  });

  it('keeps at least one manager per project', async () => {
    const p = await createProject(t, admin.token, 'MGR');
    await t.request.put(`/api/projects/${p}/members`).set(bearer(admin.token)).send({ userId: admin.userId, role: 'viewer' }).expect(400);
  });
});
