import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { QuoteOrigin } from '../core/types';

// Draft quote entry — raw input text per asset, survives reloads (README §3).
interface DraftState {
  date: string; // ISO yyyy-MM-dd
  quotes: Record<string, string>;
  // Provenance of the MACHINE-filled drafts only (P3 S2): assetId → which
  // fetch produced the value. A quote with no entry here is the user's own —
  // typed, copied or prefilled from a saved snapshot — which is exactly what
  // makes "never overwrite a user value" (G5) decidable after a reload.
  origins: Record<string, QuoteOrigin>;
  setDate: (d: string) => void;
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
      setDate: (date) => set({ date, quotes: {}, origins: {} }), // date change clears drafts
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
    { name: 'kubushka-draft' },
  ),
);
