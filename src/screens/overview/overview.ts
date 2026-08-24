// Pure glue for the Overview screen's derived (non-KPI-grid) cards — imports
// core/ only, returns structured tokens (G1). Covered by overview.test.ts.
import type { PeriodWindow } from '../../core/period';
import { couponProjection, rollNextCoupon } from '../../core/accrual';
import { addMonths, dayBefore, latestSnapshotDate } from '../../core/dates';
import {
  allocationDeltaPp,
  quotesAsOf,
  soldAmountByAsset,
  transactionsFrom,
  headlineTotal,
  headlineTotalAsOf,
  portfolioXirr,
  investedByAsset,
  latestCash,
  ledgerCashDrift,
  netDeposits,
  sharePct,
  topUpAmount,
} from '../../core/derive';
import type { Asset, Snapshot, Transaction } from '../../core/types';

export interface UnderweightResult {
  asset: Asset;
  deltaPp: number;
  topUp: number;
}

// Rebalance hint: the asset furthest UNDER its target share (most negative
// allocationDeltaPp) — ₴149,016.36 total + seed shares -> OVDP …8976 (D5#4).
export function mostUnderweightAsset(
  assets: Asset[],
  values: Record<string, number>,
  total: number,
): UnderweightResult | undefined {
  // Zero snapshots (empty DB) — share/target math degenerates (every asset
  // reads as fully underweight, topUp resolves to ₴0.00). Bail out so the
  // caller can show an empty state instead of a nonsense hint.
  if (total === 0) return undefined;

  let best: UnderweightResult | undefined;
  for (const asset of assets) {
    const value = values[asset.id] ?? 0;
    const deltaPp = allocationDeltaPp(sharePct(value, total), asset.targetPct);
    if (!best || deltaPp < best.deltaPp) {
      best = { asset, deltaPp, topUp: topUpAmount(value, asset.targetPct, total) };
    }
  }
  return best;
}

/**
 * A basis below this renders "—" rather than a ratio. One hryvnia: any smaller
 * denominator is a rounding artefact, not capital, and dividing by it produces
 * a percentage with no meaning (A40 review).
 */
const ROI_BASIS_FLOOR = 1;

/**
 * Whether a window has anything to open against.
 *
 * TWO CASES LOOK THE SAME AND ARE NOT, which a first cut of this guard missed
 * and the suite caught immediately: it rejected the FULL history, where an
 * opening value of 0 is not a missing baseline but the correct one.
 *
 * · Nothing was HELD before the window opened → 0 is right, and the full
 *   history is exactly this case. There is nothing to value.
 * · Something was held but never VALUED — a ledger starting in February whose
 *   first snapshot is in June — → there is no "before", and measuring from 0
 *   reports the entire portfolio as the window's return.
 *
 * So the question is about the LEDGER first and the snapshots second.
 */
function hasBaseline(snapshots: Snapshot[], transactions: Transaction[], w: PeriodWindow): boolean {
  const before = dayBefore(w.from);
  const heldSomething = transactions.some((t) => t.date <= before);
  return !heldSomething || snapshots.some((s) => s.date <= before);
}

export interface TotalReturnKpi {
  uah: number; // the audit's NetFinancialResult = totalCapital − netDeposits
  roi: number | null; // globalRoi fraction; null when netDeposits ≤ 0 → UI renders "—"
}

// "Total return (net)" KPI (S9a) — the §5 total-return family (D13,
// docs/reference/FORMULA-AUDIT.md): performance against EXTERNAL deposits only, shipped
// ADDITIVELY beside the D5-pinned capital-gain KPI (relabeled, never changed).
// Demo: +₴5,839.99 / +4.08% (149 016,36 − 143 176,37 over 143 176,37).
export function totalReturnKpi(snapshots: Snapshot[], transactions: Transaction[]): TotalReturnKpi {
  return totalReturnKpiIn(snapshots, transactions, undefined);
}

/**
 * The net total return over a WINDOW (A40, extension § S3 / D-8).
 *
 * It reduces exactly, the way `/yield`'s builder does and for the same reason:
 * the opening total is measured the DAY BEFORE the window opens, so for the
 * full history there are no snapshots yet, `open` is 0, and both terms collapse
 * to today's `headlineTotal − netDeposits`.
 *
 * THE BOUNDARY IS WHAT MAKES THIS THE RIGHT CARD FOR THE XIRR (D-8). This
 * figure is measured at the portfolio's edge — external capital only — and so
 * is `portfolioXirr`. Every column on `/yield` is measured at the ASSET
 * boundary instead, which is why the annualized counterpart of THIS number has
 * no honest cell over there.
 *
 * FLOWS ARE CLIPPED AT THE BOTTOM ONLY, as on `/yield`: every window ends at
 * the latest valuation, so an upper clip could only ever discard deposits
 * entered since it — which are real, and which every other screen counts
 * (A39 review).
 */
export function totalReturnKpiIn(
  snapshots: Snapshot[],
  transactions: Transaction[],
  w: PeriodWindow | undefined,
): TotalReturnKpi {
  // A WINDOW THAT OPENS BEFORE THE FIRST SNAPSHOT HAS NO BASELINE, and 0 is
  // not one (A40 review). Without this, a ledger starting in February whose
  // first valuation is in June reports the ENTIRE portfolio as three months'
  // return, at several hundred percent. The sheet's S3 matrix names it: the
  // comparison is absent and the figure is "—", never zero.
  if (w !== undefined && !hasBaseline(snapshots, transactions, w)) return { uah: 0, roi: null };
  const close = headlineTotalAsOf(snapshots, w?.to);
  const open = w === undefined ? 0 : headlineTotalAsOf(snapshots, dayBefore(w.from));
  const inside = w === undefined ? transactions : transactionsFrom(transactions, w.from);
  const deposits = netDeposits(inside);
  const basis = open + deposits;
  // COMPUTED HERE RATHER THAN THROUGH `globalRoi`, and a first draft got this
  // wrong in a way only a WINDOW could show: `globalRoi(total, deposits)` is
  // `(total − deposits) / deposits`, so feeding it the windowed gain and the
  // windowed basis subtracted the basis a second time and produced −94 % on a
  // portfolio up 4 133 ₴. The reduction test could not catch it — at the full
  // history `open` is 0, and the two expressions agree exactly there.
  const uah = close - open - deposits;
  // `basis <= 0` IS NOT THE WHOLE GUARD, and `globalRoi`'s doc says why: a
  // denominator near zero flips the figure into nonsense as surely as a
  // negative one. A window that opens with 100 000 and sees 99 900 withdrawn
  // leaves a basis of 100 and would render hundreds of percent on the headline
  // card. `null` renders "—", which is the honest answer to "return on what?"
  // (A40 review).
  return { uah, roi: basis < ROI_BASIS_FLOOR ? null : uah / basis };
}

/**
 * The portfolio's CAPITAL gain over a window — value moved, payouts excluded.
 *
 * The same shape as `/yield`'s per-asset column, summed: what the window closed
 * at plus what it sold, against what it inherited plus what it bought. At the
 * full history the inherited position is 0 and this is `netResult` exactly,
 * which is what lets the KPI keep its D5-pinned +4 452,61 / +3,08 %.
 *
 * It had to be windowed at all because the card is measured ACROSS the two ends
 * (D-6). A first cut left it on the full history while its own sub-line pointed
 * at the window's left end — a figure since February under a label saying
 * "since April", which is the defect A38's review rejected one level up.
 */
export function netResultIn(
  snapshots: Snapshot[],
  transactions: Transaction[],
  w: PeriodWindow | undefined,
): { uah: number; pct: number } {
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  if (w !== undefined && !hasBaseline(snapshots, transactions, w)) return { uah: 0, pct: 0 };
  const closeQuotes = quotesAsOf(snapshots, w?.to);
  const open = w === undefined ? 0 : sum(quotesAsOf(snapshots, dayBefore(w.from)));
  const inside = w === undefined ? transactions : transactionsFrom(transactions, w.from);

  // A SOLD POSITION KEEPS ITS LAST QUOTE, so the disposal term double-counts it
  // unless the quote is dropped (A40 review). `quotesAsOf` merges snapshots —
  // `Object.assign(out, s.quotes)` over the sorted list — which its own doc
  // calls deliberate, so an asset absent from every snapshot after its sale
  // keeps its last value forever. `netResult`'s doc claims "a closed position
  // has no quote, so it leaves `values` entirely"; that is false against the
  // merge, and the windowed twin would have inherited a ~15 800 ₴ gain that
  // never happened. An asset with a disposal inside the window contributes its
  // proceeds, not its stale quote.
  const soldByAsset = soldAmountByAsset(inside);
  const close = Object.entries(closeQuotes).reduce(
    (acc, [id, v]) => acc + (soldByAsset[id] === undefined ? v : 0),
    0,
  );
  const basis = open + sum(investedByAsset(inside));
  const uah = close + sum(soldByAsset) - basis;
  return { uah, pct: basis === 0 ? 0 : uah / basis };
}

/**
 * The money-weighted counterpart of the net-return figure, over the same window.
 *
 * The opening position enters as an outflow dated at `from` — money already
 * committed when the window began — exactly as `/yield` treats an asset's
 * inherited position. 0 for the full history, so this reduces to A25's
 * unwindowed rate: +8,93 % on the seed.
 */
export function portfolioXirrIn(
  snapshots: Snapshot[],
  transactions: Transaction[],
  w: PeriodWindow | undefined,
): number | null {
  if (w === undefined) {
    return portfolioXirr(transactions, headlineTotal(snapshots), latestSnapshotDate(snapshots));
  }
  if (!hasBaseline(snapshots, transactions, w)) return null;
  const open = headlineTotalAsOf(snapshots, dayBefore(w.from));
  const inside = transactionsFrom(transactions, w.from);
  const opening: Transaction[] =
    open > 0
      ? [
          {
            id: '__window-open',
            date: w.from,
            type: 'deposit',
            assetId: '',
            amount: open,
            source: 'own',
          },
        ]
      : [];
  return portfolioXirr([...opening, ...inside], headlineTotalAsOf(snapshots, w.to), w.to);
}

// S9d chip threshold: |stored − derived| must EXCEED this to surface (₴).
export const LEDGER_DRIFT_EPSILON = 0.01;

// Ledger-drift chip value (S9d): stored observed cash vs freeCashFromLedger
// (D13 reconciliation check). Returns the signed drift when |drift| > ε,
// null otherwise (chip hidden) — also null with no snapshots (nothing
// observed to reconcile; covers the loading/empty states). Demo is 0 by
// construction (deposits 143 176,37 − buys 143 168,62 = 7,75 = stored cash).
export function ledgerDriftChip(snapshots: Snapshot[], transactions: Transaction[]): number | null {
  if (snapshots.length === 0) return null;
  const drift = ledgerCashDrift(latestCash(snapshots), transactions);
  return Math.abs(drift) > LEDGER_DRIFT_EPSILON ? drift : null;
}

export interface PayoutRow {
  assetId: string;
  kind: 'coupon' | 'dividend';
  assetRef: string; // data-derived: '…8976' (bond last-4) / 'REIT' (last name word)
  amount: number;
  approx: boolean; // dividend rows are estimates — the UI renders a '~' prefix
  date: string; // ISO; chronological sort key — the UI renders '10 Aug'
}

/**
 * Step a projected date forward by whole periods until it is on or after
 * `onIso` (A28).
 *
 * THE CARD IS CALLED "NEXT PAYOUTS" AND IT WAS OFFERING DATES IN THE PAST. A
 * dividend was projected as "the latest accrual plus one period" and left
 * there, so the demo seed's last REIT accrual (10.07) had the card promising
 * 10.08 on a day the app itself printed as 19.08 — found by the 2026-08-19 walk
 * of `navigation-map.md`.
 *
 * Whole periods, not "the next month": the schedule is the asset's, and landing
 * between its own dates would invent an occurrence that never happens.
 *
 * `MAX_STEPS` is a corrupt-data guard, not a range — 600 monthly steps is fifty
 * years, past any bond this app will hold.
 */
const MAX_STEPS = 600;

function rollMonthlyTo(date: string, monthsPer: number, onIso: string): string {
  let out = date;
  for (let i = 0; i < MAX_STEPS && out < onIso; i++) out = addMonths(out, monthsPer);
  return out;
}

/**
 * The coupon half of the same roll — and it needed one too, which the first
 * draft of A28 got wrong.
 *
 * `couponProjection` reads `asset.nextCoupon || asset.maturity` VERBATIM, and
 * `nextCoupon` only ever moves through the S5 confirm (G5). So an unrecorded
 * coupon leaves the pointer frozen in the past exactly as the dividend was —
 * the seed merely hid it, because its stored 25.08.2026 still happened to be in
 * the future on the day the defect was found.
 *
 * Steps with `rollNextCoupon`, the same stepper the confirm writes with, so
 * this card can never show a date the roll would not produce — the argument
 * `nextUnsettledCoupon` already makes. `undefined` when the bond matures before
 * the reference date: a matured bond has no next payout and drops off the card.
 *
 * A missed occurrence is NOT hidden by this — it is the reminder strip's and
 * the S5 card's job, and both read the grid rather than this projection. This
 * card answers "what comes next", which is a different question from "what did
 * you forget".
 */
function rollCouponTo(asset: Asset, date: string, onIso: string): string | undefined {
  let out = date;
  for (let i = 0; i < MAX_STEPS && out < onIso; i++) {
    const roll = rollNextCoupon(asset, out);
    if (roll === undefined || roll.kind === 'matured') return undefined;
    out = roll.nextCoupon;
  }
  return out < onIso ? undefined : out;
}

// Next payouts card (design lines 187-194, D5#7): bonds read their coupon
// projection (core/accrual.couponProjection — stated couponAmount + nextCoupon
// when present, otherwise the expectedPct estimate and/or the maturity date, in
// which case the row is `approx` and renders with a '~'; P3 feat/fixed-yield
// fixed user-created bonds being skipped here in silence); dividend-bearing
// assets estimate their latest dividend_accrual amount, with the next date =
// that accrual's date + one payout-schedule period. Assets with payoutSchedule
// 'none' (Energy) or missing the attributes/history needed to estimate are
// omitted. Structured tokens only — the component layer assembles the visible
// strings (G1).
export function nextPayoutRows(
  assets: Asset[],
  transactions: Transaction[],
  onIso: string,
): PayoutRow[] {
  const rows: PayoutRow[] = [];
  const invested = investedByAsset(transactions);

  for (const asset of assets) {
    if (asset.yieldType === 'fixed_coupon') {
      const coupon = couponProjection(asset, invested[asset.id] ?? 0);
      if (coupon === undefined) continue;
      const date = rollCouponTo(asset, coupon.date, onIso);
      if (date === undefined) continue; // matured before the reference date
      rows.push({
        assetId: asset.id,
        kind: 'coupon',
        assetRef: `…${asset.name.slice(-4)}`,
        amount: coupon.amount,
        approx: coupon.estimated,
        date,
      });
      continue;
    }

    if (asset.payoutSchedule === 'none') continue;

    const accruals = transactions.filter(
      (t) => t.type === 'dividend_accrual' && t.assetId === asset.id,
    );
    if (accruals.length === 0) continue;
    const latest = accruals.reduce((a, b) => (a.date > b.date ? a : b));
    const monthsPer = { monthly: 1, quarterly: 3, semiannual: 6, maturity: 0 }[
      asset.payoutSchedule
    ];
    if (!monthsPer) continue;
    rows.push({
      assetId: asset.id,
      kind: 'dividend',
      assetRef: asset.name.split(' ').at(-1)!,
      amount: latest.amount,
      approx: true,
      date: rollMonthlyTo(addMonths(latest.date, monthsPer), monthsPer, onIso),
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
