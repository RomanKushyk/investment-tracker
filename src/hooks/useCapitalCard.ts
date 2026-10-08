import { toUsd } from '@quirenote/core/money';
import { capitalView } from '@quirenote/core/view/capital';
import { useSettings } from '../state/settings';
import { useFormat } from './useFormat';
import { useLedgerAsOfToday } from './useLedgerAsOfToday';
import { useTweenedNumber } from './useTweenedNumber';

/**
 * The one capital figure, with TWO renderers — the sidebar's Total
 * capital card and the mobile header bar. It lives here rather
 * than in either of them precisely so there is never a second derivation: both
 * read `capitalView`, through this, and a change to the number is a change to one
 * function.
 *
 * Returns the PARTS, not a sentence. The sidebar joins
 * them with a middot on one line; the header stacks them, paints the percentage
 * by sign on a light surface, and drops the counter-currency to `muted`. A
 * pre-joined string would have forced one of the two to take the other's layout.
 *
 * UAH mode shows whole ₴ with the net percentage and the dollar total as the
 * counter-currency; USD mode flips value and counter-currency.
 * The headline number tweens whenever it changes — on the currency toggle above
 * all, but also as new data comes in. *Interaction rules*
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
  const { snapshots, transactions, ready } = useLedgerAsOfToday();
  const kpis = ready ? capitalView({ snapshots, transactions }) : undefined;
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
