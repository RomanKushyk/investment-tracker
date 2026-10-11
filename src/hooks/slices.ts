// The slice of the view each screen and form reads: one selector each, made here at module level
// and handed to `useView`. Not defined at a call site, because `select` runs again whenever its
// function changes, and what a selector returns is shared structurally with the last answer, so a
// consumer renders only when its own slice moved (*Core is pure*).
//
// A selector picks what the view carries and computes nothing but the cut a form does not make:
// a figure is the server's.
import { PERIOD_OPTIONS, type PeriodOption } from '@quirenote/core/period';
import type { ViewBody } from '@quirenote/core/view/serve';

/** A selector for each period option, made once, since a period is a choice and not a render. */
function perPeriod<T>(pick: (body: ViewBody, period: PeriodOption) => T) {
  const table = {} as Record<PeriodOption, (body: ViewBody) => T>;
  for (const period of PERIOD_OPTIONS) table[period] = (body) => pick(body, period);
  return table;
}

// --- the shell

export const selectCapital = (body: ViewBody) => body.view.capital;

/** The official rate under its day, or none: what a ₴ figure is converted at. */
export const selectFx = (body: ViewBody) => body.fx;

/** What the period control spans: the whole history, whatever period is chosen. */
export const selectSpan = (body: ViewBody) => ({ window: body.view.periods.all.window });

/** The reminders read the rows, and of the stored days only the caller's quotes. */
export const selectReminders = (body: ViewBody) => ({
  assets: body.assets,
  transactions: body.transactions,
  today: body.today.date,
  quotes: body.today.quotes,
});

// --- the screens with a period

export const overviewOf = perPeriod((body, period) => ({
  overview: body.view.periods[period].overview,
  today: body.today.date,
}));

export const yieldOf = perPeriod((body, period) => ({
  yield: body.view.periods[period].yield,
  assets: body.assets,
}));

export const seasonalityOf = perPeriod((body, period) => ({
  seasonality: body.view.periods[period].seasonality,
  assets: body.assets,
}));

// --- the screens without

export const selectPayouts = (body: ViewBody) => ({
  payouts: body.view.payouts,
  assets: body.assets,
});

export const selectPortfolio = (body: ViewBody) => ({
  portfolio: body.view.portfolio,
  assets: body.assets,
});

export const selectAllocation = (body: ViewBody) => ({
  allocation: body.view.allocation,
  assets: body.assets,
});

/** The cards, and the transactions a feed's YTM is solved over: the ledger as the figures read it,
 *  nothing dated after the caller's day (*Metric families and windows*). */
export const selectAttributes = (body: ViewBody) => ({
  cards: body.view.attributes.cards,
  transactions: body.transactions.filter((t) => t.date <= body.today.date),
});

export const selectBalances = (body: ViewBody) => ({
  chart: body.view.balances.chart,
  earliest: body.view.balances.earliest,
  assets: body.assets,
});

// --- the forms, which read the rows the figures are cut from

/** The quotes form: every row, the caller's day as it opens, and the yield card at «Від початку». */
export const selectQuotesForm = (body: ViewBody) => ({
  assets: body.assets,
  transactions: body.transactions,
  day: body.today,
  yields: body.view.periods.all.yield.rows,
});

/** The transaction form and its ledger. */
export const selectLedgerForm = (body: ViewBody) => ({
  assets: body.assets,
  transactions: body.transactions,
});

/** What deleting each asset takes besides the asset. */
export const selectDeleteCounts = (body: ViewBody) => body.deleteCounts;
