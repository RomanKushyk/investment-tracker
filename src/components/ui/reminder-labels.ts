// English copy for the S6 reminder banners and the app-open toast — the
// component layer owns the words (D8: core/reminders returns tokens only).
// Every sentence is verbatim from design/extensions/reminders.dc.html's copy
// inventory; i18n lands in Phase 5.
import type { Reminder, ReminderKind } from '../../core/reminders';
import type { Format } from '../../core/money';

/** "in 5 days" / "in 1 day" — the reference copy is plural; 1 must not read "1 days". */
function inDays(days: number): string {
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}

/**
 * One banner's sentence. `assetName` is the reminder's asset (empty for the
 * portfolio-wide quote-missing kind).
 *
 * The maturity/coupon day counts and the "matures today" wording are the only
 * copy not literal in the reference: the brief pins the "in N days" pattern and
 * these are its unavoidable edges (a same-day maturity, a single day).
 */
export function reminderText(reminder: Reminder, assetName: string, f: Format): string {
  switch (reminder.kind) {
    case 'quote-missing':
      return 'No quotes saved today yet.';
    case 'coupon':
      return `${assetName} pays a coupon ${inDays(reminder.days)} (${f.date(reminder.date)}).`;
    case 'coupon-overdue':
      return `${assetName} coupon was due ${f.date(reminder.date)} — record it on Daily quotes.`;
    case 'maturity':
      return reminder.days === 0
        ? `${assetName} matures today (${f.date(reminder.date)}).`
        : `${assetName} matures ${inDays(reminder.days)} (${f.date(reminder.date)}).`;
  }
}

/**
 * The banner's action link — rendered on `/overview` only (on `/` the ritual UI
 * and the S5 card are right there). Both links navigate to `/`.
 */
export const REMINDER_ACTION: Partial<Record<ReminderKind, string>> = {
  'quote-missing': 'Enter quotes →',
  'coupon-overdue': 'Open Daily quotes →',
};

/** `aria-label` of a banner's dismiss ✕. */
export const DISMISS_REMINDER_LABEL = 'Dismiss reminder';

/** The strip never shows more than this many banners before collapsing the rest. */
export const REMINDER_STRIP_CAP = 3;

/** The pressable overflow line under a capped strip. */
export function moreRemindersLabel(hidden: number): string {
  return `+${hidden} more reminder${hidden === 1 ? '' : 's'}`;
}

/**
 * The app-open toast: the highest-severity reminder's sentence (the list
 * arrives already ordered), plus " · +N more" when others exist.
 */
export function reminderToastText(
  reminders: Reminder[],
  names: Record<string, string>,
  f: Format,
): string {
  const [top] = reminders;
  if (top === undefined) return '';
  const text = reminderText(top, top.assetId === undefined ? '' : (names[top.assetId] ?? ''), f);
  const rest = reminders.length - 1;
  return rest > 0 ? `${text} · +${rest} more` : text;
}
