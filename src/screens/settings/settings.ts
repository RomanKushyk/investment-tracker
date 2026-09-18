// Pure helpers for the Settings screen. Covered by settings.test.ts.
import { isLeadDays } from '../../core/reminders';

/**
 * The typed lead time, or `null` when it is not a whole number of days inside the
 * allowed range. `core/reminders.isLeadDays` is the shared rule, so the persist
 * sanitizer can never disagree with this field.
 */
export function parseLeadDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return isLeadDays(days) ? days : null;
}
