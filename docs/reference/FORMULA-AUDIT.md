# Formula audit — WEALTH-MANAGEMENT-ARCHITECTURE reconciliation

Every challenge in `docs/reference/WEALTH-MANAGEMENT-ARCHITECTURE.md` — the owner's spreadsheet-era
business-logic spec — checked term by term against the app's core derivations. No formula changed
after the sweep, and three depart from the doc's letter: §4 improves on it, §3 matches it exactly
with the clamp moved into the callers, and §6.2 is not implemented yet.
Everything else is verbatim. The formulas live in `src/core/derive.ts` unless noted, and every
figure the audit turned on is pinned by a vitest fixture, which is where a figure belongs. The
companion decision is *Metric families and windows*.

Code comments cite this file by its old challenge numbers: `§1` is free cash, `§2` the
capital-gain-versus-total-return pair (whose figures are pinned in `src/core/derive.test.ts`),
`§3` the rebalancing top-up, `§4` latest-price and null handling, `§5` global ROI's denominator,
`§6.1` XIRR and `§6.2` seasonality. "Fintech rulings" is the numbered list below.

## Where the implementation departs from the doc

- **An unquoted asset is ABSENT, never 0.** `latestQuotes` merges partial snapshots per asset, so a
  headline figure is built from each asset's own most recent quote rather than from one complete
  day — "previous close" as merge behaviour. An asset never quoted contributes nothing to a headline
  figure — its Balances cell reads "pending" on and after its first purchase and "—" before it —
  where the doc's "return 0" would corrupt `headlineTotal` and every share and net figure downstream.
- **`topUpAmount`'s clamp lives in the callers.** The formula is
  `(target×total − value) / (1 − target)`, identical to the doc's; the doc's
  `TargetShare <= CurrentShare → 0` branch is applied by whoever calls it, not inside it.
- **Seasonality's day-of-month returns carry a flagged improvement.** The doc's own formula ignores
  flow contamination — a same-day buy or reinvest moves the value without being a return — so the
  reinvest amounts have to be subtracted before dividing.

## Rulings a reader would otherwise re-litigate

1. **Float money with display-only rounding.** JS doubles are acceptable at this scale; round **only
   at display, to 2 dp** (`core/money.ts`), and never accumulate rounded intermediates.
   Integer-kopeck representation was consciously rejected. Revisit on multi-currency arithmetic or
   lot-level sells.
2. **Zero-denominator guards return `null`** (rendered "—"), never NaN or Infinity:
   `capitalGainPct`, `totalReturnPct`, `cashYieldPct`, `globalRoi`, `xirr`. `globalRoi` also returns
   null for netDeposits **≤ 0**, a non-positive external-capital base flipping the ratio's sign into
   nonsense.
3. **No FIFO/lot cost basis.** Sells use the cash-flow model: after a partial sell, per-asset
   capital-gain % is ambiguous without lots, and total return is the honest metric.
4. **Day count is ACT/365 everywhere** — `annualizedPct` ×365/daysHeld and the `xirr` exponents —
   matching Excel XIRR and the OVDP convention, with leap days counted as actual days over a 365
   denominator. **The one exception is `dailyAccrual`**, which spreads a KNOWN coupon over its OWN
   period (ACT/ACT in-period) when the provider's `paymentSchedule` supplies the dates: that is the
   amortisation of a scheduled cash flow rather than a rate annualisation, and only this basis makes
   the ghost land exactly on the coupon, the real bonds paying every 182 days. With no schedule
   available the ACT/365 approximation still applies.
5. **Percentages are fractions in core** (0.053 = +5.3 %), matching `yieldSinceStart`; display
   multiplies. `sharePct` is the pre-existing exception — it returns 0–100 and stays pinned.
6. **Tax attribution, settled in THREE separate moments**, worth keeping apart because the ruling
   used to date all of them to "the migration". **(a) In the APP, now:** the withholding is a FIELD
   on the payout (`Transaction.taxWithheld`), the `tax` type is retired, and the category split is
   EXACT — `incomeReceivedNet` returns dividends and coupons net rather than gross with a net total
   beneath them, so this ruling's old limitation has lapsed. **(b) In the STORE:**
   `transaction.tax_withheld` with its three CHECKs, and `transaction_asset_present_ck` widened to
   six types so a withholding is always attributable; the draft carries both and the migration
   applies them. **(c) In the DERIVATIONS:** free cash's two exclusions are retired, so a payout's
   signed amount is `amount − coalesce(taxWithheld, 0)` and a reinvest debits its own amount.
   Coupon suggestions never drafted a tax row and still draft no withholding, OVDP coupons being
   PIT-exempt in UA.
7. **Naming map (app ↔ doc):** `dividend_accrual` ↔ Dividend Payout · `interest_payout` ↔ Interest
   Payout · `reinvest` ↔ Reinvestment · `withdrawal` ↔ Withdrawal · `redemption` ↔ Bond Redemption ·
   `buy`/`sell` ↔ Buy/Sell (all buys own-funded today). The §2.1/§5.1 portfolio totals deliberately
   use the doc's VERBATIM identifiers — `payoutsGross`, `taxesPaid`, `payoutsNet`, `soldAmount`,
   `netDeposits` — rather than the older `…Total` suffix convention (`reinvestedTotal`,
   `depositedTotal`), because doc traceability wins for the reconciliation family; parameter names
   disambiguate where a sibling function already owns the natural name (`payoutsNetAmount`,
   `totalCapitalAmount`, `netDepositsAmount`).
8. **Backup amounts are positive magnitudes**, `amount: z.number().positive()`, the sign carried by
   the TxType. A hand-edited negative `withdrawal` would double-flip signs in `netDeposits` and
   `freeCashFromLedger`; app-produced backups never contain non-positive amounts, so refusing them
   costs no compatibility.

## Dual metric families — the one-page mental model

| | Capital-gain family | Total-return family (doc §2.1/§5) |
|---|---|---|
| Invested basis | `investedByAsset` = buys + reinvests | `investedOwnByAsset` = buys only |
| Result | `netResult` = value − invested | `totalNetProfit` = value + payoutsNet + sold − investedOwn − reinvested |
| Relative | `yieldSinceStart`, `annualizedPct` | `totalReturnPct` (÷ investedOwn), `cashYieldPct`, `xirr` |
| Global | headline `netResult` KPI | `globalRoi` (÷ `netDeposits`) |
| Cash | retired with the observed balance | `freeCashFromLedger` — the ledger's signed sum, nothing stored |

**Both families are permanent and must never be conflated** — the headline percentage divides by
buys + reinvests, which is exactly the denominator corruption the doc's §5 bans, so the two live
side by side under distinct labels rather than one replacing the other. The audit was additive: no
figure pinned by *Derived figures and the seed* changed.

**One real numeric bug came out of it**, worth knowing because the shape recurs: `xirr`'s bisection
scan started half a step inside its own domain floor, so a root just above `RATE_MIN` was never
bracketed and the function returned null for a rate it promised to find. NPV is finite at −0.999 —
the asymptote is at −1 — so the offset bought nothing, and the scan now starts at `RATE_MIN` exactly.
