# IbuTest

**AI-assisted test case and test management**, inspired by Tricentis qTest, built security-first.
One codebase runs as a **web app / installable PWA**, a **desktop app (.exe / .dmg / AppImage)**
and **iOS / Android apps**.

| | |
|---|---|
| Requirements | Folders, priorities, statuses, traceability to test cases, coverage |
| Test design | Versioned test cases with steps & expected results, approval workflow, clone, tags, automation keys |
| Test execution | Releases → test cycles → test runs, step-by-step execution with timer, history, assignment |
| Defects | Raised from failed runs (pre-filled), severity/priority workflow, links back to runs and cases |
| Reports | Dashboard (coverage, automation, cycle progress, 14-day execution trend), traceability matrix, CSV exports |
| AI assistant (Claude) | Generate test cases from requirements, quality review of a test case, defect report drafts, release-readiness summaries |
| Automation | Project-scoped API tokens; CI uploads results (`POST /api/automation/v1/results`) mapped by automation key |
| Administration | Users, roles, temporary passwords, lock/unlock, MFA reset, session revocation, full audit log |
| Security | Argon2id, TOTP 2FA, rotating refresh tokens with theft detection, RBAC, strict CSP, rate limits - see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) |

Docs: [qTest analysis & feature parity](docs/QTEST_ANALYSIS.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Deployment (web, desktop, mobile)](docs/DEPLOYMENT.md) ·
[Security audit](docs/SECURITY_AUDIT.md) · [Security policy](SECURITY.md)

## Quick start (development)

Requirements: Node.js 22.12+ (see `.nvmrc`). No database server needed - development uses
the embedded PostgreSQL engine (PGlite).

```bash
npm ci                 # install all workspaces
npm run setup:env      # creates .env with strong random secrets (never commit it)
npm run dev            # API on http://127.0.0.1:4000, web app on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173 and create the first administrator on the setup screen
(use the `SETUP_TOKEN` value printed in `.env`).

To enable the AI assistant, add `ANTHROPIC_API_KEY=...` to `.env` (server-side only - the key
is never sent to browsers, desktop or mobile clients) and restart.

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev` | API + web client with hot reload |
| `npm test` | Server test suite (64 tests; set `TEST_DATABASE_URL` to also run against PostgreSQL) |
| `npm run test:e2e` / `npm run test:e2e:desktop` | Browser and Electron end-to-end smoke tests (see headers of `e2e/*.mjs`) |
| `npm run lint` / `npm run typecheck` | ESLint (incl. security rules) / TypeScript |
| `npm run build` | Production builds of the web client and API server |
| `npm start` | Run the built server (serves the web client when `CLIENT_DIST_DIR` is set) |
| `npm run audit:security` | Automated security audit (dependencies, secrets in git history, headers, Electron/mobile hardening …) |
| `npm run audit:secrets` | Secret scan of the working tree and the full git history |
| `npm run create-admin` | Create/promote an administrator from the CLI (`ADMIN_EMAIL=... npm run create-admin`) |
| `npm run desktop:dev` / `npm run desktop:dist` | Run / package the Electron desktop app |
| `npm run mobile:sync` | Build the web client and sync it into the iOS/Android projects |

## Repository layout

```
shared/    zod validation schemas, constants and API types used by server and client
server/    Express 5 API (Drizzle ORM, PostgreSQL or embedded PGlite), tests, migrations
client/    React 19 + Vite web client (also bundled into desktop and mobile apps), PWA
desktop/   Electron shell: team-server mode or offline local workspace, electron-builder config
mobile/    Capacitor iOS and Android projects
scripts/   dev launcher, env generator, secret scanner, security audit, icon renderer
e2e/       browser and desktop end-to-end smoke tests (Playwright)
docs/      analysis, architecture, deployment and security audit
```

## Platforms at a glance

- **Web / PWA** - deploy with Docker (`docker compose up -d`), serve over HTTPS; users can
  "Install app" from the browser on desktop, Android and iOS (Add to Home Screen).
- **Desktop (.exe)** - `npm run desktop:dist` or the *Desktop apps* GitHub workflow builds the
  Windows installer + portable `.exe`, macOS `.dmg` and Linux AppImage/`.deb`. Users either
  connect to their team server or use a private local workspace that works offline.
- **iOS / Android** - native Capacitor apps (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#mobile-apps-ios-and-android));
  the *Mobile apps* workflow builds an Android APK and an iOS simulator build.

## License

Proprietary - all rights reserved (change `license` in `package.json` if you open-source it).
"qTest" is a trademark of Tricentis; IbuTest is an independent product and is not affiliated with Tricentis.
