import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Draft quote entry — raw input text per asset, survives reloads (README §3).
interface DraftState {
  date: string; // ISO yyyy-MM-dd
  quotes: Record<string, string>;
  setDate: (d: string) => void;
  setQuote: (assetId: string, v: string) => void;
  clear: () => void;
}

export const useDraft = create<DraftState>()(
  persist(
    (set) => ({
      date: '',
      quotes: {},
      setDate: (date) => set({ date, quotes: {} }), // date change clears drafts
      setQuote: (assetId, v) =>
        set((s) => ({ quotes: { ...s.quotes, [assetId]: v } })),
      clear: () => set({ quotes: {} }),
    }),
    { name: 'kubushka-draft' },
  ),
);
