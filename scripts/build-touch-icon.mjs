// Regenerates public/apple-touch-icon.png and the mail's public/email/mark-{light,dark}.png.
//
//   node scripts/build-touch-icon.mjs
//
// A raster cannot be compared to an SVG in the suite, so src/app/mark.test.ts pins every
// const below and reads each PNG back against them. Run this after touching any of them.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The «q» as three rounded rects, `x y w h r`, the counter cut from the bowl. Its paint is centred
// in the box, so centring the box centres the «q».
const Q_BOWL = '32 21 56 56 15';
const Q_COUNTER = '48 37 22 24 6';
const Q_STEM = '70 49 18 50 5';

const roundRect = (rect) => {
  const [x, y, w, h, r] = rect.split(' ').map(Number);
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
};

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'quirenote-icon-'));

// The home-screen icon: an opaque full-bleed plate in the light pair, unmasked because iOS applies
// the mask; one PNG serves every appearance.
const TOUCH_PX = 180;
const TOUCH_Q_PX = 99;
const TOUCH_PLATE = '#8a5a3a';
const TOUCH_Q = '#f8f5ef';

const touch = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${TOUCH_PX}px;height:${TOUCH_PX}px;overflow:hidden}
body{background:${TOUCH_PLATE};display:grid;place-items:center}
svg{display:block;width:${TOUCH_Q_PX}px;height:${TOUCH_Q_PX}px}</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<path d="${roundRect(Q_BOWL)} ${roundRect(Q_COUNTER)}" fill-rule="evenodd" fill="${TOUCH_Q}"/>
<path d="${roundRect(Q_STEM)}" fill="${TOUCH_Q}"/>
</svg>`;
const page = join(dir, 'icon.html');
writeFileSync(page, touch);
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  `--window-size=${TOUCH_PX},${TOUCH_PX}`,
  `--screenshot=${join(process.cwd(), 'public/apple-touch-icon.png')}`,
  page,
]);
console.log('wrote public/apple-touch-icon.png');

// The plate takes `logo-outline` and the «q» takes `card`, per theme, pinned by mark.test.ts.
const MAIL_PLATE_LIGHT = '#8a5a3a';
const MAIL_PLATE_DARK = '#d8b494';
const MAIL_Q_LIGHT = '#f8f5ef';
const MAIL_Q_DARK = '#19181a';
// The sidebar's plate at 2×, with the shape rule's corner and the «q» at the lockup's ratio.
const MAIL_PX = 80;
const MAIL_RADIUS = 20;
const MAIL_Q_PX = 44;

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
