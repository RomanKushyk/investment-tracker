# src/core/ — pure domain layer

The app's pure domain layer per decision G1 (`docs/NEXT-PHASE-PLAN.md`) and `docs/DECISIONS.md` D8. Consolidated in next-phase Phase 1 from v1's `src/lib/{types,derive,format,colors,asset-builder,schemas}` plus `src/screens/shared/` (now dissolved). The v1 pinned contracts (`docs/BUILD-PLAN.md`) keep their exact shapes — only module paths changed.

## Layout

| Module | Responsibility |
|--------|----------------|
| `types.ts` | Domain types (`Asset`, `Snapshot`, `Transaction`, …) — v1 pinned contracts, moved verbatim; plus `QuoteOrigin`/`QuoteSource`, the provenance of an unsaved quote DRAFT (P3 D20 — stored in `state/draft.ts`, never in a Dexie row) |
| `derive.ts` | Every displayed figure derives from these (D5 reconciliation rules); `headlineKpis` is the sidebar's single KPI source |
| `money.ts` | Number/currency/date formatting (README §8) + **the one signing helper** `signed()` — U+2212 minus everywhere (D8) |
| `dates.ts` | Pure ISO date math: `todayIso` (single source, was triplicated), `daysBetween`, `latestSnapshotDate`, `addMonths` (month-end clamped) + the Europe/Kyiv helpers `kyivDateIso` / `kyivTimeHm` / `msUntilNextKyivHour` (offset always read from `Intl`, never a hardcoded +2/+3 — D19) |
| `colors.ts` | Chart paint as `var(--color-chart-*)` strings (aliases resolve in `src/index.css` `@theme`); `COLOR_KEYS` cycle for new assets |
| `asset-builder.ts` | `buildNewAsset` (quick-create pinned rules) + the P2 AssetForm mappers `assetFromForm` (create) / `assetPatchFromForm` (edit patch; hidden fixed-coupon fields are never touched, visible emptied ones clear via explicit `undefined`) |
| `schemas.ts` | zod form schemas: `quoteInputSchema`, `assetFormSchema(mode)` (all editable Asset fields incl. the `inzhur {kind, ref, units}` group; `'none'` schedule accepted in edit mode only), `transactionSchema` — schemas emit paths, never English (D8) |
| `xirr.ts` | Money-weighted annualized return (Newton–Raphson + bisection fallback) per the P1 formula audit (D13, `docs/FORMULA-AUDIT.md` §6.1) |
| `backup/` | `json.ts` — backup envelope v1 (`kubushka-backup`) serializer + zod validator (D12); the format/version gate `readEnvelopeHead`, the row schemas and the structured `integrityIssues`/`RowIssue` vocabulary are shared with the importer. `import.ts` (P4 D24) — `classifyImportFiles` (the four S2 file gates), `validateImport` (format dispatch → row schemas → referential integrity, all as structured issues) and `diffBackup` (per-table added/replaced/removed + the six warning tokens the S3 dialog lists). **It extends `json.ts`, never forks it**, and it writes nothing: the caller reads the file, the Confirm press does the write |
| `accrual.ts` | Fixed-yield automation (P3 D21): `dailyAccrual` (stated coupon ÷ period, else the `expectedPct × invested` fallback — ACT/365), `couponsInGap` (a coupon paid in the gap DROPS the price), `suggestedQuote` (S4's ghost carry-forward, clamped at maturity), `couponRecorded` (the ONE ±7-day dedupe predicate), `nextUnsettledCoupon` (walks the asset's grid past recorded/skipped occurrences — the ONE coupon-occurrence source, shared by `dueCoupons` and `reminders`, D23), `dueCoupons` (S5), `rollNextCoupon` (clamps onto `maturity`, then flags `matured`; takes the occurrence to roll off), `couponProjection` (the Overview/Seasonality projection incl. user-created bonds), `couponReminderId` (the derived id the S5 skip and the S6 reminders share) |
| `reminders.ts` | Serverless reminders (P3 D22/D23): `computeReminders` (coupon kinds read `accrual.nextUnsettledCoupon`, so a settled occurrence hands over to the next one) → the pinned `Reminder[]` contract (four kinds with DERIVED ids — `quote-missing:<date>`, `coupon:…`, `coupon-overdue:…`, `maturity:…` — severity tokens, ordered overdue → warn → info, dismissals filtered), the id builders, `DEFAULT_LEAD_DAYS`/`MATURITY_LEAD_DAYS` and `isLeadDays` (the one 1–30 validity rule, shared by the S8 field and the persist sanitizer). Derive-don't-schedule: nothing is stored, so dismissals expire with their occurrence |
| `inzhur/` | `parse.ts` — tolerant pick-parse of the public feed (unknown fields ignored, per-entry skip), `kopecksToUah` (the ONE ₴ conversion), `positionValue`, `nextPaymentOnOrAfter`/`couponForecast`, `matchAssets` (slug/ISIN, trimmed + case-insensitive), the feed `title` for the S7 picker rows — policy in D19; `__fixtures__/assets-sample.json` (trimmed live capture of `GET https://www.inzhur.reit/_api/assets`, 2026-07-28) is the test basis |

Later per the plan: `day-deltas`.

## Rules

- **Pure only** — core imports nothing but core (no react, no dexie, no zustand, no `lib/`, no UI layers). Machine-enforced by the ESLint `no-restricted-imports` zones in `eslint.config.js`.
- **Structured returns (D8)** — core and `screens/<route>/` pure modules return keys/tokens (`{schedule, day}`, ISO dates, plain numbers), never assembled English prose; the component layer owns the words (e.g. `components/ui/date-labels.ts`, `components/ui/schedule-labels.ts`). i18n lands in Phase 5.
- **One sign convention** — every signed display string routes through `money.signed()`: U+2212, never ASCII `-`.
- Every module with logic ships a colocated `*.test.ts` (vitest, node env). Exceptions: `types.ts` (type-only) and `colors.ts` (static token-string tables, exercised through their chart consumers).
