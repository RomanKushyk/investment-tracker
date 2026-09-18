// The reminder banners' and the app-open toast's sentences. The component layer
// owns the words, `core/reminders` returning tokens only. *Core is pure*
import type { Reminder, ReminderKind } from '../../core/reminders';
import type { Format } from '../../core/money';
import type { Dict } from '../../i18n/messages';

/**
 * One banner's sentence. `assetName` is the reminder's asset, empty for the
 * portfolio-wide quote-missing kind.
 *
 * A same-day maturity takes its own wording: the drawing pins an "in N days"
 * pattern, and "in 0 days" is not a sentence.
 */
export function reminderText(reminder: Reminder, assetName: string, f: Format, t: Dict): string {
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
 * The banner's action link, rendered on `/overview` only — on `/` the ritual UI
 * and the coupon-due card are already on screen. Both links navigate to `/`.
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
