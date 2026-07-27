import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  currency: 'UAH' | 'USD';
  usdRate: number;
  setCurrency: (c: 'UAH' | 'USD') => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currency: 'UAH',
      usdRate: 44.83,
      setCurrency: (currency) => set({ currency }),
    }),
    { name: 'kubushka-settings', partialize: (s) => ({ currency: s.currency }) },
  ),
);
