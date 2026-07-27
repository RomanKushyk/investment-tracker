import { useEffect } from 'react';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import {
  useAssets,
  useSaveSnapshot,
  useSnapshots,
  useTransactions,
} from '../hooks/queries';
import { investedByAsset, latestCash, latestQuotes } from '../lib/derive';
import { fmtSavedAt, fmtTable } from '../lib/format';
import { quoteInputSchema } from '../lib/schemas';
import type { Snapshot } from '../lib/types';
import { useDraft } from '../state/draft';
import { maxSavedAt, yesterdayQuote } from './daily-quotes/quotes';
import { QuoteRow } from './daily-quotes/QuoteRow';
import { YieldTeaser } from './daily-quotes/YieldTeaser';
import { TransactionPanel } from './TransactionPanel';

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DailyQuotes() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];
  const { date, quotes, setDate, setQuote } = useDraft();
  const saveSnapshot = useSaveSnapshot();

  // First run ever: default the draft to today.
  useEffect(() => {
    if (!date) setDate(todayIso());
  }, [date, setDate]);

  const selectedDate = date || todayIso();
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
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[13px] whitespace-nowrap">Date</label>
            <DatePicker value={selectedDate} onChange={setDate} />
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
              onChange={(v) => setQuote(a.id, v)}
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

      <aside className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-3.5">
        <TransactionPanel />
      </aside>
    </div>
  );
}
