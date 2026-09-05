// Regenerates public/apple-touch-icon.png from the mark.
//
//   node scripts/build-touch-icon.mjs
//
// The raster is the one copy of the mark no test can read directly, so this
// file is what src/app/mark.test.ts pins instead — every const below is
// compared to the other copies and to src/index.css, and the icon itself is
// checked against them. Run this after touching any of them.
//
// The geometry is duplicated from public/favicon.svg on purpose: this script
// must keep working if that file's <style> block changes, and iOS composites
// home-screen icons, so the plate is opaque and the inks are the dark trio.
//
// The mark is INSET where the favicon is full-bleed, because iOS masks to a
// squircle and ink in the corners is ink thrown away, and it is centred on its
// PAINT rather than on its box — the drawing does not sit centred inside its
// own viewBox, so centring the box leaves the mark riding high under the mask.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOOP =
  'M72 56 A16 16 0 0 1 56 72 H36 A16 16 0 0 1 20 56 V36 A16 16 0 0 1 36 20 H56 A16 16 0 0 1 72 36 V70 M72 62 A8 8 0 0 1 80 54 H88 A8 8 0 0 1 96 62 V70';
const PILL_A = 'M72 48 V70';
const PILL_B = 'M96 70 V88';
// The dark trio and the dark `card`, pinned to src/index.css by mark.test.ts.
const INK_LOOP = '#d8b494';
const INK_A = '#ece1d2';
const INK_B = '#b07a52';
const PLATE = '#19181a';

// 180 is Apple's apple-touch-icon size; the mark takes the sheet's tile ratio
// on it, 64 of 96. The nudges are in viewBox UNITS — mark.test.ts recomputes
// them from the paths — so UNIT is what spends them as pixels at whatever size
// the box is drawn. It is 1 today and would not be on a larger plate.
const PLATE_PX = 180;
const BOX = 120;
const SVG_PX = 120;
const UNIT = SVG_PX / BOX;
const NUDGE_X = 1;
const NUDGE_Y = 5;

const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${PLATE_PX}px;height:${PLATE_PX}px;overflow:hidden}
body{background:${PLATE};display:grid;place-items:center}
svg{display:block;width:${SVG_PX}px;height:${SVG_PX}px;transform:translate(${NUDGE_X * UNIT}px,${NUDGE_Y * UNIT}px)}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<path d="${LOOP}" fill="none" stroke="${INK_LOOP}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${PILL_A}" fill="none" stroke="${INK_A}" stroke-width="15" stroke-linecap="round"/>
<path d="${PILL_B}" fill="none" stroke="${INK_B}" stroke-width="15" stroke-linecap="round"/>
</svg>`;

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'quirenote-icon-'));
const page = join(dir, 'icon.html');
writeFileSync(page, html);
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  `--window-size=${PLATE_PX},${PLATE_PX}`,
  `--screenshot=${join(process.cwd(), 'public/apple-touch-icon.png')}`,
  page,
]);
console.log('wrote public/apple-touch-icon.png');
