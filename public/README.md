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
| `apple-touch-icon.png` | `<link rel="apple-touch-icon">` | 180×180. iOS composites home-screen icons on an opaque ground, so this one is **not** transparent — dark `#26262a` plate, light `#e9e8e6` mark, the sidebar's own treatment. |

There is deliberately **no** `favicon.ico` or PNG fallback. Every browser that
can run this app supports SVG favicons; an old one shows no icon, which is
cosmetic. Adding a fallback means a second file to keep in sync with the mark.

## The mark, and its three copies

Both icons draw **mark 04** — four bars, height is value, opacity is age. Bar
centres are EVEN (6/12/18/24) with an even stroke (4): a bar spans `[x-2, x+2]`,
which halves to whole device pixels at 16px only when `x` is even. Odd centres
put every edge on a half-pixel and blur the icon.

The mark exists in **three** places, and they must change together:

| Copy | Guarded by |
| --- | --- |
| `Mark` in `src/app/Sidebar.tsx` | `src/app/mark.test.ts` — pins paths, opacities, parity, grid |
| `public/favicon.svg` | the same test, compared path-for-path against the component |
| `public/apple-touch-icon.png` | **nothing automatic** — regenerate with `node scripts/build-touch-icon.mjs` |

The PNG is the weak link and it is worth knowing why: comparing a raster to an
SVG needs a renderer the test environment does not have, and a PNG shows up in
review as `Bin 0 -> 2419 bytes`, so drift there is invisible to both the suite
and the reader. Hence the checked-in regeneration step — run it whenever the
geometry moves, and the icon follows instead of quietly keeping the old drawing.
