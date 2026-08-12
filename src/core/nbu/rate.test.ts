import { describe, expect, it } from 'vitest';

import { nbuRateUrl, parseNbuRate } from './rate';

// Verbatim bodies from the live endpoint, fetched 2026-08-12. The error shapes
// below are the reason this parser takes text: they all arrive as HTTP 200.
const OK = '[\n{ \n"r030":840,"txt":"Долар США","rate":44.866,"cc":"USD","exchangedate":"12.08.2026","special":"N"\n }\n]';
const WEEKEND = '[\n{ \n"r030":840,"txt":"Долар США","rate":44.7626,"cc":"USD","exchangedate":"09.08.2026","special":"N"\n }\n]';
const EMPTY = '[]';
const BAD_DATE = '[{ Wrong date format }]';

describe('parseNbuRate', () => {
  it('reads a published rate', () => {
    expect(parseNbuRate(OK)).toEqual({ rate: 44.866, date: '2026-08-12', currency: 'USD' });
  });

  // NBU carries the previous banking day forward and stamps it with the date
  // that was requested. Measured: 07 (Fri), 08 (Sat) and 09 (Sun) all 44.7626.
  // The value is reported as-is — the official Sunday rate genuinely is
  // Friday's, so there is nothing to correct and nothing to claim.
  it('reports a weekend rate under the requested date, without pretending it is fresh', () => {
    expect(parseNbuRate(WEEKEND)).toEqual({ rate: 44.7626, date: '2026-08-09', currency: 'USD' });
  });

  // A future date and an unknown currency both answer 200 with an empty array.
  it('returns undefined for an empty payload', () => {
    expect(parseNbuRate(EMPTY)).toBeUndefined();
  });

  // The one that would throw if this took parsed JSON instead of text.
  it('survives a 200 whose body is not JSON at all', () => {
    expect(parseNbuRate(BAD_DATE)).toBeUndefined();
  });

  it('returns undefined rather than throwing on junk', () => {
    for (const junk of ['', 'null', '{}', '"a string"', '[1,2,3]']) {
      expect(parseNbuRate(junk)).toBeUndefined();
    }
  });

  it('ignores an entry for a different currency', () => {
    const eur = OK.replace('"cc":"USD"', '"cc":"EUR"');
    expect(parseNbuRate(eur)).toBeUndefined();
    expect(parseNbuRate(eur, 'EUR')?.rate).toBe(44.866);
  });

  // Per-entry skip: a malformed neighbour must not discard a good row.
  it('skips a malformed entry and keeps a good one', () => {
    const mixed = `[{"rate":"nope","cc":"USD","exchangedate":"12.08.2026"},{"r030":840,"rate":44.866,"cc":"USD","exchangedate":"12.08.2026"}]`;
    expect(parseNbuRate(mixed)?.rate).toBe(44.866);
  });

  it('rejects a non-positive or non-finite rate rather than passing it to a division', () => {
    for (const bad of ['0', '-3', 'null']) {
      const body = `[{"rate":${bad},"cc":"USD","exchangedate":"12.08.2026"}]`;
      expect(parseNbuRate(body)).toBeUndefined();
    }
  });

  it('rejects an entry whose date is not a real date', () => {
    expect(parseNbuRate('[{"rate":44.8,"cc":"USD","exchangedate":"31.02.2026"}]')).toBeUndefined();
  });

  // Tolerance is the contract: an added field must never break the parse.
  it('ignores fields it does not know', () => {
    const extra = '[{"rate":44.866,"cc":"USD","exchangedate":"12.08.2026","brandNew":{"x":1}}]';
    expect(parseNbuRate(extra)?.rate).toBe(44.866);
  });
});

describe('nbuRateUrl', () => {
  // Omitting date= returns tomorrow's rate once it is published in the
  // afternoon, so the date is never optional.
  it('always carries an explicit compact date', () => {
    expect(nbuRateUrl('2026-08-12')).toBe(
      'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=usd&date=20260812&json',
    );
  });
});
