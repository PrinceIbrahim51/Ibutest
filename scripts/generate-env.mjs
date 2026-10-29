#!/usr/bin/env node
// Creates .env from .env.example with freshly generated secrets. Refuses to overwrite.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const target = path.join(root, '.env');
if (fs.existsSync(target) && !process.argv.includes('--force')) {
  console.error('.env already exists. Re-run with --force to replace it (existing sessions and MFA secrets will break).');
  process.exit(1);
}
let content = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
content = content
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(48).toString('base64url')}`)
  .replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
  .replace(/^# SETUP_TOKEN=.*$/m, `SETUP_TOKEN=${randomBytes(24).toString('base64url')}`);
fs.writeFileSync(target, content, { mode: 0o600 });
console.log(`Wrote ${target} (mode 600). Keep it out of version control.`);
