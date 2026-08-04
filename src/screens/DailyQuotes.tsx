import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import {
  useAssets,
  useSaveSnapshot,
  useSnapshots,
  useTransactions,
} from '../hooks/queries';
import { couponReminderId, dueCoupons } from '../core/accrual';
import { todayIso } from '../core/dates';
import { investedByAsset, latestCash, latestQuotes } from '../core/derive';
import { fmtSavedAt, fmtTable } from '../core/money';
import { quoteInputSchema } from '../core/schemas';
import type { Snapshot } from '../core/types';
import { useDraft } from '../state/draft';
import { useSettings } from '../state/settings';
import { CouponDueCard } from './daily-quotes/CouponDueCard';
import { FetchQuotesButton } from './daily-quotes/FetchQuotesButton';
import { maxSavedAt, yesterdayQuote } from './daily-quotes/quotes';
import { accrualSuggestion, couponPrefill } from './daily-quotes/suggestions';
import { useQuoteFetch } from './daily-quotes/useQuoteFetch';
import { QuoteRow } from './daily-quotes/QuoteRow';
import { YieldTeaser } from './daily-quotes/YieldTeaser';
import { TransactionPanel } from './TransactionPanel';

export function DailyQuotes() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];
  const { date, quotes, setDate, setQuote, fillQuote } = useDraft();
  const saveSnapshot = useSaveSnapshot();
  // S1–S3: the fetch ritual. It only ever writes the draft store — "Save
  // snapshot" below stays the sole write path (G5).
  const fetch = useQuoteFetch(assets);
  // S4/S5 automation switches (S8) — pure local derivations, so they run in
  // demo as well as live (G4/D16).
  const { autoQuoteSuggest, couponSuggest, dismissedReminders, dismissReminder } = useSettings();
  // Ghosts dismissed this session, stamped with the date they were dismissed on
  // (a dismissal is a "not today" — nothing is persisted, and another date's
  // draft suggests again; keying the state by date beats resetting it from an
  // effect).
  const [dismissed, setDismissed] = useState<{ date: string; ids: string[] }>({
    date: '',
    ids: [],
  });

  // First run ever: default the draft to today.
  useEffect(() => {
    if (!date) setDate(todayIso());
  }, [date, setDate]);

  const selectedDate = date || todayIso();

  const dismissedSuggestions = dismissed.date === selectedDate ? dismissed.ids : [];
  const todaySnapshot = snapshots.find((s) => s.date === selectedDate);

  // Inputs initialize from today's saved snapshot merged with the draft
  // (README §6.1): prefill any asset the user hasn't touched this session.
  useEffect(() => {
    if (!todaySnapshot) return;
    for (const assetId of Object.keys(todaySnapshot.quotes)) {
      if (!(assetId in quotes))
        setQuote(assetId, fmtTable(todaySnapshot.quotes[assetId]));
    }
  }, [todaySnapshot, quotes, setQuote]);

  const filledCount = assets.filter(
    (a) => quoteInputSchema.safeParse(quotes[a.id] ?? '').success,
  ).length;

  function handleSave() {
    const parsedQuotes: Record<string, number> = {};
    for (const a of assets) {
      const parsed = quoteInputSchema.safeParse(quotes[a.id] ?? '');
      if (parsed.success) parsedQuotes[a.id] = parsed.data;
    }
    const cash = todaySnapshot?.cash ?? latestCash(snapshots);
    const snapshot: Snapshot = {
      date: selectedDate,
      quotes: parsedQuotes,
      cash,
    };
    saveSnapshot.mutate(snapshot, {
      onSuccess: () => toast.success('Snapshot saved'),
    });
  }

  function handleCopyYesterday() {
    for (const a of assets) {
      const y = yesterdayQuote(snapshots, a.id, selectedDate);
      if (y !== undefined) setQuote(a.id, fmtTable(y));
    }
  }

  const lastSavedAt = maxSavedAt(snapshots);
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);

  // S4 — the accrual ghost per row: a suggestion, never a draft. Accepting it
  // is the only path into the draft store (and it lands as a MACHINE fill, so a
  // later fetch of a linked bond may still replace it with a real price).
  function suggestionFor(assetId: string): number | undefined {
    if (!autoQuoteSuggest || dismissedSuggestions.includes(assetId)) return undefined;
    const asset = assets.find((a) => a.id === assetId);
    if (asset === undefined) return undefined;
    const value = accrualSuggestion(asset, snapshots, invested[assetId] ?? 0, selectedDate);
    return value === null ? undefined : value;
  }

  // S5 — coupons whose date has arrived with nothing recorded for them, minus
  // the occurrences the user skipped (derived ids, shared with the reminders).
  const due = couponSuggest
    ? dueCoupons(assets, transactions, todayIso()).filter(
        (d) => !dismissedReminders.includes(couponReminderId(d.assetId, d.date)),
      )
    : [];

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="min-w-0 flex-[1_1_560px]">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="text-[26px]">Daily quotes</h2>
          <span
            key={filledCount}
            className="animate-in bg-pos-tint text-pos-tint-text zoom-in-95 rounded-full px-3 py-1 text-xs font-semibold duration-150"
          >
            {filledCount} of {assets.length} filled
          </span>
          <FetchQuotesButton
            state={fetch.state}
            freshness={fetch.freshness}
            flashAt={fetch.flashAt}
            onFetch={fetch.fetchQuotes}
          />
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="daily-quotes-date" className="text-[13px] whitespace-nowrap">
              Date
            </label>
            <DatePicker id="daily-quotes-date" value={selectedDate} onChange={setDate} />
          </div>
        </div>
        <p className="text-muted mb-[18px] text-[13px]">
          The everyday ritual — nothing else competes with it.
        </p>

        <div className="flex flex-col gap-2.5">
          {assets.map((a) => (
            <QuoteRow
              key={a.id}
              asset={a}
              raw={quotes[a.id]}
              yesterday={yesterdayQuote(snapshots, a.id, selectedDate)}
              chip={fetch.chipFor(a)}
              offer={fetch.offerFor(a)}
              suggestion={suggestionFor(a.id)}
              onChange={(v) => setQuote(a.id, v)}
              onAcceptOffer={() => fetch.acceptOffer(a.id)}
              onDismissOffer={() => fetch.dismissOffer(a.id)}
              onAcceptSuggestion={() => {
                const value = suggestionFor(a.id);
                if (value === undefined) return;
                fillQuote(a.id, fmtTable(value), {
                  source: 'accrual',
                  at: new Date().toISOString(),
                });
              }}
              onDismissSuggestion={() =>
                setDismissed({
                  date: selectedDate,
                  ids: dismissedSuggestions.includes(a.id)
                    ? dismissedSuggestions
                    : [...dismissedSuggestions, a.id],
                })
              }
            />
          ))}
        </div>

        <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
          <Button onClick={handleSave}>Save snapshot</Button>
          <Button variant="outline" onClick={handleCopyYesterday}>
            Copy yesterday
          </Button>
          <span className="text-muted ml-auto text-xs">
            {lastSavedAt
              ? `Last saved ${fmtSavedAt(lastSavedAt)}`
              : 'Not saved yet'}
          </span>
        </div>

        <YieldTeaser assets={assets} values={values} invested={invested} />
      </div>

      <aside className="min-w-0 flex max-w-[360px] flex-[1_1_300px] flex-col gap-3.5">
        {/* S5 cards first, then Transaction, then Recent transactions. */}
        {due.map((d) => {
          const asset = assets.find((a) => a.id === d.assetId)!;
          return (
            <CouponDueCard
              key={couponReminderId(d.assetId, d.date)}
              asset={asset}
              due={d}
              prefill={couponPrefill(asset, d, fetch.feed)}
              onSkip={() => dismissReminder(couponReminderId(d.assetId, d.date))}
            />
          );
        })}
        <TransactionPanel />
      </aside>
    </div>
  );
}
