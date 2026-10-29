import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Content-Security-Policy for builds that are NOT served by the IbuTest server (the
 * Capacitor mobile apps load the bundle from the device). The server sends a stricter
 * CSP header for the web/desktop builds; browsers enforce both, so the stricter one wins.
 */
const BUNDLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function cspMeta(): Plugin {
  return {
    name: 'ibutest-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${BUNDLE_CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMeta()],
  build: {
    outDir: 'dist',
    sourcemap: false, // never ship source maps to production
    assetsInlineLimit: 0,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: 4173 },
});
