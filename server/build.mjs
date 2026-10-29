// Bundles the API server into dist/ (single ESM file). Packages with native or WASM
// assets stay external and are installed as normal dependencies.
import { build } from 'esbuild';
import fs from 'node:fs';

const EXTERNAL = ['@node-rs/argon2', '@electric-sql/pglite', 'pg-native'];

fs.rmSync(new URL('./dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: { index: 'src/index.ts', embedded: 'src/embedded.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  external: EXTERNAL,
  // Some CommonJS dependencies call require(); provide it inside the ESM bundle.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
