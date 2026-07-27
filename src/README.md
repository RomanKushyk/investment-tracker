# src/ — Application code

Rules for working in this folder. The binding API contracts (types, repository/hook/store signatures, token names) live in **`docs/BUILD-PLAN.md` → "Pinned contracts"** — follow them exactly; changing one requires updating every consumer plus a `docs/DECISIONS.md` entry.

## Structure

| Path | Responsibility |
|------|----------------|
| `main.tsx` | Fonts, `QueryClientProvider`, `RouterProvider`, `<Toaster/>` (Task 3+) |
| `index.css` | Tailwind import + `@theme` tokens + base styles |
| `routes.tsx` | `createBrowserRouter`: `Layout` wraps 9 eager routes |
| `app/` | Shell: `Layout.tsx`, `Sidebar.tsx` |
| `lib/` | Data + logic (Task 2): `types` · `colors` · `db` · `repository` · `seed` · `derive` · `format` · `schemas` (+ their vitest specs) |
| `hooks/` | `queries.ts` — TanStack Query hooks + mutation invalidation |
| `state/` | Persisted zustand stores: `settings.ts`, `draft.ts` |
| `components/ui/` | Reusable primitives (CVA variants as they appear) |
| `components/charts/` | One wrapper per recharts chart (Task 6) |
| `screens/` | One component per route |

## Hard rules

- **`lib/db.ts` is imported ONLY by `lib/repository.ts`.** Components/hooks consume data exclusively through the repository via the TanStack Query hooks.
- **Palette only via `@theme` tokens** (`bg-sidebar`, `text-muted`, …) — no ad-hoc hex in components. Charts take hex from `lib/colors.ts` (mirrors the tokens; keep in sync).
- **No hard-coded portfolio figures anywhere** — every displayed number derives from stored data (`lib/derive.ts`). Placeholders before the data layer exist show "—".
- **Fonts:** `font-display` (Space Grotesk) for headings/`.btn`-style buttons/KPI numbers; `font-body` (Spline Sans Mono, the body default) for everything else — note the sidebar nav pills and currency toggle inherit the mono body font (matches the reference markup).
- Formatting/derivation logic lives in `lib/format.ts` / `lib/derive.ts` (pure, unit-tested) — never inline in components.
