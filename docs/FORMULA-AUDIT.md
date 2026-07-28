# Formula audit — WEALTH-MANAGEMENT-ARCHITECTRUE reconciliation

The Phase 1 `feat/formula-parity` reconciliation record (NEXT-PHASE-PLAN P1, user
requirement): every challenge in `docs/WEALTH-MANAGEMENT-ARCHITECTRUE.md` (the
user's spreadsheet-era business-logic spec) checked against the app's core
derivations, gaps implemented, deviations pinned. Companion decision:
`docs/DECISIONS.md` D13. All formulas live in `src/core/derive.ts` unless noted;
every validation figure below is enforced by a vitest fixture
(`src/core/derive.test.ts`, `src/core/xirr.test.ts`, `src/lib/seed.test.ts`).

**How it was verified:** a three-lens pass over the complete core formula set —
*correctness* (guards, float behavior, convergence edges — each claim pinned as a
test), *doc-parity* (term-by-term comparison against the doc's formulas; every
divergence is deliberate and recorded here), *fintech practice* (the rulings
section below). Outcome: no formula changed after the sweep; two doc formulas are
implemented with documented deviations (§1, §6.2), everything else is verbatim.

## Challenge-by-challenge record

### §1 SSOT — Free Cash derived from the ledger

| | |
|---|---|
| **Challenge** | "Free Cash was entered manually or calculated residually → leaks. The transactions ledger must be the only mutator; cash must be derived state" (doc §1.1 formula). |
| **App formula** | `freeCashFromLedger(txs)` + `ledgerCashDrift(storedCash, txs)` — `src/core/derive.ts`. New TxTypes `withdrawal` + `redemption` added to `core/types.ts`, `core/schemas.ts`, `core/backup/json.ts` (domain-wide; the TransactionPanel select exposes them in P2). |
| **Validation** | `freeCashFromLedger(SEED_TRANSACTIONS)` = **7,75** = deposits 143 176,37 − own-funded buys 143 168,62 — exactly the stored cash of every seeded snapshot; `ledgerCashDrift(latestCash, seed)` = 0. The doc-verbatim formula (+ payouts 5 040,94 − reinvests 1 387,38) would give **3 661,31 ✗**. |
| **Verdict** | **Resolved with deviation** (pinned): `FreeCash = deposits − withdrawals − buys + sells + redemptions`. Payout/reinvest/tax rows are **excluded** because payouts are external unless reinvested (the user's real Inzhur config routes dividends to a bank account, and paying taxes happens there too), and a reinvest is funded by its paired same-date payout — net zero broker-cash effect. `Snapshot.cash` stays the *observed* balance; the ledger result is a **reconciliation check** (drift warning surfaces in P2 — that half is deferred-to-P2-UI). Revisit triggers: (1) a payout `destination` field lands → broker-credited payouts join the sum; (2) a buy funded from accrual sources appears in real data → the buy term gains a source filter. |

### §2 Capital Gain vs Total Return + the Tax Illusion

| | |
|---|---|
| **Challenge** | Payout-dropping instruments (OVDP, REIT) show an "illusion of loss" when profit = value − invested; ignoring tax rows inflates gross ROI. Decompose into Capital Gain vs Total Return, strictly net of taxes (doc §2.1). |
| **App formula** | `investedOwnByAsset`, `payoutsGross[ByAsset]`, `taxesPaid[ByAsset]`, `payoutsNet[ByAsset]`, `soldAmount[ByAsset]`, `capitalGain`, `capitalGainPct`, `totalNetProfit`, `totalReturnPct` (denominator `investedOwn` — external capital only, same rationale as §5), `cashYieldPct`, `incomeReceivedNet` — all `src/core/derive.ts`. |
| **Validation** | The user's real …6475 position: investedOwn 4 496,40, value 4 379,52, coupons 355,40, taxes 0 → `capitalGain` **−116,88** (−2.6 %) but `totalNetProfit` **+238,52**, `totalReturnPct` **+5.30 %**, `cashYieldPct` +7.9 %. Tax netting: payout 467,46 − tax 65,44 → `payoutsNet` **402,02**. |
| **Verdict** | **Resolved** (core); UI exposure **deferred-to-P2-UI** (`feat/metrics-exposure`: KPI relabel, Yield/Portfolio columns). The v1 metrics (`netResult`, `yieldSinceStart`, `investedByAsset`) stay untouched — they ARE the CapitalGain family and back every D5-pinned figure; P2 relabels them so the families are never conflated. `incomeReceivedNet` keeps `dividends`/`coupons` gross and nets only `total` — a `tax` row carries an assetId but not which payout it taxed, so per-category attribution would be guesswork (ruling below). |

### §3 Rebalancing — the moving-target problem

| | |
|---|---|
| **Challenge** | `target×total − value` never reaches the target because the injection grows the denominator (doc §3.1). |
| **App formula** | `topUpAmount(value, targetPct, total)` = `(target×total − value)/(1 − target)` — identical to the doc's RequiredTranche. Pre-existing in v1; §3.1 doc-reference JSDoc added. |
| **Validation** | …8976 top-up **₴11 429,49** on the seed (pinned test; reference prints 11 413 — mock rounding, D5#4). Trim stays linear (`trimAmount`, −₴9 095) — the doc only constrains the top-up direction. |
| **Verdict** | **Resolved** (was already exact). |

### §4 Latest-price querying + null handling

| | |
|---|---|
| **Challenge** | Fetch the latest price per asset robustly (no array-manipulation lookups); doc §4.1 note says "handle null gracefully (e.g. return 0 or previous_close)". |
| **App formula** | `latestQuotes(snaps)` — sorted merge of partial snapshots per asset; §4 doc-reference JSDoc added. |
| **Validation** | Seed: REIT from the partial 27.07 (68 702,10) merged over the other three from 25.07 → headline **₴149 016,36** (D5#1 pinned test). |
| **Verdict** | **Resolved — better than the doc.** "Previous close" is the merge behavior; but an asset never quoted stays **absent** ("pending", rendered "—"), never 0 — the doc's "return 0" would corrupt `headlineTotal` and every share/net figure downstream. Documented improvement. |

### §5 Global ROI — denominator corruption

| | |
|---|---|
| **Challenge** | Reinvested dividends counted as user-deposited capital dilute Global ROI; measure strictly against external deposits (doc §5.1). |
| **App formula** | `netDeposits(txs)` = deposits − withdrawals; `globalRoi(totalCapital, netDeposits)` = (totalCapital − netDeposits)/netDeposits — `src/core/derive.ts`. |
| **Validation** | Seed: NetDeposits **143 176,37**; TotalCapital 149 016,36; NetFinancialResult **+5 839,99**; GlobalROI **+4.0789 %** (pinned to 4 dp). |
| **Verdict** | **Resolved additively.** The v1 headline "+3.08 %" divides by buys+reinvests — exactly the corruption §5 bans — but it is D5-pinned, so it stays as the capital-gain-family KPI (relabeled in P2) and the doc-compliant metric ships beside it. No pinned figure changed (additive-metrics rule). Surfacing **deferred-to-P2-UI**. |

### §6.1 XIRR / CAGR

| | |
|---|---|
| **Challenge** | Simple scaling is not money-weighted; use XIRR (Newton-Raphson) over dated flows (doc §6.1). |
| **App formula** | `xirr(flows)` — `src/core/xirr.ts`, pure, zero deps: NPV root via Newton-Raphson from r₀ = 0.1, sign-change scan + bisection fallback, ACT/365, result domain (−0.999, 10), all degenerate inputs → null. |
| **Validation** | −1 000 → +1 080 over exactly one year → **0.08**; the Excel XIRR documentation example (−10 000 / 2 750 / 4 250 / 3 250 / 2 750 over 2008-01-01…2009-04-01) → **0.373362535** (6 dp); order-independence, negative rates, and every null guard pinned in `xirr.test.ts`. |
| **Verdict** | **Resolved** (core); surfacing **deferred-to-P2-UI**, alongside — never replacing — the v1 simple `annualizedPct` (its PORTFOLIO_START daysHeld basis is D5#5-pinned; <1 y figures get a clarity label per plan). |

### §6.2 Seasonality — day-of-month returns

| | |
|---|---|
| **Challenge** | Average % price change grouped by day of month (doc §6.2). |
| **App formula** | Not in P1 — lands as `core/day-deltas.ts` in **Phase 6** (`feat/seasonality-cap`). |
| **Validation** | Planned fixtures: seed reinvests 687,02 / 484,36 / 216 must be subtracted before dividing (flow adjustment). |
| **Verdict** | **Deferred to P6** with a flagged improvement: the doc's own formula ignores flow contamination (same-day buys/reinvests inflate position-value "returns"); the P6 implementation is flow-adjusted percentage return, averaged per day-of-month. |

## Fintech-practice rulings (pinned)

1. **Float money with display-only rounding.** JS doubles are acceptable at this
   scale. Round **only at display, to 2 dp** (`core/money.ts`); derivations never
   accumulate rounded intermediates. Integer-kopeck representation consciously
   rejected. Revisit triggers: multi-currency arithmetic or lot-level sells.
2. **Zero-denominator guards return `null`** (rendered "—"), never NaN/Infinity:
   `capitalGainPct`, `totalReturnPct`, `cashYieldPct`, `globalRoi`, `xirr`.
   Additionally `globalRoi` returns null for netDeposits **≤ 0** (over-withdrawn:
   a non-positive external-capital base flips the ratio's sign into nonsense).
3. **No FIFO/lot cost basis.** Sells use the cash-flow model — after a partial
   sell, per-asset capital-gain % is ambiguous without lots; total-return is the
   honest metric. Revisit only if lot-level tracking ever becomes a requirement.
4. **Day count = ACT/365** everywhere (annualizedPct ×365/daysHeld, xirr
   exponents) — matches Excel XIRR and the OVDP convention; leap days count as
   actual days over a 365 denominator.
5. **Percentages are fractions in core** (0.053 = +5.3 %), matching
   `yieldSinceStart`; display multiplies. (`sharePct` is the pre-existing v1
   exception — it returns 0–100 and stays pinned.)
6. **Tax attribution:** a `tax` row nets against its asset's payouts
   (`payoutsNetByAsset`) and the income **total** (`incomeReceivedNet`), but
   dividends-vs-coupons category nets are not derivable from the row shape —
   not guessed. Coupon suggestions never auto-draft tax rows (G5: OVDP coupons
   are PIT-exempt in UA; the type stays available manually).
7. **Naming map (app ↔ doc):** `dividend_accrual` ↔ Dividend Payout ·
   `interest_payout` ↔ Interest Payout · `reinvest` ↔ Reinvestment ·
   `withdrawal` ↔ Withdrawal · `redemption` ↔ Bond Redemption · `buy`/`sell` ↔
   Buy/Sell (all buys own-funded today, see §1 revisit trigger 2).

## Dual metric families (the one-page mental model)

| | Capital-gain family (v1, D5-pinned) | Total-return family (doc §2.1/§5, this audit) |
|---|---|---|
| Invested basis | `investedByAsset` = buys + reinvests | `investedOwnByAsset` = buys only |
| Result | `netResult` = value − invested (＋3.08 % seed) | `totalNetProfit` = value + payoutsNet + sold − investedOwn − reinvested |
| Relative | `yieldSinceStart`, `annualizedPct` | `totalReturnPct` (÷ investedOwn), `cashYieldPct`, `xirr` |
| Global | headline `netResult` KPI | `globalRoi` (÷ `netDeposits`, ＋4.08 % seed) |
| Cash | `Snapshot.cash` (observed) | `freeCashFromLedger` + `ledgerCashDrift` (reconciliation check) |

Both families are permanent; P2 labels them distinctly and never conflates them.
No D5-pinned figure changed in this audit (additive-metrics rule, verified: the
21 pre-existing test files run untouched except sanctioned import/fixture adds).
