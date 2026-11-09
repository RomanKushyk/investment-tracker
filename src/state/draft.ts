import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { DRAFT_KEY } from '../lib/storage-keys';
import { inputValue, type Lang } from '@quirenote/core/money';
import { amountInputSchema } from '@quirenote/core/schemas';
import type { QuoteOrigin } from '@quirenote/core/types';

/** The draft's save, by which the account's forget finds it in flight after `/` has unmounted. */
export const DRAFT_SAVE_KEY = ['draft', 'save'] as const;

/** What the draft's day records and the assets `/` shows, for a forget off `/` to compare against. */
export interface DraftBaseline {
  recorded: Record<string, number>;
  ids: string[];
}

const NO_BASELINE: DraftBaseline = { recorded: {}, ids: [] };

// WHAT A SAVE WOULD CHANGE, so an ended session can say it was lost. Read at the two decimals the
// prefill writes the day's quote in, so a row left as prefilled is no change.
export function quotesUnsaved(
  drafts: Record<string, string | undefined>,
  ids: readonly string[],
  recorded: Record<string, number>,
  lang: Lang,
): boolean {
  const schema = amountInputSchema(lang);
  return ids.some((id) => {
    const raw = drafts[id];
    if (raw === undefined) return false;
    const held = Object.hasOwn(recorded, id) ? recorded[id] : undefined;
    if (raw.trim() === '') return held !== undefined;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return true;
    return held === undefined || inputValue(parsed.data, 2) !== inputValue(held, 2);
  });
}

// Draft quote entry — raw input text per asset, survives reloads (README §3).
interface DraftState {
  date: string; // ISO yyyy-MM-dd
  quotes: Record<string, string>;
  // Provenance of the MACHINE-filled drafts only: assetId → which
  // fetch produced the value. A quote with no entry here is the user's own —
  // typed, copied or prefilled from a saved snapshot — which is exactly what
  // makes "never overwrite a user value" decidable after a reload.
  origins: Record<string, QuoteOrigin>;
  // Kept with the draft: the day's read may be out of memory when the account is forgotten off `/`.
  baseline: DraftBaseline;
  setDate: (d: string) => void;
  setBaseline: (baseline: DraftBaseline) => void;
  setQuote: (assetId: string, v: string) => void;
  fillQuote: (assetId: string, v: string, origin: QuoteOrigin) => void;
  clear: () => void;
}

export const useDraft = create<DraftState>()(
  persist(
    (set) => ({
      date: '',
      quotes: {},
      origins: {},
      baseline: NO_BASELINE,
      setDate: (date) => set({ date, quotes: {}, origins: {}, baseline: NO_BASELINE }), // date change clears drafts
      setBaseline: (baseline) => set({ baseline }),
      // The user's path: typing always claims the row (chip → `manual`).
      setQuote: (assetId, v) =>
        set((s) => {
          const origins = { ...s.origins };
          delete origins[assetId];
          return { quotes: { ...s.quotes, [assetId]: v }, origins };
        }),
      // The machine's path: a fetched/cached value plus where it came from.
      fillQuote: (assetId, v, origin) =>
        set((s) => ({
          quotes: { ...s.quotes, [assetId]: v },
          origins: { ...s.origins, [assetId]: origin },
        })),
      clear: () => set({ quotes: {}, origins: {} }),
    }),
    { name: DRAFT_KEY },
  ),
);
