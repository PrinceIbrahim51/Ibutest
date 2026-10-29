import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { Secret, TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '../src/db/schema.js';
import { ADMIN, CSRF, bearer, createTestApp, createUser, refreshCookie, setupAdmin, type TestApp } from './helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('first-run setup', () => {
  it('reports setup state and bootstraps exactly one administrator', async () => {
    const before = await t.request.get('/api/auth/status').expect(200);
    expect(before.body.setupRequired).toBe(true);

    const admin = await setupAdmin(t);
    expect(admin.token).toBeTruthy();

    const again = await t.request.post('/api/auth/setup').send({ ...ADMIN, email: 'second@ibutest.dev' });
    expect(again.status).toBe(409);

    const after = await t.request.get('/api/auth/status').expect(200);
    expect(after.body.setupRequired).toBe(false);
  });

  it('requires the setup token when one is configured', async () => {
    const guarded = await createTestApp({ SETUP_TOKEN: 'a-very-long-setup-token-value' });
    try {
      await guarded.request.post('/api/auth/setup').send(ADMIN).expect(403);
      await guarded.request.post('/api/auth/setup').send({ ...ADMIN, setupToken: 'wrong-token-wrong-token' }).expect(403);
      await guarded.request.post('/api/auth/setup').send({ ...ADMIN, setupToken: 'a-very-long-setup-token-value' }).expect(201);
    } finally {
      await guarded.close();
    }
  });

  it('enforces the password policy', async () => {
    const weak = await t.request.post('/api/auth/setup').send({ ...ADMIN, password: 'short' }).expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    await t.request.post('/api/auth/setup').send({ ...ADMIN, password: 'password1234' }).expect(400);
    await t.request.post('/api/auth/setup').send({ ...ADMIN, password: 'aaaaaaaaaaaaaaaa' }).expect(400);
  });

  it('never stores plaintext passwords (argon2id hashes)', async () => {
    await setupAdmin(t);
    const [row] = await t.ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row?.passwordHash).not.toContain(ADMIN.password);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await setupAdmin(t);
  });

  it('returns the same generic error for unknown users and wrong passwords', async () => {
    const unknown = await t.request.post('/api/auth/login').send({ email: 'nobody@ibutest.dev', password: 'whatever-123456' });
    const wrong = await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password-123' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('issues a short-lived access token and an httpOnly, SameSite=Strict refresh cookie', async () => {
    const res = await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('locks the account after repeated failures, then an admin can unlock it', async () => {
    for (let i = 0; i < 5; i++) {
      await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: `wrong-password-${i}xx` }).expect(401);
    }
    // Correct password is now refused while locked.
    await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(401);
    const [row] = await t.ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    await t.ctx.db.update(users).set({ lockedUntil: null }).where(eq(users.email, ADMIN.email));
    await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
  });

  it('rejects unknown fields (mass assignment) and malformed bodies', async () => {
    await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password, role: 'admin' }).expect(400);
    const bad = await t.request.post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.js|stack/i);
  });
});

describe('tokens and sessions', () => {
  it('rejects forged, tampered and "alg: none" tokens', async () => {
    const admin = await setupAdmin(t);
    await t.request.get('/api/auth/me').set(bearer(admin.token)).expect(200);

    const [h, p, s] = admin.token.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'x', sid: 'y', typ: 'access' })).toString('base64url')}.${s}`;
    await t.request.get('/api/auth/me').set(bearer(tampered)).expect(401);

    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${p}.`;
    await t.request.get('/api/auth/me').set(bearer(none)).expect(401);

    const forged = await new SignJWT({ sid: 'x', typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(admin.userId)
      .setIssuer('ibutest')
      .setAudience('ibutest-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('attacker-chosen-secret-attacker-chosen'));
    await t.request.get('/api/auth/me').set(bearer(forged)).expect(401);
    await t.request.get('/api/auth/me').expect(401);
  });

  it('requires the anti-CSRF header and an allowed Origin to refresh', async () => {
    const admin = await setupAdmin(t);
    await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).expect(403);
    await t.request
      .post('/api/auth/refresh')
      .set('Cookie', admin.cookie)
      .set(CSRF)
      .set('Origin', 'https://evil.example')
      .expect(403);
    const ok = await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).set(CSRF).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    const admin = await setupAdmin(t);
    const first = await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).set(CSRF).expect(200);
    const rotated = refreshCookie(first);
    expect(rotated).not.toBe(admin.cookie);

    // Within the grace window a replay is treated as a multi-tab race.
    const race = await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).set(CSRF);
    expect(race.status).toBe(409);

    // After the grace window, replaying the old token is token theft: whole session is killed.
    await t.ctx.db.update(sessions).set({ rotatedAt: new Date(Date.now() - 120_000) });
    await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).set(CSRF).expect(401);
    await t.request.post('/api/auth/refresh').set('Cookie', rotated).set(CSRF).expect(401);
    await t.request.get('/api/auth/me').set(bearer(first.body.accessToken)).expect(401);
  });

  it('logout revokes the session immediately (access token stops working)', async () => {
    const admin = await setupAdmin(t);
    await t.request.post('/api/auth/logout').set('Cookie', admin.cookie).set(CSRF).expect(204);
    await t.request.get('/api/auth/me').set(bearer(admin.token)).expect(401);
    await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).set(CSRF).expect(401);
  });

  it('expires idle sessions', async () => {
    const admin = await setupAdmin(t);
    await t.ctx.db.update(sessions).set({ lastUsedAt: new Date(Date.now() - 13 * 3600 * 1000) });
    await t.request.post('/api/auth/refresh').set('Cookie', admin.cookie).set(CSRF).expect(401);
  });

  it('changing the password revokes every other session', async () => {
    const admin = await setupAdmin(t);
    const second = await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    await t.request
      .post('/api/auth/change-password')
      .set(bearer(admin.token))
      .send({ currentPassword: ADMIN.password, newPassword: 'Brand-New-Password-77' })
      .expect(204);
    await t.request.get('/api/auth/me').set(bearer(admin.token)).expect(200);
    await t.request.get('/api/auth/me').set(bearer(second.body.accessToken)).expect(401);
  });

  it('forces admin-created users to change their password before using the API', async () => {
    const admin = await setupAdmin(t);
    await t.request
      .post('/api/admin/users')
      .set(bearer(admin.token))
      .send({ email: 'new@ibutest.dev', name: 'New', password: 'Temporary-Pass-123' })
      .expect(201);
    const login = await t.request.post('/api/auth/login').send({ email: 'new@ibutest.dev', password: 'Temporary-Pass-123' }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const blocked = await t.request.get('/api/projects').set(bearer(login.body.accessToken)).expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await t.request.get('/api/auth/me').set(bearer(login.body.accessToken)).expect(200);
  });

  it('deactivating a user ends their sessions immediately', async () => {
    const admin = await setupAdmin(t);
    const user = await createUser(t, admin.token, 'tess@ibutest.dev');
    await t.request.get('/api/projects').set(bearer(user.token)).expect(200);
    await t.request.patch(`/api/admin/users/${user.userId}`).set(bearer(admin.token)).send({ isActive: false }).expect(200);
    await t.request.get('/api/projects').set(bearer(user.token)).expect(401);
    const login = await t.request.post('/api/auth/login').send({ email: 'tess@ibutest.dev', password: user.password });
    expect(login.status).toBe(403);
  });
});

describe('two-factor authentication (TOTP)', () => {
  it('enables MFA, requires a code at login and rejects replayed codes', async () => {
    const admin = await setupAdmin(t);
    const setup = await t.request.post('/api/auth/mfa/setup').set(bearer(admin.token)).expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const totp = new TOTP({ secret: Secret.fromBase32(setup.body.secret), digits: 6, period: 30, algorithm: 'SHA1' });

    await t.request.post('/api/auth/mfa/enable').set(bearer(admin.token)).send({ code: '000000' }).expect(400);
    const enableCode = totp.generate();
    await t.request.post('/api/auth/mfa/enable').set(bearer(admin.token)).send({ code: enableCode }).expect(204);

    const [row] = await t.ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    expect(row?.mfaSecretEnc).toMatch(/^v1:/);
    expect(row?.mfaSecretEnc).not.toContain(setup.body.secret);

    const login = await t.request.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.accessToken).toBeUndefined();

    await t.request.post('/api/auth/mfa/verify').send({ mfaToken: login.body.mfaToken, code: '123456' }).expect(401);
    // The code used to enable MFA cannot be replayed.
    await t.request.post('/api/auth/mfa/verify').send({ mfaToken: login.body.mfaToken, code: enableCode }).expect(401);

    await t.ctx.db.update(users).set({ mfaLastStep: 0 });
    const ok = await t.request.post('/api/auth/mfa/verify').send({ mfaToken: login.body.mfaToken, code: totp.generate() }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    // ...and the same code cannot be used twice.
    await t.request.post('/api/auth/mfa/verify').send({ mfaToken: login.body.mfaToken, code: totp.generate() }).expect(401);
  });

  it('rejects an access token used as an MFA token', async () => {
    const admin = await setupAdmin(t);
    await t.request.post('/api/auth/mfa/verify').send({ mfaToken: admin.token, code: '123456' }).expect(401);
  });
});
