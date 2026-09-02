# public/ — static assets served at the site root

Vite copies everything here to the deploy root **verbatim**: no hashing, no
bundling, no transform. A file added here is a URL (`favicon.svg` → `/favicon.svg`),
so it is referenced from `index.html`, never imported from `src/`.

**Including this file.** `pnpm build` puts it at `dist/README.md`, so it is served
at `/README.md` on the live site. It stays anyway — the repo requires a README
per top-level folder, and there is no exclude list for `public/`. Two things
follow: never put anything here you would not publish, and treat the fact that
this note is itself reachable as the folder's rule demonstrating itself.

That also makes it the wrong home for anything the app renders. Import those
from `src/` instead, so they get hashed and cache-busted. Only things a browser
or an OS fetches by a fixed, well-known path belong here.

## What is here

| File | Referenced by | Why it must live at a fixed path |
| --- | --- | --- |
| `favicon.svg` | `<link rel="icon">` | Tab icon. Theme-aware: it carries its own `prefers-color-scheme` block, because the browser paints the tab in the viewer's theme and a fixed colour goes invisible in one of them. |
| `apple-touch-icon.png` | `<link rel="apple-touch-icon">` | 180×180. iOS composites home-screen icons on an opaque ground, so this one is **not** transparent — dark `#26262a` plate, light `#e9e8e6` arc, `#d8b494` arrow, the sidebar's own treatment. It is also the one copy where the mark is **inset** rather than full-bleed (116 of 180), because iOS masks the icon to a squircle and ink in the corners is ink thrown away. |

There is deliberately **no** `favicon.ico` or PNG fallback. Every browser that
can run this app supports SVG favicons; an old one shows no icon, which is
cosmetic. Adding a fallback means a second file to keep in sync with the mark.

## The mark, and its three copies

Both icons draw **the Quirenote mark** (D131): an open `Q` — an r32 arc, stroke
13, round caps, gapped at the top-right — whose tail is a sand arrow. Three
paths, no opacities.

**The viewBox is cropped to the ink, `9.5 8.5 78 78`, and that is what replaced
mark 04's even-bar-centre rule.** That rule bought whole-device-pixel edges at
16px: a bar spanned `[x-2, x+2]`, which halves to integers only when `x` is
even. An arc has no edge to align — every tangent meets the grid at a different
angle, so there is no parity to choose — and the only lever left is how much of
the box the drawing gets. It gets all of it. The arc's ink spans `[9.5, 86.5]`
on both axes (centre 48,48 · r32 · stroke 13) and the arrowhead reaches x 87.5
and y 8.5 (tip 86,10 with a 3-wide round join), so the union is exactly 78 × 78
at (9.5, 8.5). Two things follow: a 16px tab gets **2.67px** of stroke where the
owner's padded 96-box would give 2.17px, and a 36px sidebar mark is 36px of
drawing — the diameter the retired disc had.

What is pinned instead is the drawing's own construction, asked of the parsed
numbers rather than the path strings: the arc is a true circle (both endpoints
r32 from the box centre, agreeing with its own `A32 32`), the arrow sits on one
45° diagonal (shaft ends, head tip and head-base midpoint all satisfy
`x + y = 96`, exactly), and the head's base is perpendicular to the shaft (dot
product 0, exactly).

The mark exists in **three** places, and they must change together:

| Copy | Guarded by |
| --- | --- |
| `Mark` in `src/app/Sidebar.tsx` | `src/app/mark.test.ts` — pins paths, stroke widths, the ink-cropped box, the three construction invariants, and that the component holds **no hex** |
| `public/favicon.svg` | the same test, compared path-for-path against the component |
| `public/apple-touch-icon.png` | **nothing automatic** — regenerate with `node scripts/build-touch-icon.mjs` |

The colour split differs by copy, and each difference is forced. The component's
arc is `currentColor` and its arrow is `--color-brand-sand`, because a component
can read tokens and must not hold hex. The favicon cannot read tokens — it is a
standalone file the browser fetches — so it carries four literals and flips them
on `prefers-color-scheme`: the arc between `#26262a` and `#e9e8e6`, the arrow
between `#9c683a` and `#d8b494`. That arrow pair is the one place `#9c683a` is
used at all; on the app's own sidebar plate, dark in both themes, it would
measure 2.67:1 (see `--color-brand-sand` in `src/index.css`).

The PNG is the weak link and it is worth knowing why: comparing a raster to an
SVG needs a renderer the test environment does not have, and a PNG shows up in
review as `Bin 0 -> 2419 bytes`, so drift there is invisible to both the suite
and the reader. Hence the checked-in regeneration step — run it whenever the
geometry moves, and the icon follows instead of quietly keeping the old drawing.
