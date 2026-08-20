// Pure helpers for the Settings screen (per-screen glue, imports core only).
// Covered by settings.test.ts.
//
// `cascadeCounts` LEFT for `screens/portfolio/portfolio.ts` with A31, along
// with the asset manager it serves. What is left here is the reminders field.
import { isLeadDays } from '../../core/reminders';

/**
 * S8 "Lead time, days": the typed value, or `null` when it is not a whole
 * number of days inside 1–30 (the field then shows "Enter 1–30 days." and
 * nothing is written — `core/reminders.isLeadDays` is the shared rule, so the
 * persist sanitizer can never disagree with this field).
 */
export function parseLeadDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return isLeadDays(days) ? days : null;
}
