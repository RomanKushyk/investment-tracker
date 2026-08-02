# src/ — Application code

Rules for working in this folder. The binding API contracts (types, repository/hook/store signatures, token names) live in **`docs/BUILD-PLAN.md` → "Pinned contracts"** — follow them exactly; changing one requires updating every consumer plus a `docs/DECISIONS.md` entry.

## Structure

| Path | Responsibility |
|------|----------------|
| `main.tsx` | Fonts, `QueryClientProvider`, `RouterProvider`, `<Toaster/>` (Task 3+) |
| `index.css` | Tailwind import + `@theme` tokens + base styles |
| `routes.tsx` | `createBrowserRouter`: `Layout` wraps 10 eager routes (incl. `/settings`, next-phase P2) |
| `app/` | Shell: `Layout.tsx`, `Sidebar.tsx` |
| `core/` | **Pure domain layer** (G1, D8): `types` · `derive` · `money` · `dates` · `colors` · `asset-builder` · `schemas` · `xirr` · `backup/` (+ colocated vitest specs) — see `core/README.md` |
| `lib/` | Persistence/infra only: `db` (Dexie factory `makeDb(name)`; binds the active dataset's DB — `kubushka` demo / `kubushka-live` — at module init from the persisted `dataset` flag, G4/D16) · `repository` · `seed` (+ tests) |
| `hooks/` | `queries.ts` — TanStack Query hooks + mutation invalidation |
| `state/` | Persisted zustand stores: `settings.ts`, `draft.ts` |
| `components/ui/` | Reusable primitives (CVA variants as they appear; `Dialog.tsx` = the S6 modal idiom — `Dialog` plus the `AlertDialog` destructive-confirm variant, D17) |
| `components/charts/` | One wrapper per recharts chart (Task 6) |
| `components/forms/` | Shared form bodies: `AssetForm.tsx` (standalone create/edit + the fields component the TransactionPanel quick-create reuses) + its non-component companion `asset-form.ts` (defaults, options, pinned error copy) |
| `screens/` | One component per route (per-route pieces in `screens/<route>/`, e.g. `screens/settings/AssetManager.tsx`) |

## Hard rules

- **`lib/db.ts` is imported ONLY by `lib/repository.ts`.** Components/hooks consume data exclusively through the repository via the TanStack Query hooks. Machine-enforced by the ESLint `no-restricted-imports` zones in `eslint.config.js`, along with core-imports-only-core (G1).
- **Palette only via `@theme` tokens** (`bg-sidebar`, `text-muted`, …) — no ad-hoc hex in components. Charts take `var(--color-chart-*)` strings from `core/colors.ts` (aliases resolve in `index.css` `@theme`).
- **No hard-coded portfolio figures anywhere** — every displayed number derives from stored data (`core/derive.ts`). Placeholders before the data layer exist show "—".
- **Fonts:** `font-display` (Space Grotesk) for headings/`.btn`-style buttons/KPI numbers; `font-body` (Spline Sans Mono, the body default) for everything else — note the sidebar nav pills and currency toggle inherit the mono body font (matches the reference markup).
- Formatting/derivation logic lives in `core/money.ts` / `core/derive.ts` (pure, unit-tested) — never inline in components. Per-screen pure glue lives in `screens/<route>/<route>.ts` and imports core only; both return structured tokens, never assembled English prose (D8) — label words live in the component layer (e.g. `components/ui/date-labels.ts`).
- **Motion (D7):** every interaction animates softly — `transition active:scale-[.97]` on pressables, `animate-in` reveals, keyed route transitions. Standards: `docs/BUILD-PLAN.md` → "Motion & interaction standards". The `prefers-reduced-motion` kill-switch in `index.css` must stay.
