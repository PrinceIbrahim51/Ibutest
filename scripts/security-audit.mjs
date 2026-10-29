#!/usr/bin/env node
/**
 * One-command security audit: `npm run audit:security`
 *
 * Runs the automated parts of the security checklist (see docs/SECURITY_AUDIT.md) and exits
 * non-zero when any check fails, so it can gate CI and releases.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(root);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const results = [];
const check = (area, name, ok, detail = '') => results.push({ area, name, ok, detail });

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ------------------------------------------------------------------ dependencies
{
  const r = run('npm', ['audit', '--json']);
  let counts;
  try {
    counts = JSON.parse(r.out.slice(r.out.indexOf('{'))).metadata?.vulnerabilities ?? {};
  } catch {
    counts = { error: 1 };
  }
  const bad = (counts.moderate ?? 0) + (counts.high ?? 0) + (counts.critical ?? 0) + (counts.error ?? 0);
  check('Dependencies', 'npm audit: no moderate/high/critical vulnerabilities', bad === 0, JSON.stringify(counts));
}
{
  const unpinned = [];
  for (const ws of ['.', 'shared', 'server', 'client', 'desktop', 'mobile']) {
    const pkg = JSON.parse(read(`${ws}/package.json`));
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!/^\d+\.\d+\.\d+$/.test(version.split('-')[0])) unpinned.push(`${ws}:${name}@${version}`);
    }
  }
  check('Dependencies', 'All dependency versions pinned exactly', unpinned.length === 0, unpinned.join(', '));
  check('Dependencies', 'Lockfile committed', exists('package-lock.json'));
}
{
  // Unused dependency detection: every declared runtime/dev dependency must be referenced.
  const toolOnly = new Set([
    'typescript', 'eslint', '@eslint/js', 'typescript-eslint', 'eslint-plugin-security', 'eslint-plugin-react-hooks', 'globals',
    'tsx', 'vitest', 'drizzle-kit', 'esbuild', 'vite', 'electron', 'electron-builder',
    '@capacitor/cli', '@capacitor/core', '@capacitor/android', '@capacitor/ios', '@ibutest/shared',
  ]);
  const unused = [];
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(m?[jt]sx?|cjs)$/.test(f) && !f.startsWith('mobile/android') && !f.startsWith('mobile/ios'));
  const corpus = files.map((f) => read(f)).join('\n');
  for (const ws of ['server', 'client', 'desktop', 'shared']) {
    const pkg = JSON.parse(read(`${ws}/package.json`));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (toolOnly.has(name)) continue;
      const bare = name.startsWith('@types/') ? name.slice(7).replace(/^(.*)__(.*)$/, '@$1/$2') : name;
      if (!corpus.includes(`'${bare}`) && !corpus.includes(`"${bare}`)) unused.push(`${ws}:${name}`);
    }
  }
  check('Dependencies', 'No unused packages declared', unused.length === 0, unused.join(', '));
}

// ------------------------------------------------------------------ secrets & exposed files
{
  const r = run('node', ['scripts/scan-secrets.mjs']);
  check('Secrets', 'No secrets in working tree or git history', r.code === 0, r.out.trim().split('\n')[0]);
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
  check('Secrets', '.env files are git-ignored and untracked', /^\.env$/m.test(read('.gitignore')) && !tracked.some((f) => /(^|\/)\.env$/.test(f)));
  const aiLeak = run('grep', ['-rlE', 'sk-ant-|api\\.anthropic\\.com|x-api-key|@anthropic-ai', 'client/src', 'client/dist']);
  check('Secrets', 'AI provider key/SDK is server-side only (not in client code or bundle)', aiLeak.out.trim() === '', aiLeak.out.trim());
}
{
  const dist = 'client/dist';
  if (exists(`${dist}/index.html`)) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = walk(path.join(root, dist));
    check('Exposed files', 'No source maps in the production web build', !files.some((f) => f.endsWith('.map')));
    check('Exposed files', 'No dotfiles in the production web build', !files.some((f) => path.basename(f).startsWith('.')));
    check('XSS', 'Bundled HTML carries a CSP without unsafe-inline/eval', /Content-Security-Policy/.test(read(`${dist}/index.html`)) && !/unsafe-(inline|eval)/.test(read(`${dist}/index.html`)));
  } else {
    check('Exposed files', 'Production web build present for inspection', false, 'run `npm run build` first');
  }
  check('Exposed files', '.dockerignore excludes .env and .git', exists('.dockerignore') && /^\.env/m.test(read('.dockerignore')) && /^\.git/m.test(read('.dockerignore')));
}

// ------------------------------------------------------------------ static analysis
{
  const r = run('npx', ['eslint', '.', '--max-warnings', '0']);
  check('Static analysis', 'ESLint (incl. eslint-plugin-security, XSS sink bans) clean', r.code === 0, r.code ? r.out.split('\n').slice(-3).join(' ') : '');
}
{
  const client = execFileSync('git', ['ls-files', 'client/src'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(read).join('\n');
  check('XSS', 'No dangerouslySetInnerHTML / innerHTML / eval in client code', !/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(/.test(client));
  check('Auth', 'Access token kept in memory (never localStorage)', !/localStorage\.setItem\([^)]*(token|Token)/.test(client));
}

// ------------------------------------------------------------------ server configuration
{
  const security = read('server/src/middleware/security.ts');
  check('Headers', 'Helmet CSP forbids inline scripts and framing', /scriptSrc: \["'self'"\]/.test(security) && /frameAncestors: \["'none'"\]/.test(security));
  check('CORS', 'CORS uses an explicit allow-list (no wildcard)', /corsOrigins\.includes\(origin\)/.test(security) && /Wildcard CORS origins are not allowed/.test(read('server/src/config/env.ts')));
  const app = read('server/src/app.ts');
  check('Debug', 'X-Powered-By disabled, no stack traces returned', /disable\('x-powered-by'\)/.test(app) && !/err\.stack/.test(read('server/src/middleware/errors.ts')));
  check('Rate limiting', 'Global, auth, AI, upload and automation rate limits configured', ['api:', 'auth:', 'ai:', 'upload:', 'automation:'].every((k) => read('server/src/middleware/rateLimit.ts').includes(k)));
  check('Passwords', 'Passwords hashed with Argon2id (OWASP parameters)', /memoryCost: 19456/.test(read('server/src/lib/password.ts')));
  check('Database', 'Only parameterised queries (no raw string SQL concatenation)', !/sql\.raw\(|\.execute\(`/.test(execFileSync('git', ['ls-files', 'server/src'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(read).join('\n')));
  check('Admin routes', 'Admin router guarded by requireAdmin', /router\.use\(requireAdmin\(ctx\)\)/.test(read('server/src/modules/admin/routes.ts')));
}

// ------------------------------------------------------------------ desktop & mobile
{
  const main = read('desktop/src/main.ts');
  check('Desktop', 'Renderer sandbox + context isolation, no Node integration', /sandbox: true/.test(main) && /contextIsolation: true/.test(main) && /nodeIntegration: false/.test(main));
  check('Desktop', 'Navigation lock, window.open denied, permissions denied', /will-navigate/.test(main) && /action: 'deny'/.test(main) && /setPermissionRequestHandler/.test(main));
  const builder = read('desktop/electron-builder.config.cjs');
  check('Desktop', 'Electron fuses: RunAsNode/inspect/NODE_OPTIONS off, ASAR integrity on', /runAsNode: false/.test(builder) && /enableNodeCliInspectArguments: false/.test(builder) && /enableEmbeddedAsarIntegrityValidation: true/.test(builder));
  check('Desktop', 'DevTools disabled in packaged builds', /devTools: !app\.isPackaged/.test(main));
  const cap = read('mobile/capacitor.config.ts');
  check('Mobile', 'WebView debugging off, cleartext/mixed content off', /webContentsDebuggingEnabled: false/.test(cap) && /cleartext: false/.test(cap) && /allowMixedContent: false/.test(cap));
  if (exists('mobile/android/app/src/main/AndroidManifest.xml')) {
    const manifest = read('mobile/android/app/src/main/AndroidManifest.xml');
    check('Mobile', 'Android: backups disabled, cleartext traffic disabled', /allowBackup="false"/.test(manifest) && /usesCleartextTraffic="false"/.test(manifest));
  }
  if (exists('mobile/ios/App/App/Info.plist')) {
    check('Mobile', 'iOS: App Transport Security not weakened', !/NSAllowsArbitraryLoads/.test(read('mobile/ios/App/App/Info.plist')));
  }
}

// ------------------------------------------------------------------ report
const width = Math.max(...results.map((r) => r.name.length));
for (const area of [...new Set(results.map((r) => r.area))]) {
  console.log(`\n${area}`);
  for (const r of results.filter((x) => x.area === area)) {
    console.log(`  ${r.ok ? '✔' : '✖'} ${r.name.padEnd(width)} ${r.ok ? '' : r.detail}`);
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
