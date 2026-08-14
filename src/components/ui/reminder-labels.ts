// English copy for the S6 reminder banners and the app-open toast — the
// component layer owns the words (D8: core/reminders returns tokens only).
// Every sentence is verbatim from design/extensions/reminders.dc.html's copy
// inventory; i18n lands in Phase 5.
import type { Reminder, ReminderKind } from '../../core/reminders';
import type { Format } from '../../core/money';
import type { Dict } from '../../i18n/messages';

/** "in 5 days" / "in 1 day" — the reference copy is plural; 1 must not read "1 days". */
/**
 * One banner's sentence. `assetName` is the reminder's asset (empty for the
 * portfolio-wide quote-missing kind).
 *
 * The maturity/coupon day counts and the "matures today" wording are the only
 * copy not literal in the reference: the brief pins the "in N days" pattern and
 * these are its unavoidable edges (a same-day maturity, a single day).
 */
export function reminderText(
  reminder: Reminder,
  assetName: string,
  f: Format,
  t: Dict,
): string {
  const r = t.reminders;
  switch (reminder.kind) {
    case 'quote-missing':
      return r.quoteMissing;
    case 'coupon':
      return r.coupon(assetName, r.inDays(reminder.days), f.date(reminder.date));
    case 'coupon-overdue':
      return r.couponOverdue(assetName, f.date(reminder.date));
    case 'maturity':
      return reminder.days === 0
        ? r.maturesToday(assetName, f.date(reminder.date))
        : r.matures(assetName, r.inDays(reminder.days), f.date(reminder.date));
  }
}

/**
 * The banner's action link — rendered on `/overview` only (on `/` the ritual UI
 * and the S5 card are right there). Both links navigate to `/`.
 */
export function reminderAction(t: Dict): Partial<Record<ReminderKind, string>> {
  return {
    'quote-missing': t.reminders.enterQuotes,
    'coupon-overdue': t.reminders.openDailyQuotes,
  };
}

/** The strip never shows more than this many banners before collapsing the rest. */
export const REMINDER_STRIP_CAP = 3;

/** The pressable overflow line under a capped strip. */
export function moreRemindersLabel(hidden: number, t: Dict): string {
  return t.reminders.moreReminders(hidden);
}

/**
 * The app-open toast: the highest-severity reminder's sentence (the list
 * arrives already ordered), plus " · +N more" when others exist.
 */
export function reminderToastText(
  reminders: Reminder[],
  names: Record<string, string>,
  f: Format,
  t: Dict,
): string {
  const [top] = reminders;
  if (top === undefined) return '';
  const text = reminderText(top, top.assetId === undefined ? '' : (names[top.assetId] ?? ''), f, t);
  const rest = reminders.length - 1;
  return rest > 0 ? `${text}${t.reminders.andMore(rest)}` : text;
}
