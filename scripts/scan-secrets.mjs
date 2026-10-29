#!/usr/bin/env node
/**
 * Secret scanner for the working tree AND the complete git history.
 *
 *   node scripts/scan-secrets.mjs            # tracked files + every commit on every branch
 *   node scripts/scan-secrets.mjs --staged   # only staged changes (use as a pre-commit hook)
 *
 * CI additionally runs gitleaks (.github/workflows/security.yml); this script has no
 * dependencies so it also works offline and on developer machines.
 * Mark a deliberate test fixture with the comment `secret-scan:allow` on the same line.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RULES = [
  ['Anthropic API key', /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['AWS secret access key', /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}\b/i],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\b[rs]k_live_[0-9A-Za-z]{20,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
  ['IbuTest API token', /\bibt_[A-Za-z0-9_-]{40,}\b/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Database URL with password', /\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^:\s/'"@]+:([^@\s'"]{6,})@/],
];

/** KEY=value style assignments of secret-looking variables (env files, Dockerfiles, YAML). */
const ENV_ASSIGNMENT = /^[A-Z0-9_]*(?:SECRET|API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|ENCRYPTION_KEY)[A-Z0-9_]*\s*[:=]\s*(['"]?)([\w+/=.~-]{16,})\1[,;]?$/;
/** In source code only quoted literals count (not expressions such as `config.secret`). */
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const PLACEHOLDER = /REPLACE_?ME|change-?me|example|placeholder|your[-_]|\$\{\{|\$\(|\$\{|<[^>]+>|x{8,}|test|dummy|fake/i;
const FORBIDDEN_FILES = [/\.(pem|key|p12|pfx|jks|keystore|mobileprovision)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)$/, /(^|\/)secrets\.(json|bin)$/];
const isForbidden = (file) => {
  const base = path.basename(file);
  return (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) || FORBIDDEN_FILES.some((re) => re.test(file));
};

function entropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function scanLine(line, file = '') {
  if (line.includes('secret-scan:allow')) return [];
  const hits = [];
  for (const [name, re] of RULES) {
    const m = re.exec(line);
    if (!m) continue;
    const value = m[1] ?? m[0];
    if (name === 'Database URL with password' && PLACEHOLDER.test(value)) continue;
    hits.push(name);
  }
  const assignment = line.trim().replace(/^export\s+/, '').replace(/\s+#.*$/, '');
  const env = ENV_ASSIGNMENT.exec(assignment);
  if (env && (env[1] || !CODE_FILE.test(file)) && !PLACEHOLDER.test(env[2]) && entropy(env[2]) >= 3.5) {
    hits.push('High-entropy secret assignment');
  }
  return hits;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
const findings = [];
const staged = process.argv.includes('--staged');

// 1) Files that must never be committed, at any point in history.
const everCommitted = staged
  ? git('diff', '--cached', '--name-only', '--diff-filter=A').split('\n')
  : git('log', '--all', '--pretty=format:', '--name-only', '--diff-filter=A').split('\n');
for (const file of new Set(everCommitted.filter(Boolean))) {
  if (isForbidden(file)) findings.push({ where: file, rule: 'Sensitive file committed' });
}

// 2) Content of every added line in history (or the staged diff).
const diff = staged ? git('diff', '--cached', '--no-color', '-U0') : git('log', '-p', '--all', '--no-color', '-U0', '--format=commit %H');
let commit = 'staged';
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('commit ')) commit = line.slice(7, 19);
  else if (line.startsWith('+++ ')) file = line.slice(6);
  else if (line.startsWith('+') && !line.startsWith('+++')) {
    if (/\.(png|jpe?g|gif|webp|ico|icns|woff2?|jar)$/i.test(file)) continue;
    for (const rule of scanLine(line.slice(1), file)) findings.push({ where: `${file} (${commit})`, rule });
  }
}

// 3) Current working tree (catches files that were never committed but are tracked/staged).
if (!staged) {
  for (const tracked of git('ls-files').split('\n').filter(Boolean)) {
    if (isForbidden(tracked)) findings.push({ where: tracked, rule: 'Sensitive file tracked' });
  }
}

const unique = [...new Map(findings.map((f) => [`${f.where}|${f.rule}`, f])).values()];
const scope = staged ? 'staged changes' : `working tree + ${git('rev-list', '--all', '--count').trim()} commits`;
if (unique.length) {
  console.error(`✖ Secret scan found ${unique.length} potential secret(s) in ${scope}:`);
  for (const f of unique) console.error(`  - ${f.rule}: ${f.where}`);
  console.error('\nRotate any real credential immediately, then remove it from history (git filter-repo).');
  process.exit(1);
}
console.log(`✔ Secret scan passed (${scope}, ${RULES.length + 1} rules) in ${path.basename(process.cwd())}`);
