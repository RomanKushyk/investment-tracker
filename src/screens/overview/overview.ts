// Pure glue for the Overview screen's derived (non-KPI-grid) cards — imports
// core/ only, returns structured tokens (G1). Covered by overview.test.ts.
import { couponProjection, rollNextCoupon } from '../../core/accrual';
import { addMonths } from '../../core/dates';
import {
  allocationDeltaPp,
  globalRoi,
  headlineTotal,
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

export interface TotalReturnKpi {
  uah: number; // the audit's NetFinancialResult = totalCapital − netDeposits
  roi: number | null; // globalRoi fraction; null when netDeposits ≤ 0 → UI renders "—"
}

// "Total return (net)" KPI (S9a) — the §5 total-return family (D13,
// docs/reference/FORMULA-AUDIT.md): performance against EXTERNAL deposits only, shipped
// ADDITIVELY beside the D5-pinned capital-gain KPI (relabeled, never changed).
// Demo: +₴5,839.99 / +4.08% (149 016,36 − 143 176,37 over 143 176,37).
export function totalReturnKpi(
  snapshots: Snapshot[],
  transactions: Transaction[],
): TotalReturnKpi {
  const total = headlineTotal(snapshots);
  const deposits = netDeposits(transactions);
  return { uah: total - deposits, roi: globalRoi(total, deposits) };
}

// S9d chip threshold: |stored − derived| must EXCEED this to surface (₴).
export const LEDGER_DRIFT_EPSILON = 0.01;

// Ledger-drift chip value (S9d): stored observed cash vs freeCashFromLedger
// (D13 reconciliation check). Returns the signed drift when |drift| > ε,
// null otherwise (chip hidden) — also null with no snapshots (nothing
// observed to reconcile; covers the loading/empty states). Demo is 0 by
// construction (deposits 143 176,37 − buys 143 168,62 = 7,75 = stored cash).
export function ledgerDriftChip(
  snapshots: Snapshot[],
  transactions: Transaction[],
): number | null {
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
