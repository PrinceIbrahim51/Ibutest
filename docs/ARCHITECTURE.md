# Architecture

## Overview

```
                 ┌──────────────── one React/Vite client bundle ────────────────┐
                 │                                                              │
 Browser / PWA ──┤  same-origin /api      Electron (team server: loads the       │
                 │                         server URL; local: embedded server)  │
 iOS / Android ──┤  Capacitor app → native HTTP → https://your-server/api       │
                 └──────────────────────────────────────────────────────────────┘
                                         │ HTTPS (Bearer access token +
                                         │ httpOnly refresh cookie)
                                         ▼
               ┌────────────────── IbuTest API (Express 5, Node 22) ──────────────────┐
               │ helmet/CSP · CORS allow-list · rate limits · zod validation           │
               │ auth (argon2id, JWT + rotating refresh, TOTP) · RBAC · audit log      │
               │ modules: projects · folders · requirements · test cases · execution   │
               │          defects · reports/exports · attachments · automation · AI    │
               └───────┬─────────────────────────────┬─────────────────────┬───────────┘
                       │ Drizzle ORM (parameterised)  │ files (0600)         │ HTTPS
                       ▼                              ▼                      ▼
        PostgreSQL 17 (prod) / PGlite (dev,      UPLOAD_DIR             Claude API
        desktop local mode) - same SQL schema    (attachments)          (server-side key)
```

## Packages (npm workspaces)

| Package | Responsibility |
|---|---|
| `shared` | Constants (roles, statuses), zod request schemas (single source of validation for server and client forms), text sanitiser, CSV encoder, API response types |
| `server` | Express app factory (`createApp(ctx)`), Drizzle schema + migrations, route modules, middleware, AI service, tests |
| `client` | React 19 SPA (React Router, TanStack Query), design system in plain CSS, PWA manifest + service worker |
| `desktop` | Electron main process, sandboxed preload, launcher page, electron-builder config |
| `mobile` | Capacitor configuration and the generated iOS/Android projects |

## Data model

```
users ─┬─< sessions            (refresh token hashes, rotation, revocation)
       ├─< api_tokens >─ projects   (hashed project-scoped automation tokens)
       └─< project_members >─ projects (role: viewer|tester|lead|manager)

projects ─┬─< folders (kind: requirement|test_case, self-referencing tree)
          ├─< requirements ─< requirement_links >─ test_cases
          ├─< test_cases ─┬─< test_steps
          │               └─< test_case_versions (JSON snapshots)
          ├─< releases ─< test_cycles ─< test_runs ─< test_logs (step results JSON)
          ├─< defects (→ test_run, test_case, assignee, reporter)
          └─< attachments (entity_type + entity_id)

audit_logs (no FKs - survives deletions) · ai_usage (token accounting)
```

Human-readable keys (`RQ-12`, `TC-7`, `DF-3`) come from per-project counters incremented
atomically with `UPDATE … RETURNING`. Enums are PostgreSQL enum types, so invalid values are
rejected by the database as well as by the API.

## Request pipeline

1. `pino-http` assigns a request id (returned as `X-Request-Id`); logs never contain bodies,
   cookies or authorization headers.
2. `helmet` + Permissions-Policy headers; `Cache-Control: no-store` on all API responses.
3. CORS allow-list → global rate limit → cookie parser → JSON body parser (1 MB; 5 MB for
   automation uploads).
4. Route-level: `authenticate` (JWT signature + live session lookup) → `loadProject` (membership,
   404 for non-members) → `requireProjectRole(min)` → handler.
5. Handlers validate every body/query with zod (`strictObject` rejects unknown fields) and
   scope every query by `project_id` (prevents IDOR).
6. Central error handler maps errors to `{ error: { code, message }, requestId }`.

## Authentication

```
POST /auth/login ──► argon2id verify ──► [MFA?] ──► POST /auth/mfa/verify (TOTP, replay-checked)
        │                                                   │
        └──────────────► session row + tokens ◄─────────────┘
                         access JWT (15 min, memory only, Authorization: Bearer)
                         refresh token (256-bit random, httpOnly SameSite=Strict cookie,
                                        path /api/auth, stored as SHA-256 hash)

POST /auth/refresh (needs X-Requested-With header + allowed Origin)
   current hash matches  → rotate (old hash kept as "previous")
   previous hash matches → < 30 s after rotation: multi-tab race (409, client retries)
                           otherwise: token theft → session revoked, audit event
```

Every authenticated request checks the session row, so logout, password changes, admin
deactivation and "sign out other sessions" take effect immediately.

## Platforms

- **Web/PWA**: the server serves `client/dist` (immutable hashed assets, `no-cache` HTML) with an
  SPA fallback limited to extension-less paths. The service worker caches only the app shell.
- **Desktop**: the main window loads either the team server URL (HTTPS only) or the embedded
  server started in-process on `127.0.0.1:<random>` with PGlite in the user profile. Secrets for
  local mode are generated once and stored with Electron `safeStorage` (OS keychain).
- **Mobile**: the client bundle ships inside the app; the user enters the server URL once.
  `CapacitorHttp` routes API calls through the native HTTP stack, so the httpOnly refresh
  cookie works without third-party-cookie problems and without opening CORS.

## AI service

`server/src/modules/ai/service.ts` wraps the Anthropic SDK (`client.beta.messages.parse` with a
zod output schema, server-side refusal fallback, adaptive thinking with configurable effort).
Routes in `modules/ai/routes.ts` load data with the caller's project permissions, enforce
role/feature/quota gates, and record token usage. The service is injected through
`AppContext`, so tests use a deterministic fake.
