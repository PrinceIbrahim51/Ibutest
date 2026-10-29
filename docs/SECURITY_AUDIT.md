# Security audit

Audit date: 2026-10-29 · Scope: API server, web client/PWA, Electron desktop app, Capacitor
mobile apps, build/CI configuration and the complete git history.

Re-run the automated part at any time with `npm run build && npm run audit:security`.

## 1. Results summary

| Check | Result |
|---|---|
| `npm audit` (all workspaces, prod + dev) | **0 vulnerabilities** |
| Secret scan - working tree **and every commit** (`scripts/scan-secrets.mjs`) | **Clean** (also verified to detect a planted key and a committed `.env.production`) |
| Manual review of all 126 secret-like lines in the repository | Only placeholders (`REPLACE_ME`) and clearly fake test fixtures |
| ESLint with `eslint-plugin-security` + XSS sink bans | **0 errors, 0 warnings** |
| Automated audit script (`scripts/security-audit.mjs`) | **28 / 28 checks passed** |
| Server test suite (auth, access control, security, domain) | **64 / 64 passed** on PGlite **and** on PostgreSQL 16 |
| Browser end-to-end run against the production build (`npm run test:e2e`, Chromium) | **16 / 16** flows passed, **no CSP violations or page errors** |
| Electron app driven in a real Electron 45 runtime (`npm run test:e2e:desktop`) | **8 / 8** checks: renderer has no `require`/`process`; external navigation blocked; `window.open` denied; `http://` server URLs refused; local workspace boots with a one-time setup token; camera permission not granted |
| Packaged desktop binary (`@electron/fuses read`) | All 8 hardening fuses applied as configured |

Not available in this environment: GitHub secret scanning (requires GitHub Advanced Security
on the repository) and Docker image scanning (no Docker daemon). Both gaps are covered in CI:
`.github/workflows/security.yml` runs **gitleaks** over the full history, **CodeQL**
(`security-extended`), dependency review and a weekly `npm audit`; `ci.yml` builds the Docker
image and smoke-tests it (non-root user, health check, `/.env` → 404, CSP present) and runs
both end-to-end suites.

## 2. Checklist

| # | Requirement | How IbuTest meets it | Evidence |
|---|---|---|---|
| 1 | **Hide API keys** | The Claude API key exists only in server env (`ANTHROPIC_API_KEY`); clients call the IbuTest API, never the provider. Desktop local mode stores the key encrypted via the OS keychain (`safeStorage`). `.env*` git-ignored, `.dockerignore` excludes them. Logger redacts `authorization`, cookies, passwords, tokens, `apiKey`. | `server/src/config/env.ts`, `server/src/lib/logger.ts`, `desktop/src/main.ts`; audit check "AI provider key/SDK is server-side only" |
| 2 | **Check env variables** | All configuration is validated with zod at start-up; boot aborts on invalid values. Production refuses placeholder secrets, `JWT_SECRET` < 48 chars, a non-32-byte `ENCRYPTION_KEY`, `COOKIE_SECURE=false`, wildcard CORS, Postgres without `DATABASE_URL`. Error messages never echo secret values. `npm run setup:env` generates strong random secrets (file mode 600). | `server/src/config/env.ts`; tests in `server/test/security.test.ts` ("configuration validation") |
| 3 | **Protect admin routes** | `/api/admin/*` requires a valid session **and** the global admin role (`requireAdmin`); optional `ADMIN_REQUIRE_MFA=true` blocks admins without 2FA. Admins cannot demote/deactivate themselves; the last active admin cannot be removed. Every admin action is audit-logged. Project creation/deletion is admin-only. | `server/src/modules/admin/routes.ts`, `middleware/auth.ts`; tests "admin routes" in `access.test.ts` |
| 4 | **Proper authentication** | Argon2id password hashing; generic login errors + dummy hash to defeat user enumeration/timing; lockout after 5 failures (15 min); TOTP 2FA with replay protection and AES-256-GCM-encrypted seeds; 15-min access JWT (HS256 pinned, issuer/audience checked) held only in memory; 256-bit refresh token in an `httpOnly`, `Secure`, `SameSite=Strict`, path-scoped cookie, stored hashed, rotated on every use with **reuse detection** (replayed old token ⇒ whole session revoked); idle (12 h) and absolute (7 d) session limits; password change / MFA change / deactivation revoke sessions immediately; admin-created accounts must change their password; setup endpoint locked behind `SETUP_TOKEN` in production + advisory lock against races. | `modules/auth/*`, `lib/password.ts`, `lib/tokens.ts`, `lib/totp.ts`; 18 tests in `auth.test.ts` (forged, tampered and `alg:none` JWTs, rotation/reuse, lockout, MFA replay, idle expiry …) |
| 5 | **Access control** | Deny-by-default: every router is behind `authenticate`; project data behind `loadProject` (non-members get **404**, so project existence is not disclosed) and `requireProjectRole` (viewer < tester < lead < manager). Every query is scoped by `project_id` (IDOR-proof), cross-project links are rejected, malformed IDs return 404. Archived projects are read-only. Automation tokens are project-scoped, hashed, expiring, revocable and stop working when the owner loses tester access. User directory lookup restricted to admins/managers. | `middleware/project.ts`, all route modules; tests "project access control" + automation tests in `domain.test.ts` |
| 6 | **Sanitize forms** | Every body and query parsed with zod `strictObject` (unknown fields such as `role` rejected ⇒ no mass assignment), with type, enum, length and format limits. All free text is NFC-normalised and stripped of control and bidi-override characters (Trojan-Source spoofing). Search input escapes `%`/`_`. Duplicate query params rejected. Body limit 1 MB (5 MB automation). File uploads are type-checked by **content sniffing**, size-limited and stored under random names. | `shared/src/schemas.ts`, `shared/src/text.ts`, `modules/attachments/routes.ts`; tests "input handling" and "attachments" |
| 7 | **XSS protection** | No HTML rendering anywhere: user content is stored and rendered as plain text by React (auto-escaped). ESLint forbids `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`. Strict CSP: `script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, no `unsafe-inline`/`unsafe-eval` (also a build-time meta CSP for the mobile bundle). Attachments are served as `attachment` with `nosniff` and a `sandbox` CSP; HTML/SVG uploads are rejected. AI output is schema-validated and shown as text. | `eslint.config.js`, `middleware/security.ts`, `client/vite.config.ts`; tests "stores XSS payloads as inert text", "rejects disguised or dangerous files"; E2E run showed no CSP violations |
| 8 | **Rate limiting** | Per-IP global limit (300/min), credential endpoints (20 per 15 min), token refresh, per-user AI limit (30/h) plus a daily AI token quota, per-user uploads, per-token automation uploads. Standard `RateLimit` headers; `TRUST_PROXY` must match the proxy chain so limits use the real client IP. | `middleware/rateLimit.ts`, `modules/ai/routes.ts`; tests "rate limiting" |
| 9 | **Secure API endpoints** | Bearer tokens (CSRF-immune) for the API; cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) additionally require the `X-Requested-With: IbuTest` header and an allowed `Origin`. `Cache-Control: no-store` on all API responses. Uniform JSON errors with a request id; database errors mapped to safe codes. Slow-client timeouts on the HTTP server. | `app.ts`, `modules/auth/routes.ts`, `middleware/errors.ts`, `server.ts`; tests "requires the anti-CSRF header…" |
| 10 | **CORS settings** | Explicit allow-list only (`CORS_ORIGINS` + `PUBLIC_URL`); unknown origins and `Origin: null` receive no CORS headers; `*` is refused at start-up. Same-origin web, desktop and mobile (native HTTP) need no extra origins. | `middleware/security.ts`; tests "CORS" |
| 11 | **Security headers** | Helmet: CSP (above), HSTS 2 years when served over HTTPS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`, `Origin-Agent-Cluster`; `Permissions-Policy` disables camera, microphone, geolocation, payment, USB, serial, HID, display capture; `X-Powered-By` removed. | `middleware/security.ts`; tests "security headers" |
| 12 | **Debug mode off** | `NODE_ENV=production` in Docker/desktop; no stack traces or SQL in responses; no source maps in the web build; Electron DevTools disabled in packaged builds and the `--inspect`/`ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS` fuses are off; mobile WebView debugging disabled; logging at `info` with redaction. | `middleware/errors.ts`, `client/vite.config.ts`, `desktop/electron-builder.config.cjs`, `mobile/capacitor.config.ts`; audit checks "Debug", "Desktop", "Mobile" |
| 13 | **Update dependencies** | All packages at their latest stable releases at audit time and pinned to exact versions with a committed lockfile; transitive `esbuild` in `drizzle-kit` forced to a patched version via `overrides`; Dependabot (npm, GitHub Actions, Docker, Gradle) and a weekly scheduled `npm audit`; `npm audit signatures` verifies registry signatures in CI. | `package.json`, `.github/dependabot.yml`, `.github/workflows/*.yml`; audit check "All dependency versions pinned exactly" |
| 14 | **Remove unused packages** | Minimal dependency set (no UI framework, no ORM extras); every declared package is checked for use by the audit script; desktop/mobile toolchains are excluded from the server image (`npm ci --omit=dev --workspace @ibutest/server`). | audit check "No unused packages declared"; `Dockerfile` |
| 15 | **Check exposed files** | Only `client/dist` is served; dotfiles ignored; SPA fallback limited to extension-less paths, so `/.env`, `/.git/config`, `/assets/.env`, `/server/src/*`, `/package.json` all return 404; no directory listing; hashed assets immutable, HTML `no-cache`; `security.txt` published; Docker context excludes `.env`, `.git`, data. | `app.ts`, `.dockerignore`; test "serves the SPA but never dotfiles, source or git metadata" |
| 16 | **Secure database** | Drizzle ORM with parameterised queries only (no raw SQL concatenation); DB-level enums, foreign keys, unique constraints; secrets stored hashed (refresh/API tokens: SHA-256 of 256-bit randoms) or encrypted (TOTP seeds: AES-256-GCM); TLS options (`DATABASE_SSL=verify-full` + CA file); `statement_timeout`; DB not published by Docker Compose (internal network); local PGlite data directory created with mode 0700. | `db/schema.ts`, `db/index.ts`, `docker-compose.yml`; tests "treats SQL metacharacters in search as plain text" |
| 17 | **Hash passwords** | Argon2id, m = 19 MiB, t = 2, p = 1 (OWASP Password Storage Cheat Sheet); 12-128 character policy with common-password and low-variety rejection; passwords never logged or returned. | `lib/password.ts`; test "never stores plaintext passwords (argon2id hashes)" |
| 18 | **Scan git for leaked secrets** | `npm run audit:secrets` scans the working tree **and every commit on every branch** for 14 secret types (cloud keys, AI keys, GitHub/Slack/npm tokens, private keys, JWTs, credentialed DB URLs, high-entropy assignments) and for committed sensitive files (`.env*`, keys, keystores); `--staged` mode for a pre-commit hook; gitleaks in CI. Result: clean. | `scripts/scan-secrets.mjs`, `.gitleaks.toml`, `.github/workflows/security.yml` |
| 19 | **Full security audit** | This document, the 28-check audit script, 64 security-focused tests, browser and Electron end-to-end suites, CI gates (lint, typecheck, tests on two databases, audit, gitleaks, CodeQL, dependency review, Docker smoke test, end-to-end). | `scripts/security-audit.mjs`, `server/test/*`, `e2e/*`, `.github/workflows/*` |

### Desktop (Electron) controls

Sandboxed renderers, `contextIsolation`, no Node integration (verified at runtime: no
`require`/`process` in the page), minimal `contextBridge` API with **sender-origin checks** on
every IPC handler, custom `app://` protocol instead of `file://` with its own CSP, navigation
locked to the active origin (`will-navigate`/`will-redirect`), `window.open` denied (explicit
`https:` links open in the system browser), `<webview>` blocked, all permission requests
denied except clipboard writes, single-instance lock, HTTPS-only team server URLs, TLS
certificate errors never overridden, and fuses: `RunAsNode` off, `NODE_OPTIONS` off, `--inspect`
off, cookie encryption on, embedded ASAR integrity validation on, only-load-from-ASAR on,
extra `file://` privileges off.

### Mobile (Capacitor) controls

Bundled code only (no remote code loading), `allowNavigation: []`, cleartext disabled,
WebView debugging disabled, Android `allowBackup=false` + data-extraction rules, release builds
trust only system CAs (no user-installed MITM certificates), iOS App Transport Security left at
its secure default, HTTPS-only server URL, refresh cookie kept in the native cookie store.

## 3. Issues found and fixed during the audit

| Severity | Finding | Fix |
|---|---|---|
| Moderate (dev only) | `esbuild ≤ 0.24.2` (GHSA-67mh-4wv8-2f99) pulled in by `drizzle-kit` | Forced the patched release through npm `overrides`; `npm audit` now clean |
| Low | `GET /assets/.env` returned **500** (static-file 404 mapped as an unhandled error) | Error handler maps framework 4xx errors; regression test added |
| Low | Literal invisible Unicode characters (bidi overrides, BOM, em-space) in source files - the "Trojan Source" pattern | Replaced with `\u` escapes; `eslint-plugin-security` now gates this |
| Low | Desktop IPC sender check compared origins with `URL.origin`, which is `"null"` for custom schemes, so the check could not recognise the launcher | Explicit origin helper for `app://`; verified in Electron |
| Low | Desktop: blocked in-app navigations were handed to the system browser (phishing assist) | Navigations away from the app origin are now silently blocked |
| Info | Deprecated synchronous `safeStorage` API in Electron 45; secrets could be regenerated on decrypt failure | Migrated to the async API; never silently regenerates (would orphan 2FA secrets) |
| Info | `Permissions-Policy` listed features unknown to Chromium | Header cleaned |

## 4. Residual risks and recommendations

1. **Horizontal scaling**: the rate limiter is in-memory per process - use a Redis store before
   running multiple instances.
2. **Identity**: no SSO and no e-mail based password reset yet (admins issue temporary passwords).
   Add OIDC/SAML for enterprise use; enable `ADMIN_REQUIRE_MFA=true` after enrolment.
3. **Account lockout** can be triggered deliberately against a known e-mail (15 min, combined
   with per-IP limits). Monitor `auth.account_locked` events.
4. **Data at rest**: attachments are stored unencrypted on the volume and database encryption is
   an infrastructure concern - use encrypted disks / managed PostgreSQL with encryption.
5. **Desktop on Linux without a keyring**: Electron falls back to `basic_text` protection for
   `safeStorage`; files are still `0600` in the user's profile. Local mode listens on
   `127.0.0.1` only and requires sign-in, but other OS users on the same machine can reach the
   port.
6. **Code signing** for Windows/macOS/mobile requires your certificates (CI secrets are wired).
7. **Supply chain**: pin GitHub Actions to commit SHAs; the electron-builder toolchain carries
   deprecated transitive packages (`glob@7`, `inflight`) used only at build time, not shipped.
8. **AI data processing**: requirement and test text is sent to the configured AI provider
   when a user invokes an AI feature; ensure a data processing agreement, or disable AI per
   project / server-wide.
9. Add a CSP reporting endpoint and commission an independent penetration test before
   handling production customer data.
