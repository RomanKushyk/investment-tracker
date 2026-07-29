# Follow-ups — post-plan cosmetic sweep

Backlog carried out of the 7-task build (see `BUILD-PLAN.md` Status table). All items below were found by task/final reviews, judged **non-blocking** (cosmetic or reachable only on degenerate/empty data), and consciously shipped as-is on 2026-07-28. One branch (`chore/cosmetic-sweep`) can clear the lot.

> **Sweep completed 2026-07-28** — `chore/cosmetic-sweep` squash-merged to `dev`: items **1–6 done** (144 tests, all gates green, browser-verified incl. empty-DB states), item **7 skipped** (optional; no natural touch-point), item **8 no-action** as documented. Backlog is clear.

None of these affect data correctness, derivations, or the §9 behavior checklist — do not reopen §9 for them.

## Items

| # | Where | Issue | Suggested fix |
|---|-------|-------|---------------|
| 1 | `src/screens/Seasonality.tsx` (insight cards) | "Coupon season" card renders "Jun" (shared `MONTH_SHORT`) where the design mock spells "June" (design line 448). | Use full month names in insight-card prose only; keep `MONTH_SHORT` for axes. |
| 2 | `src/components/charts/PayoutsBars.tsx` (`makeTotalLabel`) | Month total label anchors to the *dividends* bar segment and assumes dividends > 0 every month; a future month with coupons but zero dividends would draw the total at the baseline. Not reachable on seed data. | Anchor the label to the topmost non-zero segment. |
| 3 | `src/screens/portfolio/portfolio.ts` (best/laggard selection) | With all-zero quotes (empty DB), Best performer / Laggard tie-break degenerates — first asset wins both cards. | Render the highlight cards' empty state (`EmptyState`) when no asset has a quote. |
| 4 | `src/screens/Allocation.tsx` (donut center) | Center label says "1 assets" for a single-asset portfolio. | Pluralize ("1 asset"). |
| 5 | `src/screens/Overview.tsx` (rebalance hint) + `src/screens/overview/overview.ts` (`mostUnderweightAsset`) | With zero snapshots, every asset is "underweight" by its full target and the hint reads "… top up ₴0.00". Bounded, empty-DB only. | Swap the hint for an `EmptyState` when `headlineTotal === 0`. |
| 6 | `src/screens/Overview.tsx` (`signedProse`), `src/screens/Portfolio.tsx` (`signedTable`) | Negative values use ASCII `-` while the design (and the shared `signedPp` in `src/screens/shared/format.ts`) uses U+2212 `−`. | Route both through / align with the shared helper's U+2212 convention. |
| 7 | `src/screens/Yield.tsx` (table row render) | The `x === undefined ? '—' : fmt(x)` ternary repeats 4× per row. Stylistic; the codebase convention ("no abstraction for single-use code") tolerates it. | Optional: tiny local `dashIf` helper if touching the file anyway. |
| 8 | `src/screens/TransactionPanel.tsx` (lint) | Known react-compiler bailout warning on react-hook-form `watch()` — accepted (compiler skips optimizing the component; no correctness impact). | No action; revisit only if the warning multiplies or RHF ships a compiler-compatible API. |
| 9 | `index.html` (no favicon) | The app ships no favicon, so every page load requests `/favicon.ico` and gets a 404 (one console error on the deployed site; previously masked locally and by the old catch-all rewrite, which returned `index.html` for it). Cosmetic only. | Add a favicon to `public/` and link it in `index.html` — a `₴`-mark glyph matching the sidebar logo circle would suit; note the design reference has no favicon asset, so this is a new decision. |

## Ground rules for the sweep

- One branch `chore/cosmetic-sweep` off `dev`, squash-merged back — same git conventions as the plan (plain conventional commits, no AI attribution).
- Items 3 and 5 are empty-state work: verify with the IndexedDB wipe/manipulation recipe in `navigation-map.md` ("Connecting & resetting"), then reseed.
- Gates as always: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; visual spot-check vs `design/Investment Tracker.dc.html` for items 1, 4, 6.
- Update `navigation-map.md` checkpoints only if visible seed-state copy changes (item 1 does: the Coupon-season card text).
