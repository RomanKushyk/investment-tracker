# src/core/ — pure domain layer (being built)

Created in next-phase Phase 0 to host `inzhur/__fixtures__/assets-sample.json` (trimmed live capture of `GET https://www.inzhur.reit/_api/assets`, 2026-07-28: the two funds by slug + bonds UA4000238976/UA4000236475 with prices, payment schedules in kopecks, maturities).

Phase 1 (`docs/NEXT-PHASE-PLAN.md`) turns this folder into the app's pure domain layer per decision G1: `types / derive / money / dates / colors / asset-builder / schemas`, later `backup/ inzhur/ xirr accrual reminders day-deltas`. Rules once populated:

- **Pure only** — core imports nothing but core (no react, no dexie, no zustand, no `lib/`). Enforced by ESLint `no-restricted-imports` zones.
- **Structured returns** — modules return keys/tokens, never assembled English prose (i18n lands in Phase 5).
- Every module ships a colocated `*.test.ts` (vitest, node env).
