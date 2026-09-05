// Serverless reminders, PURE — S6 of design/extensions/reminders.dc.html.
//
// DERIVE-DON'T-SCHEDULE (plan key fact #8): a local-only SPA has no background
// wake, so there is nothing to schedule. Every reminder is recomputed from
// stored data on every render, and each one carries a DERIVED id — dismissals
// are therefore self-expiring: when the occurrence passes out of scope its id
// stops being produced and the entry in `dismissedReminders` becomes inert
// (a new coupon date is a new id, so nothing needs pruning).
//
// G5 restated: this module proposes, it never writes. Reminders are pure local
// derivations, which is why they stay ACTIVE in the demo dataset (G4/D16).
//
// Structured returns (D8): tokens only — kind, severity, ISO date, day count.
// The banner sentences live in components/ui/reminder-labels.ts.
import { couponReminderId, COUPON_MATCH_WINDOW_DAYS, nextUnsettledCouponDate } from './accrual';
import { daysBetween } from './dates';
import type { Asset, Snapshot, Transaction } from './types';

export type ReminderKind = 'quote-missing' | 'coupon' | 'coupon-overdue' | 'maturity';

/** Severity token → the strip's tint family (info `info-tint`, warn `warn-tint`, overdue `neg-tint`). */
export type ReminderSeverity = 'info' | 'warn' | 'overdue';

/** PINNED PHASE-3 CONTRACT — the reminder shape every S6 surface consumes. */
export interface Reminder {
  /**
   * Derived id: `quote-missing:<date>` · `coupon:<assetId>:<date>` ·
   * `coupon-overdue:<assetId>:<date>` · `maturity:<assetId>:<date>`. Stable
   * across days for the SAME occurrence (so a dismissal holds) and different
   * for the next one (so a dismissal never leaks forward).
   */
  id: string;
  kind: ReminderKind;
  severity: ReminderSeverity;
  /** The date the reminder is about: `today` for quote-missing, else the occurrence's own date. */
  date: string;
  /** Signed whole days from today to `date`: > 0 ahead, 0 today, < 0 behind. */
  days: number;
  /** The asset the reminder is about; absent on quote-missing (portfolio-wide). */
  assetId?: string;
}

/** S8 `reminderLeadDays` default — how many days ahead a coupon reminder appears. */
export const DEFAULT_LEAD_DAYS = 7;

/** Maturity reminders appear within this many days of the maturity date (brief S6). */
export const MATURITY_LEAD_DAYS = 30;

/** S8's valid lead-time range, in whole days ("Enter 1–30 days."). */
export const LEAD_DAYS_MIN = 1;
export const LEAD_DAYS_MAX = 30;

/**
 * The ONE lead-days validity rule, shared by the Settings field (an invalid
 * entry never writes) and the persist sanitizer (a tampered payload falls back
 * to the default) so store and screen can never disagree.
 */
export function isLeadDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= LEAD_DAYS_MIN &&
    value <= LEAD_DAYS_MAX
  );
}

export interface ReminderOptions {
  /** S8 `reminderLeadDays` (1–30, validated by the settings screen). */
  leadDays?: number;
  /** The persisted `dismissedReminders` ids (S8/D21). */
  dismissed?: readonly string[];
}

export function quoteMissingReminderId(date: string): string {
  return `quote-missing:${date}`;
}

export function couponOverdueReminderId(assetId: string, date: string): string {
  return `coupon-overdue:${assetId}:${date}`;
}

export function maturityReminderId(assetId: string, date: string): string {
  return `maturity:${assetId}:${date}`;
}

/** Strip order: overdue first, then warn, then info (brief S6). */
const SEVERITY_RANK: Record<ReminderSeverity, number> = { overdue: 0, warn: 1, info: 2 };

/**
 * Is today's quote entry still outstanding? TRUE when no snapshot exists for
 * the date at all AND when one exists but is PARTIAL — an asset without a quote
 * key is "pending", never 0 (D5#1 / audit §4), so the ritual is unfinished and
 * the reminder must still fire (an explicit plan Verify item). With no assets
 * there is nothing to quote and nothing to remind about.
 */
function quotesMissing(assets: Asset[], snapshots: Snapshot[], today: string): boolean {
  if (assets.length === 0) return false;
  const snapshot = snapshots.find((s) => s.date === today);
  if (snapshot === undefined) return true;
  return assets.some((a) => snapshot.quotes[a.id] === undefined);
}

/**
 * A dismissal hides the banner it was pressed on — plus one asymmetry: an
 * occurrence SKIPPED from the S5 coupon card (which files the shared
 * `coupon:<assetId>:<date>` id, D21) also silences that occurrence's overdue
 * banner. Skipping is a decision about the coupon, and the banner would
 * otherwise nag about exactly what was just waved away. The reverse does NOT
 * hold: dismissing the banner leaves the card standing (the card is the tool,
 * the banner is only the nudge).
 */
function isDismissed(reminder: Reminder, dismissed: readonly string[]): boolean {
  if (dismissed.includes(reminder.id)) return true;
  return (
    reminder.kind === 'coupon-overdue' &&
    reminder.assetId !== undefined &&
    dismissed.includes(couponReminderId(reminder.assetId, reminder.date))
  );
}

/**
 * Every reminder the app should show for `today`, already ordered
 * (overdue → warn → info, by date ascending inside a severity) and already
 * filtered against the dismissed ids.
 *
 * Four kinds:
 * - `quote-missing` (warn) — today has no snapshot, or a partial one.
 * - `coupon` (info) — a coupon date within `leadDays`.
 * - `coupon-overdue` (overdue) — a coupon date that has arrived unrecorded.
 * - `maturity` (info) — a maturity date within 30 days.
 *
 * Both coupon kinds read `nextUnsettledCouponDate`, which carries the S5 dedupe
 * (`couponRecorded`, ±7 days) and the skip list: a coupon the user already
 * recorded by hand is never announced, whichever side of its date the recording
 * sits on, and a settled occurrence hands over to the next one on the grid.
 */
export function computeReminders(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
  today: string,
  opts: ReminderOptions = {},
): Reminder[] {
  const leadDays = opts.leadDays ?? DEFAULT_LEAD_DAYS;
  const dismissed = opts.dismissed ?? [];
  const reminders: Reminder[] = [];

  if (quotesMissing(assets, snapshots, today)) {
    reminders.push({
      id: quoteMissingReminderId(today),
      kind: 'quote-missing',
      severity: 'warn',
      date: today,
      days: 0,
    });
  }

  for (const asset of assets) {
    // The next OPEN occurrence on the asset's grid, not the `nextCoupon` pointer:
    // a coupon recorded by hand (or skipped from the S5 card) is stepped over, so
    // one settled occurrence can never mute the asset's later ones (D23).
    // THE DATE-ONLY WALK. This function reads the occurrence's date and never
    // its amount, and the amount costs a full `unitsByAsset` traversal of the
    // ledger per asset — on a derivation that runs on the header render path.
    const coupon = nextUnsettledCouponDate(asset, transactions, {
      windowDays: COUPON_MATCH_WINDOW_DAYS,
      dismissed,
    });
    if (coupon !== undefined) {
      const days = daysBetween(today, coupon);
      if (days <= 0 || days <= leadDays) {
        reminders.push(
          days <= 0
            ? {
                id: couponOverdueReminderId(asset.id, coupon),
                kind: 'coupon-overdue',
                severity: 'overdue',
                date: coupon,
                days,
                assetId: asset.id,
              }
            : {
                id: couponReminderId(asset.id, coupon),
                kind: 'coupon',
                severity: 'info',
                date: coupon,
                days,
                assetId: asset.id,
              },
        );
      }
    }

    // Maturity stands on the asset's own `maturity` field, not on its yield
    // type: a date the asset states is a date it pays out on. A maturity
    // already in the past is NOT announced — the brief's copy only reads
    // forward ("matures in N days"), and a redeemed bond needs no reminder.
    const maturity = asset.maturity;
    if (maturity !== undefined && maturity !== '') {
      const days = daysBetween(today, maturity);
      if (days >= 0 && days <= MATURITY_LEAD_DAYS) {
        reminders.push({
          id: maturityReminderId(asset.id, maturity),
          kind: 'maturity',
          severity: 'info',
          date: maturity,
          days,
          assetId: asset.id,
        });
      }
    }
  }

  return reminders
    .filter((r) => !isDismissed(r, dismissed))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.date.localeCompare(b.date) ||
        (a.assetId ?? '').localeCompare(b.assetId ?? ''),
    );
}
