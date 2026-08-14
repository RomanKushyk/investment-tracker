// S6 glue: the stored data → `core/reminders.computeReminders` → the strip and
// the one app-open toast. Reminders are PURE local derivations, so nothing here
// is dataset-gated (G4/D16 keeps them active in demo); `remindersEnabled` (S8)
// is the only gate, read at render time so a flip lands without a reload.
import { useEffect } from 'react';
import { toast } from 'sonner';

import { reminderToastText } from '../components/ui/reminder-labels';
import { todayIso } from '../core/dates';
import { computeReminders, type Reminder } from '../core/reminders';
import { useSettings } from '../state/settings';
import { useFormat } from './useFormat';
import { useAssets, useSnapshots, useTransactions } from './queries';
import { useT } from '../i18n/useT';

export interface RemindersView {
  /** Ordered overdue → warn → info, dismissals already filtered out. */
  reminders: Reminder[];
  /** assetId → name, for the banner sentences (the copy layer owns the words). */
  names: Record<string, string>;
  /** All three reads have resolved — the strip and the toast wait for this. */
  ready: boolean;
}

export function useReminders(): RemindersView {
  const assetsQuery = useAssets();
  const snapshotsQuery = useSnapshots();
  const transactionsQuery = useTransactions();
  const { remindersEnabled, reminderLeadDays, dismissedReminders } = useSettings();

  const assets = assetsQuery.data ?? [];
  const names: Record<string, string> = {};
  for (const asset of assets) names[asset.id] = asset.name;

  const reminders = remindersEnabled
    ? computeReminders(
        assets,
        snapshotsQuery.data ?? [],
        transactionsQuery.data ?? [],
        todayIso(),
        { leadDays: reminderLeadDays, dismissed: dismissedReminders },
      )
    : [];

  return {
    reminders,
    names,
    ready: assetsQuery.isSuccess && snapshotsQuery.isSuccess && transactionsQuery.isSuccess,
  };
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
