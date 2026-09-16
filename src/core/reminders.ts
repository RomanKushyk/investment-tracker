// Serverless reminders, PURE — this module proposes, it never writes.
//
// DERIVE-DON’T-SCHEDULE: a local-only SPA has no background wake, so there is
// nothing to schedule. Every reminder is recomputed from stored data on every
// render and carries a DERIVED id, which makes dismissals SELF-EXPIRING — once an
// occurrence passes out of scope its id stops being produced and the stored entry
// goes inert, so nothing needs pruning.
//
// Tokens only; the banner sentences live in `components/ui/reminder-labels.ts`.
import { couponReminderId, COUPON_MATCH_WINDOW_DAYS, nextUnsettledCouponDate } from './accrual';
import { daysBetween } from './dates';
import type { Asset, Snapshot, Transaction } from './types';

export type ReminderKind = 'quote-missing' | 'coupon' | 'coupon-overdue' | 'maturity';

export type ReminderSeverity = 'info' | 'warn' | 'overdue';

export interface Reminder {
  /**
   * Derived id: `quote-missing:<date>` · `coupon:<assetId>:<date>` ·
   * `coupon-overdue:<assetId>:<date>` · `maturity:<assetId>:<date>`. A CROSS-MODULE
   * CONTRACT — stable across days for the SAME occurrence so a dismissal holds, and
   * different for the next one so a dismissal never leaks forward.
   */
  id: string;
  kind: ReminderKind;
  severity: ReminderSeverity;
  date: string;
  /** Signed whole days from today to `date`: > 0 ahead, 0 today, < 0 behind. */
  days: number;
  /** Absent on quote-missing, which is portfolio-wide. */
  assetId?: string;
}

export const DEFAULT_LEAD_DAYS = 7;

export const MATURITY_LEAD_DAYS = 30;

export const LEAD_DAYS_MIN = 1;
export const LEAD_DAYS_MAX = 30;

/**
 * The ONE lead-days validity rule, shared by the Settings field and the persist
 * sanitizer so store and screen can never disagree.
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
  leadDays?: number;
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

const SEVERITY_RANK: Record<ReminderSeverity, number> = { overdue: 0, warn: 1, info: 2 };

/**
 * TRUE when no snapshot exists for the date AND when one exists but is PARTIAL —
 * an asset without a quote key is "pending", never 0, so the ritual is unfinished
 * and the reminder must still fire.
 */
function quotesMissing(assets: Asset[], snapshots: Snapshot[], today: string): boolean {
  if (assets.length === 0) return false;
  const snapshot = snapshots.find((s) => s.date === today);
  if (snapshot === undefined) return true;
  return assets.some((a) => snapshot.quotes[a.id] === undefined);
}

/**
 * ONE ASYMMETRY, and it is one-way: an occurrence SKIPPED from the coupon card
 * also silences that occurrence’s overdue banner, because skipping is a decision
 * about the coupon and the banner would nag about what was just waved away.
 * Dismissing the banner leaves the card standing — the card is the tool, the
 * banner only the nudge.
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
 * Ordered overdue → warn → info and already filtered against the dismissed ids.
 * Both coupon kinds read `nextUnsettledCouponDate`, so a coupon recorded by hand
 * is never announced, whichever side of its date the recording sits on.
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
    // THE DATE-ONLY WALK: this reads the occurrence’s date and never its amount, and
    // the amount costs a full `unitsByAsset` traversal of the ledger per asset — on a
    // derivation that runs on the header render path.
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

    // Maturity stands on the asset’s own field, not on its yield type. A maturity
    // already in the past is NOT announced: the copy only reads forward.
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
