import { describe, expect, it } from 'vitest';

import sample from '../../src/core/inzhur/__fixtures__/assets-sample.json';
import { parseAssetsFeed } from '../../src/core/inzhur/parse';
import type { InzhurQuote } from '../../src/core/inzhur/parse';
import { inzhurObservationRows } from './observation-rows';

// W4 turns one parsed feed entry into the rows `price_observation` stores.
// Pure on purpose: the DB half of `observeInzhur` is untestable without a
// cluster, so everything that can be decided from the payload alone lives here
// and is tested against the REAL fixture rather than a hand-built object.
const bond = (over: Partial<InzhurQuote> = {}): InzhurQuote => ({
  kind: 'bond',
  ref: 'UA4000238976',
  sellUAH: 1063.13,
  buyUAH: 1050.0,
  paymentSchedule: [],
  returnRates: { buy: 17.5, sell: 16.25 },
  status: 'active',
  ...over,
});

describe('inzhurObservationRows', () => {
  it('writes one row per basis the provider actually served', () => {
    const rows = inzhurObservationRows(bond({ navUAH: undefined }));
    expect(rows.map((r) => r.basis)).toEqual(['sell', 'buy']);
  });

  it('always writes sell, because the parser requires sellUAH', () => {
    const rows = inzhurObservationRows(bond({ buyUAH: undefined, navUAH: undefined }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ basis: 'sell', price: 1063.13 });
  });

  it('writes nav for a fund, and nav is a basis rather than a column', () => {
    const rows = inzhurObservationRows({
      kind: 'fund',
      ref: 'inzhur-reit',
      sellUAH: 10.09,
      buyUAH: 10.1,
      navUAH: 10.0,
      paymentSchedule: [],
    });
    expect(rows.map((r) => r.basis)).toEqual(['sell', 'buy', 'nav']);
    expect(rows.find((r) => r.basis === 'nav')?.price).toBe(10.0);
  });

  // The rates and the status are facts about the INSTRUMENT-DAY, not about one
  // basis, so every row of that day carries them. A `sell` row read on its own
  // then answers "what yield explained this price" without a join back to the
  // `buy` row — and the read contract serves whole year files, where that join
  // would be across the file.
  it('repeats the instrument-day facts on every basis row', () => {
    const rows = inzhurObservationRows(bond({ navUAH: 1000 }));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.returnRateBuy).toBe(17.5);
      expect(r.returnRateSell).toBe(16.25);
      expect(r.status).toBe('active');
    }
  });

  // D31 measured it: `nav` is "exactly `0` for `ocean-plaza` and `zhytniy`, two
  // of the four funds" — 0 is the provider's not-published marker, not a price.
  // The fixture shows every BOND carrying `"nav": 0` for the same reason. The
  // archive has no DELETE grant, so writing these would mean thousands of rows
  // permanently asserting a NAV of zero.
  it('never writes a nav row for the provider zero, which means not published', () => {
    const rows = inzhurObservationRows(bond({ navUAH: 0 }));
    expect(rows.map((r) => r.basis)).toEqual(['sell', 'buy']);
  });

  it('writes nav when it is genuinely published', () => {
    const rows = inzhurObservationRows(bond({ navUAH: 1000 }));
    expect(rows.map((r) => r.basis)).toContain('nav');
  });

  // Only `nav` has the measured sentinel. A zero elsewhere is left alone rather
  // than generalised into a rule the evidence does not support.
  it('does not generalise the zero rule to the other bases', () => {
    const rows = inzhurObservationRows(bond({ buyUAH: 0, navUAH: undefined }));
    expect(rows.map((r) => r.basis)).toEqual(['sell', 'buy']);
    expect(rows.find((r) => r.basis === 'buy')?.price).toBe(0);
  });

  it('leaves the bond-only columns null for a fund', () => {
    const rows = inzhurObservationRows({
      kind: 'fund',
      ref: 'inzhur-energy',
      sellUAH: 5,
      paymentSchedule: [],
    });
    expect(rows[0]).toMatchObject({ returnRateBuy: null, returnRateSell: null, status: null });
  });

  it('distinguishes a missing rate from a zero one', () => {
    const rows = inzhurObservationRows(bond({ returnRates: { sell: 0 } }));
    expect(rows[0].returnRateSell).toBe(0);
    expect(rows[0].returnRateBuy).toBeNull();
  });

  it('produces rows for every entry of the real fixture, sell included', () => {
    const feed = parseAssetsFeed(sample);
    expect(feed.entries.length).toBeGreaterThan(0);
    for (const q of feed.entries) {
      const rows = inzhurObservationRows(q);
      expect(rows.some((r) => r.basis === 'sell')).toBe(true);
      // A zero-spread bond still gets both rows: `basis` records what was
      // served, not whether the two differ. W3 measured 5-6 of 32 bonds at a
      // zero spread on any given day, and one collapsed permanently mid-window.
      for (const r of rows) {
        expect(Number.isFinite(r.price)).toBe(true);
        if (r.basis === 'nav') expect(r.price).toBeGreaterThan(0);
      }
    }
  });
});
