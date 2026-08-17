import { headlineKpis } from '../core/derive';
import { toUsd } from '../core/money';
import { useSettings } from '../state/settings';
import { useFormat } from './useFormat';
import { useSnapshots, useTransactions } from './queries';
import { useTweenedNumber } from './useTweenedNumber';

/**
 * The one capital figure, and it has TWO renderers now — the sidebar's Total
 * capital card and the mobile header bar (phase 6, S2). It lives here rather
 * than in either of them precisely so there is never a second derivation: both
 * read `core/derive.headlineKpis`, through this, and a change to the number is a
 * change to one function.
 *
 * Returns the PARTS, not a sentence (G1, structured returns). The sidebar joins
 * them with a middot on one line; the header stacks them, paints the percentage
 * by sign on a light surface, and drops the counter-currency to `muted`. A
 * pre-joined string would have forced one of the two to take the other's layout.
 *
 * Total capital card values per design renderVals (~line 586): UAH mode shows
 * whole ₴ + "+3.08% · $3,324.03"; USD mode flips value and counter-currency.
 * The headline number tweens (~300ms, D7) whenever it changes — on the currency
 * toggle above all, but also as new data comes in.
 */
export interface CapitalCard {
  /** Headline, already tweened and formatted in the selected currency. */
  value: string;
  /** Net result as a percentage, formatted — `undefined` while there are no KPIs. */
  pct: string | undefined;
  /** The same total in the OTHER currency, formatted. */
  counter: string | undefined;
  /** The raw net percentage, so a light surface can paint it by sign. */
  net: number | undefined;
}

export function useCapitalCard(): CapitalCard {
  const f = useFormat();
  const { currency, usdRate } = useSettings();
  const snapshots = useSnapshots().data;
  const transactions = useTransactions().data;
  const kpis = snapshots && transactions ? headlineKpis(snapshots, transactions) : undefined;
  const total = kpis?.total ?? 0;
  const usdTotal = toUsd(total, usdRate);
  const tweened = useTweenedNumber(currency === 'UAH' ? total : usdTotal);

  if (!kpis) return { value: '—', pct: undefined, counter: undefined, net: undefined };
  return currency === 'UAH'
    ? {
        value: f.moneyWhole(tweened),
        pct: f.pct(kpis.net.pct),
        counter: f.money(usdTotal, 'USD'),
        net: kpis.net.pct,
      }
    : {
        value: f.money(tweened, 'USD'),
        pct: f.pct(kpis.net.pct),
        counter: f.money(total),
        net: kpis.net.pct,
      };
}
