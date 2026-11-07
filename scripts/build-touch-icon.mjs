// Regenerates public/apple-touch-icon.png and the mail's public/email/mark-{light,dark}.png.
//
//   node scripts/build-touch-icon.mjs
//
// A raster cannot be compared to an SVG in the suite, so src/app/mark.test.ts pins every
// const below and reads each PNG back against them. Run this after touching any of them.
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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

// THE MAIL'S MARK is the refresh's «q» on a plate, ahead of the app (*Brand*): three rounded
// rects in the 120 box, `x y w h r`, from the wave-24 spec, the counter cut from the bowl.
const Q_BOWL = '32 21 56 56 15';
const Q_COUNTER = '48 37 22 24 6';
const Q_STEM = '70 49 18 50 5';
// The plate takes `logo-outline` and the «q» takes `card`, per theme, pinned by mark.test.ts.
const MAIL_PLATE_LIGHT = '#8a5a3a';
const MAIL_PLATE_DARK = '#d8b494';
const MAIL_Q_LIGHT = '#f8f5ef';
const MAIL_Q_DARK = '#19181a';
// The 40 plate at 2×, its corner round(40 × 0.26) doubled, the «q» box at 22/40 of the side.
// The «q»'s paint is centred in its box, so centring the box centres the paint.
const MAIL_PX = 80;
const MAIL_RADIUS = 20;
const MAIL_Q_PX = 44;

const roundRect = (rect) => {
  const [x, y, w, h, r] = rect.split(' ').map(Number);
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
};

for (const [theme, plate, q] of [
  ['light', MAIL_PLATE_LIGHT, MAIL_Q_LIGHT],
  ['dark', MAIL_PLATE_DARK, MAIL_Q_DARK],
]) {
  const mail = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${MAIL_PX}px;height:${MAIL_PX}px;overflow:hidden;background:transparent}
div{width:${MAIL_PX}px;height:${MAIL_PX}px;border-radius:${MAIL_RADIUS}px;background:${plate};display:grid;place-items:center}
svg{display:block;width:${MAIL_Q_PX}px;height:${MAIL_Q_PX}px}</style>
<div><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<path d="${roundRect(Q_BOWL)} ${roundRect(Q_COUNTER)}" fill-rule="evenodd" fill="${q}"/>
<path d="${roundRect(Q_STEM)}" fill="${q}"/>
</svg></div>`;
  const out = `public/email/mark-${theme}.png`;
  const mailPage = join(dir, `mail-${theme}.html`);
  writeFileSync(mailPage, mail);
  mkdirSync(join(process.cwd(), 'public/email'), { recursive: true });
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    // The plate's corners are left transparent, so they take whatever the card is painted.
    '--default-background-color=00000000',
    `--window-size=${MAIL_PX},${MAIL_PX}`,
    `--screenshot=${join(process.cwd(), out)}`,
    mailPage,
  ]);
  console.log(`wrote ${out}`);
}
