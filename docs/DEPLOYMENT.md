# Deployment guide

## 1. Web application (recommended for teams)

### Docker Compose (PostgreSQL + IbuTest)

```bash
npm run setup:env          # or copy .env.example → .env and fill in strong secrets
```

Edit `.env`:

```dotenv
NODE_ENV=production
PUBLIC_URL=https://ibutest.example.com        # enables HSTS + upgrade-insecure-requests
POSTGRES_PASSWORD=<long random value>
DATABASE_URL=postgres://ibutest:<same password>@db:5432/ibutest
SETUP_TOKEN=<random value, remove after first setup>
# ANTHROPIC_API_KEY=...                       # optional, enables AI features
```

```bash
docker compose up -d --build
```

The app listens on `127.0.0.1:4000` only. Put a TLS-terminating reverse proxy in front, for
example Caddy:

```caddyfile
ibutest.example.com {
  reverse_proxy 127.0.0.1:4000
}
```

`TRUST_PROXY=1` is preset in `docker-compose.yml` so client IPs (rate limits, audit log) come
from `X-Forwarded-For` set by that single proxy. Adjust it if you have more proxy hops.

### First administrator

Either open `https://ibutest.example.com/setup` and enter `SETUP_TOKEN`, or create the
administrator from the CLI without exposing the setup endpoint at all (prompts for the
password with hidden input):

```bash
docker compose exec -it -e ADMIN_EMAIL=you@example.com -e ADMIN_NAME="Your Name" \
  app node server/dist/create-admin.js
# from a source checkout instead:  ADMIN_EMAIL=you@example.com npm run create-admin
```

Remove `SETUP_TOKEN` afterwards. In production the setup endpoint refuses to work without it.

### Production checklist

- [ ] HTTPS everywhere (`PUBLIC_URL=https://…`), HTTP redirected by the proxy.
- [ ] Secrets generated randomly, stored in a secret manager or a `0600` `.env`, never committed.
- [ ] `DATABASE_SSL=verify-full` if PostgreSQL is reached over a network (not needed on the
      internal compose network).
- [ ] Least-privilege DB role: the app needs DML + DDL on its own database only (migrations run
      at start-up); no superuser.
- [ ] `ADMIN_REQUIRE_MFA=true` once administrators have enrolled in 2FA.
- [ ] Backups: `pg_dump` (database) + the `uploads` volume, encrypted and tested.
- [ ] Single instance, or put Redis-backed rate limiting in front before scaling horizontally
      (the built-in limiter is per process).
- [ ] Ship logs (JSON on stdout) to your SIEM; alert on `auth.refresh_token_reuse`,
      `auth.account_locked` and admin actions in the audit log.
- [ ] Run `npm run audit:security` and the CI security workflow before every release.

### Without Docker

```bash
npm ci && npm run build
NODE_ENV=production CLIENT_DIST_DIR=client/dist DB_DRIVER=postgres DATABASE_URL=... \
  JWT_SECRET=... ENCRYPTION_KEY=... PUBLIC_URL=https://... node server/dist/index.js
```

### Installable web app (PWA)

Served over HTTPS, the web app is installable: *Install app* in Chrome/Edge on desktop and
Android, *Share → Add to Home Screen* in Safari on iOS. The service worker only caches the
static shell; project data is never stored offline by the browser.

## 2. Desktop app (.exe, .dmg, AppImage)

Local build (on the target OS):

```bash
npm ci
npm run desktop:dist          # → desktop/release/
```

Or run the **Desktop apps** workflow (`.github/workflows/desktop.yml`, manual or on `v*` tags),
which builds on Windows, macOS and Linux runners and uploads:

- `IbuTest-Setup-<version>-x64.exe` / `-arm64.exe` (installer) and `IbuTest-Portable-<version>.exe`
- `IbuTest-<version>-arm64.dmg` / `-x64.dmg`
- `IbuTest-<version>.AppImage`, `.deb`

**Code signing** (strongly recommended - unsigned apps trigger SmartScreen/Gatekeeper warnings):
add `CSC_LINK` + `CSC_KEY_PASSWORD` (Windows/macOS certificates) and, for macOS notarisation,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repository secrets.

On first launch users choose:

- **Connect to your team's server** - enter the HTTPS URL; the app shows the server's web app
  with the desktop hardening applied.
- **Use on this computer only** - private local workspace (embedded PostgreSQL in the user
  profile, secrets in the OS keychain). Optional Anthropic API key for AI features.

*File → Switch server…* returns to this choice.

## 3. Mobile apps (iOS and Android)

```bash
npm ci
npm run mobile:sync               # builds the web client and copies it into both projects
npx cap open android -w @ibutest/mobile    # Android Studio
npx cap open ios -w @ibutest/mobile        # Xcode (macOS)
```

The **Mobile apps** workflow builds a debug APK and an unsigned iOS simulator build in CI.
For store releases:

- Android: create an upload keystore (keep it out of git), configure signing in
  `mobile/android/app/build.gradle` from CI secrets, build `bundleRelease`, upload the `.aab`
  to Google Play.
- iOS: set your Team and bundle identifier (`com.ibutest.app`) in Xcode, archive and upload
  through Xcode/Transporter or Fastlane.

On first launch the app asks for the server address (HTTPS only). App icons and splash screens
are generated from `mobile/resources/` (`npx @capacitor/assets generate`).

Security settings already applied: WebView debugging disabled, no cleartext traffic, Android
backups disabled, Android trusts only system CAs in release builds, iOS App Transport Security
left at its secure default.
