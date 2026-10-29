#!/usr/bin/env node
// Runs the API server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

if (!fs.existsSync(new URL('../.env', import.meta.url))) {
  console.error('No .env found. Run `npm run setup:env` first to generate one with secure random secrets.');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  ['api', ['run', 'dev', '-w', '@ibutest/server']],
  ['web', ['run', 'dev', '-w', '@ibutest/client']],
].map(([name, args]) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((line) => `[${name}] ${line}`)
      .join('\n');
  child.stdout.on('data', (d) => console.log(prefix(d)));
  child.stderr.on('data', (d) => console.error(prefix(d)));
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
