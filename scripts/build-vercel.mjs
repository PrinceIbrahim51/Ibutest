#!/usr/bin/env node
// Produces a Vercel Build Output API bundle (.vercel/output): static web client + one Node
// function for /api. Run by Vercel as the build command (see vercel.json).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.vercel', 'output');
const fn = path.join(out, 'functions', 'api.func');
process.chdir(root);

execSync('npm run build -w @ibutest/client', { stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });

fs.cpSync('client/dist', path.join(out, 'static'), { recursive: true });

const external = ['@node-rs/argon2', '@electric-sql/pglite', 'pg-native'];
await build({
  entryPoints: ['server/src/vercel.ts'],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external,
  sourcemap: false,
  legalComments: 'none',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
fs.cpSync('server/drizzle', path.join(fn, 'drizzle'), { recursive: true });
// Native / WebAssembly packages are shipped as-is next to the bundle.
for (const pkg of ['@electric-sql/pglite', '@node-rs/argon2', '@node-rs/argon2-linux-x64-gnu']) {
  const src = path.join('node_modules', pkg);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(fn, 'node_modules', pkg), { recursive: true, dereference: true });
}
fs.writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "font-src 'self'",
  "connect-src 'self'", "media-src 'self' blob:", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'",
  "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", 'upgrade-insecure-requests',
].join('; ');
const securityHeaders = {
  'Content-Security-Policy': csp,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), display-capture=()',
};
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/(.*)', headers: securityHeaders, continue: true },
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api(?:/.*)?$', dest: '/api' },
        { src: '^/\\.well-known/security\\.txt$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '^/(?!api(?:/|$))[^.]*$', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel build output written to .vercel/output');
