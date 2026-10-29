import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { bearer, createProject, createTestApp, setupAdmin, type TestApp } from './helpers.js';

let t: TestApp;
let admin: { token: string; userId: string };
let clientDir: string;

beforeAll(async () => {
  clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibutest-client-'));
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>IbuTest</title>');
  fs.mkdirSync(path.join(clientDir, 'assets'));
  fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(clientDir, '.env'), 'SECRET=should-never-be-served');
  t = await createTestApp({ CLIENT_DIST_DIR: clientDir, CORS_ORIGINS: 'https://app.ibutest.dev' });
  admin = await setupAdmin(t);
});
afterAll(async () => {
  await t.close();
  fs.rmSync(clientDir, { recursive: true, force: true });
});

describe('security headers', () => {
  it('sets a strict CSP and hardening headers on every response', async () => {
    for (const url of ['/', '/api/health', '/p/123/test-cases']) {
      const res = await t.request.get(url).set('Accept', 'text/html');
      const csp = res.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(res.headers['permissions-policy']).toContain('camera=()');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('marks API responses as non-cacheable', async () => {
    const res = await t.request.get('/api/auth/me').set(bearer(admin.token)).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('enables HSTS only for HTTPS deployments', async () => {
    const res = await t.request.get('/api/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    const https = await createTestApp({ PUBLIC_URL: 'https://ibutest.example.org' });
    try {
      const r = await https.request.get('/api/health');
      expect(r.headers['strict-transport-security']).toContain('max-age=63072000');
      expect(r.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    } finally {
      await https.close();
    }
  });
});

describe('CORS', () => {
  it('allows only configured origins', async () => {
    const ok = await t.request.options('/api/auth/login').set('Origin', 'https://app.ibutest.dev').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.ibutest.dev');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const evil = await t.request.options('/api/auth/login').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();

    const reflected = await t.request.get('/api/health').set('Origin', 'null');
    expect(reflected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses wildcard CORS configuration at startup', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: 'x'.repeat(48), ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), CORS_ORIGINS: '*' }),
    ).toThrow(/Wildcard/);
  });
});

describe('configuration validation', () => {
  const base = { JWT_SECRET: 'k'.repeat(64), ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };

  it('requires strong secrets', () => {
    expect(() => loadConfig({ ENCRYPTION_KEY: base.ENCRYPTION_KEY })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: 'bm90LTMyLWJ5dGVz' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects placeholder secrets and insecure cookies in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: `change-me-${'x'.repeat(60)}` })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    const prod = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(prod.auth.cookieSecure).toBe(true);
  });

  it('never includes secret values in error messages', () => {
    try {
      loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: `example-${'s3cr3t'.repeat(10)}` });
    } catch (err) {
      expect((err as Error).message).not.toContain('s3cr3t');
    }
  });

  it('uses Secure cookies with the __Secure- prefix in production', async () => {
    const prod = await createTestApp({ NODE_ENV: 'production', SETUP_TOKEN: 'setup-token-for-tests-1234', JWT_SECRET: 'p'.repeat(64) });
    try {
      const res = await prod.request.post('/api/auth/setup').send({
        name: 'Admin',
        email: 'root@ibutest.dev',
        password: 'Correct-Horse-Battery-9',
        setupToken: 'setup-token-for-tests-1234',
      });
      expect(res.status).toBe(201);
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]!;
      expect(cookie).toMatch(/^__Secure-ibt_rt=/);
      expect(cookie).toMatch(/; Secure/);
    } finally {
      await prod.close();
    }
  });

  it('disables HTTP setup in production unless a setup token is configured', async () => {
    const prod = await createTestApp({ NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(64) });
    try {
      await prod.request
        .post('/api/auth/setup')
        .send({ name: 'Admin', email: 'root@ibutest.dev', password: 'Correct-Horse-Battery-9' })
        .expect(403);
    } finally {
      await prod.close();
    }
  });
});

describe('exposed files', () => {
  it('serves the SPA but never dotfiles, source or git metadata', async () => {
    await t.request.get('/').set('Accept', 'text/html').expect(200);
    await t.request.get('/assets/app.js').expect(200);
    for (const url of ['/.env', '/.git/config', '/.git/HEAD', '/assets/.env', '/server/src/app.ts', '/package.json', '/../.env', '/api/.env']) {
      const res = await t.request.get(url).set('Accept', 'text/html');
      expect(res.status, url).toBe(404);
      expect(res.text).not.toContain('should-never-be-served');
    }
  });

  it('publishes security.txt', async () => {
    const res = await t.request.get('/.well-known/security.txt').expect(200);
    expect(res.text).toContain('Contact:');
    expect(res.text).toContain('Expires:');
  });
});

describe('input handling', () => {
  it('stores XSS payloads as inert text and serves them as JSON', async () => {
    const projectId = await createProject(t, admin.token, 'XSS');
    const payload = '<img src=x onerror=alert(1)><script>alert(document.cookie)</script>';
    const created = await t.request
      .post(`/api/projects/${projectId}/test-cases`)
      .set(bearer(admin.token))
      .send({ title: payload, description: payload, steps: [{ action: payload }] })
      .expect(201);
    const res = await t.request.get(`/api/projects/${projectId}/test-cases/${created.body.testCase.id}`).set(bearer(admin.token)).expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.testCase.title).toBe(payload); // React renders it as text; never as HTML
  });

  it('strips control and bidi-override characters', async () => {
    const projectId = await createProject(t, admin.token, 'CTRL');
    const res = await t.request
      .post(`/api/projects/${projectId}/requirements`)
      .set(bearer(admin.token))
      .send({ title: 'Pay\u0000ment ‮gnp.exe‬ flow' })
      .expect(201);
    expect(res.body.requirement.title).toBe('Payment gnp.exe flow');
  });

  it('treats SQL metacharacters in search as plain text', async () => {
    const projectId = await createProject(t, admin.token, 'SQLI');
    for (const search of ["' OR 1=1 --", '%', '_', '\\', "'; DROP TABLE users; --"]) {
      const res = await t.request.get(`/api/projects/${projectId}/test-cases`).query({ search }).set(bearer(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
  });

  it('rejects oversized bodies and duplicated query parameters', async () => {
    const projectId = await createProject(t, admin.token, 'BIG');
    const huge = await t.request
      .post(`/api/projects/${projectId}/test-cases`)
      .set(bearer(admin.token))
      .send({ title: 'x', description: 'a'.repeat(1_100_000) });
    expect(huge.status).toBe(413);
    const dup = await t.request.get(`/api/projects/${projectId}/test-cases?page=1&page=2`).set(bearer(admin.token));
    expect(dup.status).toBe(400);
  });

  it('neutralises spreadsheet formulas in CSV exports', async () => {
    const projectId = await createProject(t, admin.token, 'CSV');
    await t.request
      .post(`/api/projects/${projectId}/test-cases`)
      .set(bearer(admin.token))
      .send({ title: '=HYPERLINK("http://evil.example","click")' })
      .expect(201);
    const res = await t.request.get(`/api/projects/${projectId}/reports/export/test-cases.csv`).set(bearer(admin.token)).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  });

  it('returns safe JSON errors without internals', async () => {
    const res = await t.request.get('/api/does-not-exist').set(bearer(admin.token)).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
});

describe('rate limiting', () => {
  it('throttles credential endpoints per IP', async () => {
    const limited = await createTestApp({ RATE_LIMIT_AUTH_PER_15MIN: '3' });
    try {
      const attempt = () => limited.request.post('/api/auth/login').send({ email: 'a@ibutest.dev', password: 'nope-nope-nope' });
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.headers['ratelimit-policy'] ?? blocked.headers['ratelimit']).toBeTruthy();
    } finally {
      await limited.close();
    }
  });

  it('applies a global API limit', async () => {
    const limited = await createTestApp({ RATE_LIMIT_API_PER_MIN: '10' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await limited.request.get('/api/health')).status);
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
