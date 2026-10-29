// Builds the Electron main process (including the embedded API server) and preload script.
import { build } from 'esbuild';
import fs from 'node:fs';

const EXTERNAL = ['electron', '@node-rs/argon2', '@electric-sql/pglite', 'pg-native'];
fs.rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: EXTERNAL,
  sourcemap: false,
  legalComments: 'none',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});

// Sandboxed preload scripts must be CommonJS.
await build({
  entryPoints: ['src/preload.ts'],
  outfile: 'dist/preload.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'info',
});

fs.cpSync('src/launcher', 'dist/launcher', { recursive: true });
