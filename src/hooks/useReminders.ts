// The glue: the view's rows → `core/reminders.computeReminders` → the strip and the
// one app-open toast. Reminders are PURE local derivations, so `remindersEnabled` is
// the only gate, read at render time so a flip lands without a reload.
import { useEffect } from 'react';
import { toast } from 'sonner';

import { reminderToastText } from '../components/ui/reminder-labels';
import { computeReminders, type Reminder, type ReminderOptions } from '@quirenote/core/reminders';
import { useSettings } from '../state/settings';
import { useFormat } from './useFormat';
import { useView, useViewReady } from './queries';
import { selectReminders } from './slices';
import { useT } from '../i18n/useT';

export interface RemindersView {
  /** Ordered overdue → warn → info, dismissals already filtered out. */
  reminders: Reminder[];
  /** assetId → name, for the banner sentences (the copy layer owns the words). */
  names: Record<string, string>;
  /** The view has been read — the strip and the toast wait for this. */
  ready: boolean;
}

/** The reminders over the slice the view hands. Of the stored days they read one, the caller's:
 *  whether its quotes are in. */
export function remindersOf(
  { assets, transactions, today, quotes }: ReturnType<typeof selectReminders>,
  opts: ReminderOptions,
): Reminder[] {
  return computeReminders(assets, [{ date: today, quotes }], transactions, today, opts);
}

export function useReminders(): RemindersView {
  const slice = useView(selectReminders);
  const ready = useViewReady();
  const { remindersEnabled, reminderLeadDays, dismissedReminders } = useSettings();

  const names: Record<string, string> = {};
  for (const asset of slice.assets) names[asset.id] = asset.name;

  const reminders = remindersEnabled
    ? remindersOf(slice, { leadDays: reminderLeadDays, dismissed: dismissedReminders })
    : [];

  return { reminders, names, ready };
}

// ONE toast per app open — not per navigation, not per render. The latch is
// module-level on purpose: a ref would be enough for StrictMode's double-invoked
// effect, but the guard must also survive anything that remounts its host, and
// the host (app/Layout) is the only mount point that spans every route, so the
// toast fires on app open whatever screen the user lands on.
let toastShown = false;

export function useReminderToast(): void {
  const f = useFormat();
  const t = useT();
  const { reminders, names, ready } = useReminders();

  useEffect(() => {
    if (toastShown || !ready) return;
    toastShown = true; // first resolved read decides — nothing announces twice
    const text = reminderToastText(reminders, names, f, t);
    if (text !== '') toast(text); // informational: default sonner look, no action
  }, [ready, reminders, names, f, t]);
}
