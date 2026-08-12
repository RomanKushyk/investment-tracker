// Regenerates public/apple-touch-icon.png from the mark. The PNG is the ONLY
// copy of mark 04 that no test can guard — comparing a raster to an SVG needs a
// renderer the test environment does not have — so it gets a checked-in step
// instead, and public/README.md names it in the change-together rule.
//
//   node scripts/build-touch-icon.mjs
//
// Geometry is duplicated from public/favicon.svg on purpose: this script must
// keep working if the SVG's <style> block changes, and iOS needs an OPAQUE
// plate (it composites home-screen icons), so the colours differ by design.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BARS = [
  ['M6 24v-4', '.45'],
  ['M12 24v-10', '.65'],
  ['M18 24v-6', '.8'],
  ['M24 24v-16', '1'],
];

const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:180px;height:180px;overflow:hidden}
body{background:#26262a}svg{display:block;width:180px;height:180px}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<g fill="none" stroke="#e9e8e6" stroke-width="4" stroke-linecap="round">
${BARS.map(([d, o]) => `<path d="${d}" opacity="${o}"/>`).join('\n')}
</g></svg>`;

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'quirenote-icon-'));
const page = join(dir, 'icon.html');
writeFileSync(page, html);
execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars',
  '--window-size=180,180',
  `--screenshot=${join(process.cwd(), 'public/apple-touch-icon.png')}`,
  page,
]);
console.log('wrote public/apple-touch-icon.png');
