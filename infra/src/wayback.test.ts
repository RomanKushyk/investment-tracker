import { describe, expect, it } from 'vitest';

import type { InzhurQuote, ParsedFeed } from '@quirenote/core/inzhur/parse';
import {
  mementoTimestamp,
  snapshotDay,
  snapshotUrl,
  WAYBACK_PARSER_VERSION,
  WAYBACK_SNAPSHOTS,
  waybackPlan,
  type DecodedSnapshot,
} from './wayback';
import type { ArchivedRow } from './derived-sell';

const REIT: InzhurQuote = {
  kind: 'fund',
  ref: 'inzhur-reit',
  sellUAH: 10.813,
  buyUAH: 10.8238,
  navUAH: 10.7166,
  paymentSchedule: [],
  status: 'active',
};
const BOND: InzhurQuote = {
  kind: 'bond',
  ref: 'UA4000236475',
  sellUAH: 1060.12,
  buyUAH: 1060.12,
  navUAH: 0,
  maturity: '2028-09-27',
  paymentSchedule: [],
  returnRates: { buy: 16.3, sell: 16.3 },
  status: 'active',
};

const feed = (...entries: InzhurQuote[]): ParsedFeed => ({ entries, skipped: [] });

/** A snapshot read at `iso` (UTC), whose response names the same instant. */
function snap(iso: string, f: ParsedFeed, memento = new Date(iso).toUTCString()): DecodedSnapshot {
  const timestamp = iso.replace(/[-:TZ]/g, '').slice(0, 14);
  return {
    snapshot: { timestamp, url: 'https://www.inzhur.reit/offer/inzhur-reit' },
    memento,
    feed: f,
  };
}

/** The message a plan refuses with, or a failure when it does not refuse. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal');
}

const archived = (
  asOf: string,
  ref: string,
  basis: string,
  price: string,
  parserVersion: string,
): ArchivedRow => ({
  asOf,
  ref,
  basis,
  price,
  parserVersion,
});

describe('waybackPlan, dating', () => {
  it('dates a snapshot by the Kyiv day of its Memento-Datetime, across a UTC midnight', () => {
    const { rows } = waybackPlan([snap('2026-05-28T22:30:00Z', feed(REIT))], []);
    expect(rows[0]).toMatchObject({ asOf: '2026-05-29', observedAt: '2026-05-28T22:30:00.000Z' });
  });

  it('refuses a response whose Memento-Datetime is not the snapshot it asked for', () => {
    const s = snap('2026-05-11T20:41:13Z', feed(REIT), 'Mon, 11 May 2026 20:41:14 GMT');
    expect(refusal(() => waybackPlan([s], []))).toMatch(
      /20260511204113: its Memento-Datetime Mon, 11 May 2026 20:41:14 GMT is not the snapshot's/,
    );
  });

  it('reads an HTTP-date as Wayback’s timestamp, and nothing else', () => {
    expect(mementoTimestamp('Mon, 11 May 2026 20:41:13 GMT')).toBe('20260511204113');
    expect(mementoTimestamp('not a date')).toBeUndefined();
  });
});

describe('waybackPlan, what a snapshot writes', () => {
  it('writes every basis served, as a capture would: a fund’s nav, never a bond’s 0', () => {
    const { rows } = waybackPlan([snap('2026-05-11T20:41:13Z', feed(REIT, BOND))], []);
    expect(rows.map((r) => `${r.ref} ${r.basis} ${r.price}`).sort()).toEqual([
      'UA4000236475 buy 1060.12',
      'UA4000236475 sell 1060.12',
      'inzhur-reit buy 10.8238',
      'inzhur-reit nav 10.7166',
      'inzhur-reit sell 10.813',
    ]);
    expect(rows.find((r) => r.ref === 'UA4000236475')).toMatchObject({
      returnRateBuy: 16.3,
      returnRateSell: 16.3,
      status: 'active',
    });
  });

  it('refuses a page with no asset list, and one with no priced fund', () => {
    const none: ParsedFeed = { entries: [], skipped: [{ ref: '(root)', reason: 'not_an_array' }] };
    expect(refusal(() => waybackPlan([snap('2026-05-11T20:41:13Z', none)], []))).toMatch(
      /20260511204113: no asset list on the page/,
    );
    expect(refusal(() => waybackPlan([snap('2026-05-11T20:41:13Z', feed(BOND))], []))).toMatch(
      /20260511204113: no priced fund on the page/,
    );
  });

  it('writes one row for a key two snapshots of a day agree on, and refuses when they differ', () => {
    const morning = snap('2026-05-14T09:41:00Z', feed(REIT));
    const noon = snap('2026-05-14T11:01:38Z', feed(REIT));
    expect(waybackPlan([morning, noon], []).rows).toHaveLength(3);
    const moved = snap('2026-05-14T11:01:38Z', feed({ ...REIT, sellUAH: 10.8131 }));
    const message = refusal(() => waybackPlan([morning, moved], []));
    expect(message).toMatch(
      /2026-05-14 inzhur-reit sell: snapshots 20260514094100 and 20260514110138 differ/,
    );
    expect(message).not.toMatch(/10\.81/);
  });

  it('bounds each instrument by its first and last snapshot day in any order, keeping a maturity', () => {
    // Out of time order, and the dated sighting before an undated one: neither may decide the bounds.
    const undated = { ...BOND, maturity: undefined };
    const { instruments } = waybackPlan(
      [
        snap('2026-05-11T20:41:13Z', feed(REIT, BOND)),
        snap('2026-05-08T02:10:40Z', feed(REIT, undated)),
        snap('2026-05-14T09:41:00Z', feed(REIT)),
      ],
      [],
    );
    expect(instruments).toEqual([
      { ref: 'inzhur-reit', kind: 'fund', maturity: null, first: '2026-05-08', last: '2026-05-14' },
      {
        ref: 'UA4000236475',
        kind: 'bond',
        maturity: '2028-09-27',
        first: '2026-05-08',
        last: '2026-05-11',
      },
    ]);
  });

  it('refuses two snapshots of a day that agree on a price but not on a written column', () => {
    const morning = snap('2026-05-14T09:41:00Z', feed(REIT, BOND));
    const differ =
      /2026-05-14 UA4000236475 sell: snapshots 20260514094100 and 20260514110138 differ/;
    const at = (bond: InzhurQuote) => () =>
      waybackPlan([morning, snap('2026-05-14T11:01:38Z', feed(REIT, bond))], []);
    expect(refusal(at({ ...BOND, status: 'soldOut' }))).toMatch(differ);
    expect(refusal(at({ ...BOND, returnRates: { buy: 16.4, sell: 16.3 } }))).toMatch(differ);
    expect(refusal(at({ ...BOND, returnRates: { buy: 16.3, sell: 16.4 } }))).toMatch(differ);
    expect(at({ ...BOND })).not.toThrow();
  });
});

describe('waybackPlan, a key the archive already holds', () => {
  const day = '2026-05-11';
  const s = snap(
    '2026-05-11T20:41:13Z',
    feed(REIT, {
      ...REIT,
      ref: 'inzhur-energy',
      sellUAH: 6526.9871,
      buyUAH: undefined,
      navUAH: undefined,
    }),
  );

  it('leaves an agreeing row as it is, and reports it', () => {
    const existing = [
      archived(day, 'inzhur-reit', 'nav', '10.716600', 'fund-history-1'),
      archived(day, 'inzhur-energy', 'sell', '6526.986700', 'derived-sell-1'),
    ];
    const { rows, report } = waybackPlan([s], existing);
    expect(rows.map((r) => `${r.ref} ${r.basis}`).sort()).toEqual([
      'inzhur-reit buy',
      'inzhur-reit sell',
    ]);
    expect(report.collisions).toEqual([
      { asOf: day, ref: 'inzhur-reit', basis: 'nav', parserVersion: 'fund-history-1' },
      { asOf: day, ref: 'inzhur-energy', basis: 'sell', parserVersion: 'derived-sell-1' },
    ]);
  });

  it('holds a derived row to half a kopeck over its divisor and its own rounding, every other to the digit', () => {
    // Energy is ÷9: 0.005 ÷ 9 + 0.00005 admits 0.0006 and not 0.0007.
    const at = (price: string, version: string) => () =>
      waybackPlan([s], [archived(day, 'inzhur-energy', 'sell', price, version)]);
    expect(at('6526.9865', 'derived-sell-1')).not.toThrow();
    expect(at('6526.9877', 'derived-sell-1')).not.toThrow();
    expect(refusal(at('6526.9864', 'derived-sell-1'))).toMatch(
      /2026-05-11 inzhur-energy sell: the archive's derived-sell-1 row disagrees/,
    );
    expect(refusal(at('6526.9872', 'fund-history-1'))).toMatch(/fund-history-1 row disagrees/);
    expect(refusal(at('6526.9872', '2'))).toMatch(/the archive's 2 row disagrees/);
    expect(at('6526.9871', '2')).not.toThrow();
  });

  it('compares the digits as stored, so a price past the fourth decimal is no match', () => {
    const at = (price: string) => () =>
      waybackPlan([s], [archived(day, 'inzhur-reit', 'nav', price, 'fund-history-1')]);
    expect(at('10.716600')).not.toThrow();
    for (const price of ['10.71664', '10.716649', '10.71655']) {
      expect(refusal(at(price)), price).toMatch(
        /inzhur-reit nav: the archive's fund-history-1 row disagrees/,
      );
    }
  });
});

describe('snapshotDay', () => {
  it('dates a Memento-Datetime by the Kyiv day, as a capture is dated, and nothing unreadable', () => {
    expect(snapshotDay('Thu, 28 May 2026 22:30:00 GMT')).toBe('2026-05-29');
    expect(snapshotDay('Thu, 28 May 2026 20:59:59 GMT')).toBe('2026-05-28');
    expect(snapshotDay('not a date')).toBeUndefined();
  });
});

describe('the committed snapshot list', () => {
  it('names each snapshot once, in time order, under a parser version of its own', () => {
    const stamps = WAYBACK_SNAPSHOTS.map((s) => s.timestamp);
    expect(stamps).toHaveLength(14);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(14);
    expect(WAYBACK_SNAPSHOTS.every((s) => s.url.startsWith('https://www.inzhur.reit/offer/'))).toBe(
      true,
    );
    expect(['1', '2', 'fund-history-1', 'derived-sell-1']).not.toContain(WAYBACK_PARSER_VERSION);
  });

  it('asks Wayback for each page as captured, unrewritten', () => {
    expect(snapshotUrl(WAYBACK_SNAPSHOTS[3])).toBe(
      'https://web.archive.org/web/20260511204113id_/https://www.inzhur.reit/offer/inzhur-reit',
    );
  });
});
