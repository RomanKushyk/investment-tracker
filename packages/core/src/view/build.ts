// What `GET /view` serves: every screen's composer, the windowed ones once per period
// option. The union of the composers' own types, not a new vocabulary.
import type { PeriodOption, PeriodWindow } from '../period';
import { allocationView, type AllocationView } from './allocation';
import { attributesView, type AttributeCard } from './attributes';
import { balancesView, type BalancesView } from './balances';
import { capitalView, type CapitalView } from './capital';
import type { ViewInput } from './input';
import { overviewView, type OverviewView } from './overview';
import { payoutsView, type PayoutsView } from './payouts';
import { portfolioView, type PortfolioView } from './portfolio';
import { seasonalityView, type SeasonalityView } from './seasonality';
import { windowView } from './window';
import { yieldView, type YieldView } from './yield';

export interface PeriodView {
  window: PeriodWindow | undefined;
  overview: OverviewView;
  yield: YieldView;
  seasonality: SeasonalityView;
}

export interface View {
  periods: Record<PeriodOption, PeriodView>;
  payouts: PayoutsView;
  portfolio: PortfolioView;
  allocation: AllocationView;
  attributes: { cards: AttributeCard[] };
  balances: BalancesView;
  capital: CapitalView;
}

/** All six periods in ₴, so a period change or a currency flip costs no request; a screen
 *  that takes no period appears once, as the Balances chart is one point per snapshot. */
export function buildView(input: ViewInput): View {
  const at = (period: PeriodOption): PeriodView => {
    const withPeriod = { ...input, period };
    return {
      window: windowView(withPeriod),
      overview: overviewView(withPeriod),
      yield: yieldView(withPeriod),
      seasonality: seasonalityView(withPeriod),
    };
  };
  return {
    // A literal, so the `Record` type checks that every option is here.
    periods: {
      all: at('all'),
      '1m': at('1m'),
      '3m': at('3m'),
      '6m': at('6m'),
      '12m': at('12m'),
      ytd: at('ytd'),
    },
    payouts: payoutsView(input),
    portfolio: portfolioView(input),
    allocation: allocationView(input),
    attributes: attributesView(input),
    balances: balancesView(input),
    capital: capitalView(input),
  };
}
