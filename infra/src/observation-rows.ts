import type { InzhurQuote } from '../../src/core/inzhur/parse';

/**
 * One `price_observation` row, minus the four key columns the caller supplies
 * (`as_of`, `source`) or that this file names (`instrument_ref`, `basis`).
 */
export interface ObservationRow {
  ref: string;
  basis: string;
  price: number;
  returnRateBuy: number | null;
  returnRateSell: number | null;
  status: string | null;
}

/**
 * The Inzhur half of `basis`. All four values have been legal since row one
 * (migrations/002) precisely so this day needed no key change — NBU writes
 * `fair`, and these three were reserved for exactly this.
 */
const BASIS_SELL = 'sell';
const BASIS_BUY = 'buy';
const BASIS_NAV = 'nav';

/**
 * Turn one parsed feed entry into the rows the archive stores for it.
 *
 * ONE ROW PER BASIS THE PROVIDER ACTUALLY SERVED, and no row for one it did
 * not. `sellUAH` is required by the parser so `sell` is always present;
 * `buyUAH` and `navUAH` are optional and their absence is not a zero. This is
 * the schema's own rule read literally — `price_observation` holds "exactly
 * what the provider served, per instrument per day" — and it is why `nav` is a
 * basis rather than a column: a fund's NAV and its sell price are two
 * measurements of one instrument-day, not two fields of one measurement.
 *
 * WRITE-EVERY-DAY is the caller's job, not this function's: it is handed one
 * capture's entry and always yields that entry's rows. The alternative,
 * write-on-change, was rejected because the archive's governing rule for
 * consumers is that "a zero delta and an unknown delta must never render the
 * same" — and a missing row makes them identical in the data. Fund NAV moves
 * on five days a week (W3) while the funds appear in all seven payloads, so
 * under write-on-change two days a week would be indistinguishable from a
 * capture that never ran.
 *
 * THE RATES AND THE STATUS REPEAT ON EVERY ROW, deliberately. They are facts
 * about the instrument-DAY, not about one basis, and the columns are named for
 * the two sides of the quote rather than for the row's own basis. Repeating
 * them makes a row self-describing: the read contract serves whole year files,
 * so a consumer holding a `sell` row can answer "what yield explained this
 * price" without seeking back to the `buy` row of the same day. The cost is a
 * value stored two or three times that is identical by construction.
 */
export function inzhurObservationRows(quote: InzhurQuote): ObservationRow[] {
  // `?? null` rather than `|| null`: a rate of 0 is a real reading. W3 watched
  // one bond's two-sided quote COLLAPSE mid-window — buy and sell equal, and
  // 5-6 of 32 carry a zero spread on any day — so zero is an observation here,
  // never a stand-in for absent.
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
  // ZERO IS THE PROVIDER'S NULL FOR `nav`, AND ONLY FOR `nav`. D31 measured it —
  // *"`nav` is not universally published: it is exactly `0` for `ocean-plaza`
  // and `zhytniy`, two of the four funds"* — and it is why fund value uses
  // `sell`. Every BOND carries `"nav": 0` for the same reason: a bond has no
  // net asset value, and the feed fills the field rather than omitting it.
  //
  // So this is not "filtering what the provider served". A sentinel is not a
  // measurement, and writing it would put a permanent ₴0 NAV on every bond-day
  // in a table with no DELETE grant — the archive's own rule that a zero and an
  // unknown must never render the same, broken in the writer.
  //
  // Deliberately NOT generalised to `buy` or `sell`: the evidence names `nav`,
  // and a zero price elsewhere is an observation until something measures
  // otherwise. W3 watched a two-sided quote collapse to a zero SPREAD, which is
  // real and must survive.
  if (quote.navUAH != null && quote.navUAH > 0) {
    rows.push({ ref: quote.ref, basis: BASIS_NAV, price: quote.navUAH, ...shared });
  }
  return rows;
}
