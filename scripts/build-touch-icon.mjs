// Regenerates public/apple-touch-icon.png from the mark. The PNG is the ONLY
// copy of the mark that no test can guard — comparing a raster to an SVG needs a
// renderer the test environment does not have — so it gets a checked-in step
// instead, and public/README.md names it in the change-together rule.
//
//   node scripts/build-touch-icon.mjs
//
// Geometry is duplicated from public/favicon.svg on purpose: this script must
// keep working if the SVG's <style> block changes, and iOS needs an OPAQUE plate
// (it composites home-screen icons), so the colours differ by design — the
// dark-plane pair, the sidebar's own treatment.
//
// AND THE MARK IS INSET HERE, where the favicon is full-bleed. iOS masks the
// icon to a squircle, so ink in the corners is ink thrown away; the arc would
// lose its left and bottom tangents and the arrowhead its tip. 116 of 180 is
// 64.4%, matching the 62-of-96 the owner's own quirenote-icon.svg uses.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARC = 'M53 16.39A32 32 0 1 0 79.61 42.99';
const SHAFT = 'M52 44 74 22';
const HEAD = 'M79.78 31.78 64.22 16.22 86 10Z';
const INK = '#e9e8e6';
const SAND = '#d8b494';

const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:180px;height:180px;overflow:hidden}
body{background:#26262a;display:grid;place-items:center}
svg{display:block;width:116px;height:116px}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="9.5 8.5 78 78">
<path d="${ARC}" fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
<path d="${SHAFT}" fill="none" stroke="${SAND}" stroke-width="13" stroke-linecap="round"/>
<path d="${HEAD}" fill="${SAND}" stroke="${SAND}" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'quirenote-icon-'));
const page = join(dir, 'icon.html');
writeFileSync(page, html);
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=180,180',
  `--screenshot=${join(process.cwd(), 'public/apple-touch-icon.png')}`,
  page,
]);
console.log('wrote public/apple-touch-icon.png');
