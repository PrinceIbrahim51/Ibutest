#!/usr/bin/env node
/**
 * Desktop (Electron) smoke test: launcher, insecure-URL refusal, local workspace start-up,
 * renderer isolation, navigation lock, window.open denial.
 *
 *   npm run desktop:dev   # once, to build desktop/dist (or: npm run build -w @ibutest/desktop)
 *   xvfb-run -a npm run test:e2e:desktop      # Linux CI/headless; must not run as root
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = process.env.E2E_OUTPUT_DIR ?? path.join(root, 'e2e', 'output');
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ibutest-desktop-e2e-'));
const failures = [];
const expect = (ok, label) => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}`);
  if (!ok) failures.push(label);
};
const app = await electron.launch({
  executablePath: (await import('electron')).default,
  args: [path.join(root, 'desktop')],
  env: { ...process.env, XDG_CONFIG_HOME: profile, APPDATA: profile },
  timeout: 60000,
});
app.process().stderr.on('data', (d) => process.stderr.write(`[electron] ${d}`));
const win = await app.firstWindow();
await win.waitForLoadState();
expect(win.url() === 'app://launcher/index.html', 'launcher served from app:// protocol');
await win.screenshot({ path: `${OUT}/desktop-launcher.png` });

// Security checks inside the renderer.
const probe = await win.evaluate(() => ({
  hasRequire: typeof window.require,
  hasProcess: typeof window.process,
  bridgeKeys: Object.keys(window.ibutestDesktop || {}),
}));
expect(probe.hasRequire === 'undefined' && probe.hasProcess === 'undefined', 'renderer has no Node.js globals');

// Insecure server URLs are refused.
await win.fill('#server-url', 'http://example.com');
await win.click('#remote-form button');
await win.waitForSelector('#error:not([hidden])');
expect(/https/.test(await win.textContent('#error')), 'insecure http:// server URL refused');

// Start local workspace.
await win.click('#local-form button');
await win.waitForURL(/127\.0\.0\.1:\d+\/setup/, { timeout: 60000 });
const setupUrl = win.url();
expect(/#setupToken=/.test(setupUrl), 'local workspace started with one-time setup token');
await win.getByLabel('Full name').fill('Desktop Admin');
await win.getByLabel('Email').fill('me@ibutest.dev');
await win.getByLabel('Password', { exact: true }).fill('Desktop-Passphrase-123');
await win.getByLabel('Confirm password').fill('Desktop-Passphrase-123');
await win.getByRole('button', { name: 'Create administrator' }).click();
await win.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 30000 });
await win.screenshot({ path: `${OUT}/desktop-projects.png` });

// Navigation away from the app origin is blocked.
const before = win.url();
await win.evaluate(() => { window.location.href = 'https://evil.example/phish'; });
await win.waitForTimeout(1500);
expect(win.url() === before, 'navigation to external origin blocked');

// window.open is denied.
const opened = await win.evaluate(() => window.open('https://example.com') === null);
expect(opened, 'window.open denied');

// Desktop bridge is present for "Switch server".
const hasBridge = await win.evaluate(() => !!window.ibutestDesktop?.isDesktop);
expect(hasBridge, 'desktop bridge available to the app');

// Permission requests are denied.
const perm = await win.evaluate(async () => { try { await navigator.mediaDevices.getUserMedia({ video: true }); return 'granted'; } catch (e) { return e.name; } });
expect(perm !== 'granted', 'camera permission not granted');
await app.close();
fs.rmSync(profile, { recursive: true, force: true });
if (failures.length) process.exit(1);
