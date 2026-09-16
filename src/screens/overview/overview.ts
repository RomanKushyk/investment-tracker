// Pure glue for the Overview screen's derived cards; structured tokens only.
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
  unitsByAsset,
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

export function mostUnderweightAsset(
  assets: Asset[],
  values: Record<string, number>,
  total: number,
): UnderweightResult | undefined {
  // With no snapshots every asset reads as fully underweight: an empty state, not a hint.
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

const ROI_BASIS_FLOOR = 1;

/**
 * Whether a window has anything to open against. TWO CASES LOOK THE SAME AND ARE NOT:
 * nothing was HELD before it opened, where 0 is right and the full history is exactly
 * that; or something was held but never VALUED, where there is no "before" at all and
 * measuring from 0 reports the whole portfolio as the window's return. The question is
 * about the LEDGER first and the snapshots second.
 */
function hasBaseline(snapshots: Snapshot[], transactions: Transaction[], w: PeriodWindow): boolean {
  const before = dayBefore(w.from);
  const heldSomething = transactions.some((t) => t.date <= before);
  return !heldSomething || snapshots.some((s) => s.date <= before);
}

export interface TotalReturnKpi {
  uah: number; // totalCapital − netDeposits
  roi: number | null; // fraction; null renders an em dash
}

// Against EXTERNAL deposits only, beside the capital-gain KPI. *Metric families and windows*
export function totalReturnKpi(snapshots: Snapshot[], transactions: Transaction[]): TotalReturnKpi {
  return totalReturnKpiIn(snapshots, transactions, undefined);
}

/** The net total return over a WINDOW; it reduces the way `/yield`'s builder does, and
 *  for the same reason. THE BOUNDARY IS WHAT MAKES THIS THE RIGHT CARD FOR THE XIRR:
 *  this figure is measured at the PORTFOLIO's edge and so is `portfolioXirr`, while
 *  every column on `/yield` is measured at the ASSET boundary — which is why the
 *  annualized counterpart of this number has no honest cell over there. */
export function totalReturnKpiIn(
  snapshots: Snapshot[],
  transactions: Transaction[],
  w: PeriodWindow | undefined,
): TotalReturnKpi {
  // A WINDOW THAT OPENS BEFORE THE FIRST SNAPSHOT HAS NO BASELINE, and 0 is not one:
  // the comparison is absent and the figure is an em dash, never zero.
  if (w !== undefined && !hasBaseline(snapshots, transactions, w)) return { uah: 0, roi: null };
  const close = headlineTotalAsOf(snapshots, w?.to);
  const open = w === undefined ? 0 : headlineTotalAsOf(snapshots, dayBefore(w.from));
  const inside = w === undefined ? transactions : transactionsFrom(transactions, w.from);
  const deposits = netDeposits(inside);
  const basis = open + deposits;
  // COMPUTED HERE RATHER THAN THROUGH `globalRoi`, which already subtracts its own
  // denominator: fed a windowed gain and a windowed basis it subtracts the basis
  // twice. Only a window shows it — at the full history the two agree exactly.
  const uah = close - open - deposits;
  // `basis <= 0` IS NOT THE WHOLE GUARD: a denominator NEAR zero flips the figure into
  // nonsense as surely as a negative one — a window that opens full and is then almost
  // entirely withdrawn renders hundreds of percent. Below one hryvnia it is a rounding
  // artefact rather than capital.
  return { uah, roi: basis < ROI_BASIS_FLOOR ? null : uah / basis };
}

/** The portfolio's CAPITAL gain over a window — value moved, payouts excluded, the same
 *  shape as `/yield`'s per-asset column summed. Windowed because the card is measured
 *  ACROSS the two ends: a full-history figure under a sub-line naming the window's left
 *  end says one thing and means another. */
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

  // A SOLD POSITION KEEPS ITS LAST QUOTE, so the disposal term double-counts it unless
  // the quote is dropped: `quotesAsOf` MERGES snapshots, so an asset absent from every
  // later one keeps its last value forever.
  const soldByAsset = soldAmountByAsset(inside);
  const close = Object.entries(closeQuotes).reduce(
    (acc, [id, v]) => acc + (soldByAsset[id] === undefined ? v : 0),
    0,
  );
  const basis = open + sum(investedByAsset(inside));
  const uah = close + sum(soldByAsset) - basis;
  return { uah, pct: basis === 0 ? 0 : uah / basis };
}

/** The money-weighted counterpart of the net-return figure. The opening position enters
 *  as an outflow dated at `from`, as `/yield` treats an inherited one, and is 0 for the
 *  full history. */
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

export const LEDGER_DRIFT_EPSILON = 0.01;

// Null with no snapshots: nothing observed to reconcile, which is also the empty state.
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

/** Step a projected date forward until it is on or after `onIso`: a card called "next
 *  payouts" must not offer one in the past. WHOLE PERIODS, not "the next month" — the
 *  schedule is the asset's, and landing between its dates invents an occurrence that
 *  never happens. `MAX_STEPS` is a corrupt-data guard, not a range. */
const MAX_STEPS = 600;

function rollMonthlyTo(date: string, monthsPer: number, onIso: string): string {
  let out = date;
  for (let i = 0; i < MAX_STEPS && out < onIso; i++) out = addMonths(out, monthsPer);
  return out;
}

/** The coupon half of the same roll, needed for the same reason: the stored pointer
 *  only moves through the confirm, so an unrecorded coupon leaves it frozen in the
 *  past. It steps with the SAME stepper the confirm writes with, so this card cannot
 *  show a date the roll would not produce. A missed occurrence is NOT hidden by it —
 *  this answers "what comes next", not "what did you forget". */
function rollCouponTo(asset: Asset, date: string, onIso: string): string | undefined {
  let out = date;
  for (let i = 0; i < MAX_STEPS && out < onIso; i++) {
    const roll = rollNextCoupon(asset, out);
    if (roll === undefined || roll.kind === 'matured') return undefined;
    out = roll.nextCoupon;
  }
  return out < onIso ? undefined : out;
}

// A dividend row estimates from the latest accrual, so it is always `approx`. AN ASSET
// THE CARD CANNOT ANSWER FOR IS OMITTED IN SILENCE: no schedule, nothing to estimate
// from, a bond already matured, or a `maturity` schedule — whose zero months make the
// falsy guard below deliberate.
export function nextPayoutRows(
  assets: Asset[],
  transactions: Transaction[],
  onIso: string,
): PayoutRow[] {
  const rows: PayoutRow[] = [];
  const invested = investedByAsset(transactions);
  const units = unitsByAsset(transactions);

  for (const asset of assets) {
    if (asset.yieldType === 'fixed_coupon') {
      const coupon = couponProjection(asset, invested[asset.id] ?? 0, units[asset.id]);
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
