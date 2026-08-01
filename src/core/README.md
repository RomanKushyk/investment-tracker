# src/core/ — pure domain layer

The app's pure domain layer per decision G1 (`docs/NEXT-PHASE-PLAN.md`) and `docs/DECISIONS.md` D8. Consolidated in next-phase Phase 1 from v1's `src/lib/{types,derive,format,colors,asset-builder,schemas}` plus `src/screens/shared/` (now dissolved). The v1 pinned contracts (`docs/BUILD-PLAN.md`) keep their exact shapes — only module paths changed.

## Layout

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Domain types (`Asset`, `Snapshot`, `Transaction`, …) — v1 pinned contracts, moved verbatim |
| `derive.ts` | Every displayed figure derives from these (D5 reconciliation rules); `headlineKpis` is the sidebar's single KPI source |
| `money.ts` | Number/currency/date formatting (README §8) + **the one signing helper** `signed()` — U+2212 minus everywhere (D8) |
| `dates.ts` | Pure ISO date math: `todayIso` (single source, was triplicated), `daysBetween`, `latestSnapshotDate`, `addMonths` (month-end clamped) |
| `colors.ts` | Chart paint as `var(--color-chart-*)` strings (aliases resolve in `src/index.css` `@theme`); `COLOR_KEYS` cycle for new assets |
| `asset-builder.ts` | `buildNewAsset` (quick-create pinned rules) + the P2 AssetForm mappers `assetFromForm` (create) / `assetPatchFromForm` (edit patch; hidden fixed-coupon fields are never touched, visible emptied ones clear via explicit `undefined`) |
| `schemas.ts` | zod form schemas: `quoteInputSchema`, `assetFormSchema(mode)` (all editable Asset fields incl. the `inzhur {kind, ref, units}` group; `'none'` schedule accepted in edit mode only), `transactionSchema` — schemas emit paths, never English (D8) |
| `xirr.ts` | Money-weighted annualized return (Newton–Raphson + bisection fallback) per the P1 formula audit (D13, `docs/FORMULA-AUDIT.md` §6.1) |
| `backup/` | `json.ts` — backup envelope v1 (`kubushka-backup`) serializer + zod validator (D12) |
| `inzhur/` | `__fixtures__/assets-sample.json` (trimmed live capture of `GET https://www.inzhur.reit/_api/assets`, 2026-07-28); Phase 3's `parse.ts` lands here |

Later per the plan: `accrual`, `reminders`, `day-deltas`.

## Rules

- **Pure only** — core imports nothing but core (no react, no dexie, no zustand, no `lib/`, no UI layers). Machine-enforced by the ESLint `no-restricted-imports` zones in `eslint.config.js`.
- **Structured returns (D8)** — core and `screens/<route>/` pure modules return keys/tokens (`{schedule, day}`, ISO dates, plain numbers), never assembled English prose; the component layer owns the words (e.g. `components/ui/date-labels.ts`, `components/ui/schedule-labels.ts`). i18n lands in Phase 5.
- **One sign convention** — every signed display string routes through `money.signed()`: U+2212, never ASCII `-`.
- Every module with logic ships a colocated `*.test.ts` (vitest, node env). Exceptions: `types.ts` (type-only) and `colors.ts` (static token-string tables, exercised through their chart consumers).
