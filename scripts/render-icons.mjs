#!/usr/bin/env node
// Renders the SVG app icon to the PNG sizes needed by the PWA, Electron and Capacitor.
// Usage: node scripts/render-icons.mjs   (uses the pre-installed Playwright Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Playwright is not a project dependency; use a local install if present, else the global one.
async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return createRequire(path.join(globalRoot, 'noop.js'))('playwright').chromium;
  }
}
const chromium = await loadChromium();

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svg = fs.readFileSync(path.join(root, 'client/public/icon.svg'), 'utf8');
const maskable = svg.replace('rx="112"', 'rx="0"').replace(/<path /g, '<path transform="translate(51.2 51.2) scale(0.8)" ');

const targets = [
  ['client/public/icons/icon-192.png', 192, svg],
  ['client/public/icons/icon-512.png', 512, svg],
  ['client/public/icons/maskable-512.png', 512, maskable],
  ['desktop/build/icon.png', 1024, svg],
  ['mobile/resources/icon.png', 1024, maskable],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [rel, size, source] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  const out = path.join(root, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote ${rel}`);
}
await browser.close();
