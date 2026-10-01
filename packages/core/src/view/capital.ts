// The sidebar's capital strip and the mobile header: the one capital figure, never
// windowed, read by both renderers through this.
import { headlineKpis } from '../derive';
import type { LedgerInput } from './input';

export type CapitalView = ReturnType<typeof headlineKpis>;

export function capitalView({
  snapshots,
  transactions,
}: Pick<LedgerInput, 'snapshots' | 'transactions'>): CapitalView {
  return headlineKpis(snapshots, transactions);
}
