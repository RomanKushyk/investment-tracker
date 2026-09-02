import { describe, expect, it } from 'vitest';

import sample from '../../src/core/inzhur/__fixtures__/assets-sample.json';
import { parseAssetsFeed } from '../../src/core/inzhur/parse';
import type { InzhurQuote } from '../../src/core/inzhur/parse';
import { bondTermsRow } from './bond-terms';

const bond = (over: Partial<InzhurQuote> = {}): InzhurQuote => ({
  kind: 'bond',
  ref: 'UA4000238976',
  sellUAH: 1063.13,
  maturity: '2027-03-24',
  paymentSchedule: [
    { date: '2026-09-23', amount: 78.4 },
    { date: '2027-03-24', amount: 78.4 },
    { date: '2027-03-24', amount: 1000 },
  ],
  ...over,
});

describe('bondTermsRow', () => {
  it('is bonds only — a fund has no terms to archive', () => {
    expect(
      bondTermsRow({ kind: 'fund', ref: 'inzhur-reit', sellUAH: 10, paymentSchedule: [] }),
    ).toBeNull();
  });

  it('refuses a bond with no schedule, because an empty archive row is a lie', () => {
    // The whole reason this table exists is that delisting destroys the live
    // copy. Writing a row that says "this bond has no payments" would be worse
    // than writing nothing: it is indistinguishable from a real zero-coupon.
    expect(bondTermsRow(bond({ paymentSchedule: [] }))).toBeNull();
  });

  it('carries the maturity and the schedule verbatim', () => {
    const row = bondTermsRow(bond());
    expect(row).toMatchObject({ ref: 'UA4000238976', maturity: '2027-03-24' });
    expect(JSON.parse(row!.paymentSchedule)).toEqual(bond().paymentSchedule);
  });

  // The digest is what makes a REVISION findable without diffing JSON across
  // 365 rows a year. Same terms must hash the same on any day; any change to
  // any field must move it.
  it('hashes the same terms identically whatever day they are seen on', () => {
    expect(bondTermsRow(bond())!.termsSha256).toBe(bondTermsRow(bond())!.termsSha256);
  });

  it('moves the digest when an amount changes', () => {
    const revised = bond({
      paymentSchedule: [
        { date: '2026-09-23', amount: 80.0 },
        { date: '2027-03-24', amount: 78.4 },
        { date: '2027-03-24', amount: 1000 },
      ],
    });
    expect(bondTermsRow(revised)!.termsSha256).not.toBe(bondTermsRow(bond())!.termsSha256);
  });

  it('moves the digest when the maturity changes', () => {
    expect(bondTermsRow(bond({ maturity: '2027-03-25' }))!.termsSha256).not.toBe(
      bondTermsRow(bond())!.termsSha256,
    );
  });

  it('does not confuse two bonds that share a schedule', () => {
    const other = bond({ ref: 'UA4000236475' });
    expect(bondTermsRow(other)!.termsSha256).not.toBe(bondTermsRow(bond())!.termsSha256);
  });

  it('produces a row for every bond in the real fixture and none for the funds', () => {
    const feed = parseAssetsFeed(sample);
    const bonds = feed.entries.filter((e) => e.kind === 'bond');
    const funds = feed.entries.filter((e) => e.kind === 'fund');
    expect(bonds.length).toBeGreaterThan(0);
    expect(funds.length).toBeGreaterThan(0);
    for (const b of bonds) expect(bondTermsRow(b)).not.toBeNull();
    for (const f of funds) expect(bondTermsRow(f)).toBeNull();
  });
});
