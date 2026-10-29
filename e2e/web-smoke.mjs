#!/usr/bin/env node
/**
 * Browser end-to-end smoke test against a running production build.
 *
 *   npm run build
 *   NODE_ENV=production CLIENT_DIST_DIR=client/dist SETUP_TOKEN=e2e-setup-token-0123456789 \
 *     JWT_SECRET=... ENCRYPTION_KEY=... PGLITE_DATA_DIR=$(mktemp -d) node server/dist/index.js &
 *   E2E_BASE_URL=http://127.0.0.1:4000 npm run test:e2e
 *
 * Expects a fresh database (it performs first-run setup). Fails on any CSP violation or page error.
 * Set PLAYWRIGHT_CHROMIUM_PATH to use an already installed Chromium.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4000';
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? 'e2e-setup-token-0123456789';
const OUT = process.env.E2E_OUTPUT_DIR ?? 'e2e/output';
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const step = async (name, fn) => { try { await fn(); console.log('ok   ', name); } catch (e) { console.log('FAIL ', name, e.message.split('\n')[0]); await shot(`fail-${name.replace(/\W+/g, '-')}`); throw e; } };

await step('setup screen', async () => {
  await page.goto(BASE + '/');
  await page.waitForURL('**/setup');
  await page.getByLabel('Full name').fill('Ibrahim Admin');
  await page.getByLabel('Email').fill('admin@ibutest.dev');
  await page.getByLabel('Password', { exact: true }).fill('Super-Secure-Passphrase-42');
  await page.getByLabel('Confirm password').fill('Super-Secure-Passphrase-42');
  await page.getByLabel('Setup token').fill(SETUP_TOKEN);
  await shot('01-setup');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await page.getByRole('heading', { name: 'Projects' }).waitFor();
});
await step('session survives reload (refresh cookie)', async () => {
  await page.reload();
  await page.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 10000 });
});
await step('create project', async () => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Key').fill('SHOP');
  await page.getByLabel('Name').fill('Web Shop');
  await page.getByLabel('Description').fill('E-commerce storefront and checkout');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('heading', { name: 'Web Shop' }).waitFor();
});
const projectUrl = page.url();
await step('create requirement', async () => {
  await page.getByRole('link', { name: 'Requirements' }).click();
  await page.getByRole('button', { name: 'New requirement' }).click();
  await page.getByLabel('Title').fill('Customers can pay with a credit card');
  await page.getByLabel('Description & acceptance criteria').fill('Visa and Mastercard are accepted.\nExpired cards are rejected with a clear message.\n<script>alert(1)</script>');
  await page.getByRole('button', { name: 'Create requirement' }).click();
  await page.getByText('RQ-1').first().waitFor();
  await shot('02-requirement');
});
await step('create test case with steps', async () => {
  await page.goto(projectUrl + '/test-cases/new');
  await page.getByLabel('Title').fill('Pay with a valid Visa card');
  await page.getByLabel('Preconditions').fill('A product is in the cart');
  await page.getByLabel('Action').first().fill('Open the checkout page');
  await page.getByLabel('Expected result').first().fill('Payment form is displayed');
  await page.getByRole('button', { name: 'Add step' }).click();
  await page.getByLabel('Action').nth(1).fill('Enter card 4111 1111 1111 1111 and pay');
  await page.getByLabel('Expected result').nth(1).fill('Order confirmation is shown');
  await page.getByRole('button', { name: 'Create test case' }).click();
  await page.getByText('TC-1').first().waitFor();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByText('Version 1 · Approved').waitFor();
  await shot('03-test-case');
});
await step('link test case to requirement', async () => {
  await page.goto(projectUrl + '/requirements');
  await page.getByRole('link', { name: 'Customers can pay with a credit card' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  await page.getByRole('checkbox', { name: 'Select TC-1' }).check();
  await page.getByRole('button', { name: 'Link selected' }).click();
  await page.getByRole('link', { name: 'Pay with a valid Visa card' }).waitFor();
});
await step('create cycle and add runs', async () => {
  await page.goto(projectUrl + '/execution');
  await page.getByRole('button', { name: 'Test cycle' }).click();
  await page.getByLabel('Name').fill('Sprint 12 regression');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('heading', { name: 'Sprint 12 regression' }).waitFor();
  await page.getByRole('button', { name: 'Add test cases' }).click();
  await page.getByRole('checkbox', { name: 'Select TC-1' }).check();
  await page.getByRole('button', { name: 'Add to cycle' }).click();
  await page.getByRole('link', { name: 'Run' }).waitFor();
});
await step('execute run (fail step) and raise defect', async () => {
  await page.getByRole('link', { name: 'Run' }).click();
  await page.getByRole('group', { name: 'Result of step 1' }).getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('group', { name: 'Result of step 2' }).getByRole('button', { name: 'Fail' }).click();
  await page.getByPlaceholder('Actual result').fill('Spinner never stops; gateway timeout after 30s');
  await page.getByLabel('Comment').fill('Build 2026.10.29-rc1, Chrome');
  await shot('04-execution');
  await page.getByRole('button', { name: 'Save result' }).click();
  await page.getByRole('heading', { name: 'Report defect' }).waitFor();
  await page.getByLabel('Severity').selectOption('critical');
  await page.getByRole('button', { name: 'Create defect' }).click();
  await page.getByText('DF-1').waitFor();
});
await step('dashboard', async () => {
  await page.goto(projectUrl);
  await page.getByText('Requirement coverage').waitFor();
  await page.getByText('Executions over the last 14 days').waitFor();
  await page.waitForTimeout(300);
  await shot('05-dashboard');
});
await step('reports & traceability', async () => {
  await page.goto(projectUrl + '/reports');
  await page.getByText('1 of 1 requirements covered').waitFor();
  await shot('06-reports');
});
await step('profile MFA setup renders QR', async () => {
  await page.goto(BASE + '/profile');
  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  await page.getByAltText('QR code for your authenticator app').waitFor();
  await shot('07-profile');
});
await step('admin audit log', async () => {
  await page.goto(BASE + '/admin');
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await page.getByText('run.executed').first().waitFor();
  await shot('08-admin-audit');
});
await step('xss payload rendered as text', async () => {
  await page.goto(projectUrl + '/requirements');
  await page.getByRole('link', { name: 'Customers can pay with a credit card' }).click();
  const value = await page.getByLabel('Description & acceptance criteria').inputValue();
  if (!value.includes('<script>alert(1)</script>')) throw new Error('payload not preserved as text');
});
await step('mobile layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(projectUrl + '/test-cases');
  await page.getByRole('heading', { name: 'Test cases' }).waitFor();
  await shot('09-mobile-test-cases');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForTimeout(300);
  await shot('10-mobile-menu');
});
await step('dark mode', async () => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(projectUrl);
  await page.getByText('Requirement coverage').waitFor();
  await page.waitForTimeout(300);
  await shot('11-dashboard-dark');
});
await step('sign out', async () => {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
});
await browser.close();
// The only expected browser error is the 401 from the session probe after signing out.
const unexpected = problems.filter((p) => !p.includes('401 (Unauthorized)'));
console.log('\nBrowser problems:', unexpected.length ? `\n${unexpected.join('\n')}` : 'none');
if (unexpected.length) process.exit(1);
