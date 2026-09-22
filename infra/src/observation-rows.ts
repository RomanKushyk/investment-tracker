import type { InzhurQuote } from '@quirenote/core/inzhur/parse';

/** One `price_observation` row, minus the key columns the caller supplies or this file names. */
export interface ObservationRow {
  ref: string;
  basis: string;
  price: number;
  returnRateBuy: number | null;
  returnRateSell: number | null;
  status: string | null;
}

const BASIS_SELL = 'sell';
const BASIS_BUY = 'buy';
/** Exported for the fund-history import, which writes this basis and no other. */
export const BASIS_NAV = 'nav';

/**
 * One row per basis the provider ACTUALLY SERVED, and none for one it did not — an absent
 * `buyUAH` or `navUAH` is not a zero. WRITE-EVERY-DAY IS THE CALLER'S JOB: write-on-change was
 * rejected because a missing row makes a zero delta and an unknown delta identical in the data,
 * and the archive's rule for consumers is that the two must never render the same.
 */
export function inzhurObservationRows(quote: InzhurQuote): ObservationRow[] {
  // `?? null` rather than `|| null`: a rate of 0 is a real reading — a two-sided quote can
  // collapse to a zero spread mid-window. REPEATED ON EVERY ROW deliberately: these are facts
  // about the instrument-DAY rather than about one basis, which is what makes a row
  // self-describing to a consumer holding only one of them.
  const shared = {
    returnRateBuy: quote.returnRates?.buy ?? null,
    returnRateSell: quote.returnRates?.sell ?? null,
    status: quote.status ?? null,
  };

  const rows: ObservationRow[] = [
    { ref: quote.ref, basis: BASIS_SELL, price: quote.sellUAH, ...shared },
  ];
  if (quote.buyUAH != null) {
    rows.push({ ref: quote.ref, basis: BASIS_BUY, price: quote.buyUAH, ...shared });
  }
  // ZERO IS THE PROVIDER'S NULL FOR `nav`, AND ONLY FOR `nav`: every BOND carries `"nav": 0`
  // because a bond has no net asset value and the feed fills the field rather than omitting it.
  // A sentinel is not a measurement, and writing it would put a permanent zero NAV on every
  // bond-day in a table with no DELETE grant. Deliberately not generalised to `buy` or `sell`,
  // where a zero is an observation until something measures otherwise.
  if (quote.navUAH != null && quote.navUAH > 0) {
    rows.push({ ref: quote.ref, basis: BASIS_NAV, price: quote.navUAH, ...shared });
  }
  return rows;
}
