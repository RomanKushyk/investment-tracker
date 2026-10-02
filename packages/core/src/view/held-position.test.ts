import { describe, expect, it } from 'vitest';

import { attributesView } from './attributes';
import { capitalView } from './capital';
import { overviewView } from './overview';
import { portfolioView } from './portfolio';
import { TEST_LEDGERS } from './test-ledgers';
import { yieldView } from './yield';

// A position's value counts while the ledger holds units of it; a sold-out one counts only
// its proceeds. The sidebar, Portfolio and Overview take the same capital gain from it.
const ledger = (name: string) => TEST_LEDGERS.find((l) => l.name === name)!.input;
const byId = <T extends { asset: { id: string } }>(rows: T[], id: string) =>
  rows.find((r) => r.asset.id === id)!;

describe('a partial sale', () => {
  const input = ledger('sold-and-unquoted');

  it("Overview's capital gain at the full history is the sidebar's and Portfolio's Total", () => {
    // Energy still holds 5 000 of its 6 000 units, so its value counts beside the proceeds.
    const sidebar = capitalView(input).net;
    expect(sidebar.uah).toBeCloseTo(9452.61, 2);
    expect(sidebar.pct * 100).toBeCloseTo(6.32, 2);
    for (const net of [
      overviewView({ ...input, period: 'all' }).net,
      portfolioView(input).totals.net,
    ]) {
      expect(net.uah).toBeCloseTo(sidebar.uah, 6);
      expect(net.pct).toBeCloseTo(sidebar.pct, 10);
    }
  });
});

describe('a position sold out while later snapshots still quote it', () => {
  // …8976's 15 units are sold on 1 July and the seed quotes it to 25 July; energy is sold out
  // too. Held: REIT 68 702,10 and …6475 4 374,12, beside 76 300 of proceeds.
  const input = ledger('sold-out');

  it('adds its proceeds and none of its last quote to every capital gain', () => {
    for (const net of [
      capitalView(input).net,
      portfolioView(input).totals.net,
      overviewView({ ...input, period: 'all' }).net,
    ]) {
      expect(net.uah).toBeCloseTo(4820.22, 2);
    }
  });

  it('adds none of its last quote to total capital', () => {
    // 73 076,22 held, plus free cash of 7,75 and the proceeds.
    for (const total of [
      capitalView(input).total,
      portfolioView(input).totals.value,
      overviewView({ ...input, period: 'all' }).total,
    ]) {
      expect(total).toBeCloseTo(149383.97, 2);
    }
  });
});

describe('a position of fractional units sold out', () => {
  // All 6 269,0996 of the seed's REIT units, bought as 6164 + 43.4835 + 61.6161, are sold on
  // 26 July for 69 000; the 27 July snapshot still quotes REIT at 68 702,10.
  const input = {
    ...ledger('seed'),
    transactions: [
      ...ledger('seed').transactions,
      {
        id: 'out',
        date: '2026-07-26',
        type: 'sell' as const,
        assetId: 'reit',
        amount: 69_000,
        quantity: 6269.0996,
      },
    ],
  };
  const at = { ...input, period: 'all' as const };

  it('adds none of its last quote to total capital', () => {
    // The seed's 149 016,36, less REIT's 68 702,10, plus the 69 000.
    for (const total of [
      capitalView(input).total,
      portfolioView(input).totals.value,
      overviewView(at).total,
    ]) {
      expect(total).toBeCloseTo(149314.26, 2);
    }
  });

  it('adds its proceeds and none of its last quote to every capital gain', () => {
    for (const net of [
      capitalView(input).net,
      portfolioView(input).totals.net,
      overviewView(at).net,
    ]) {
      expect(net.uah).toBeCloseTo(4750.51, 2);
    }
    expect(byId(portfolioView(input).rows, 'reit').value).toBe(0);
  });
});

describe('a position sold out after its last quote', () => {
  // Energy: 59 208 in and 60 500 out on 26 July. Its last quote, 25 July, carries forward
  // in the merge, and the full history spans 174 days.
  const input = ledger('sold-out');
  const at = { ...input, period: 'all' as const };
  const delta = 60_500 / 59_208 - 1;
  const annualized = (delta * 365) / 174;

  it("reads its proceeds against its basis on /yield, Overview's yield and Attributes", () => {
    const row = byId(yieldView(at).rows, 'energy');
    expect(row.deltaTotal).toBeCloseTo(delta, 10);
    expect(row.annualized).toBeCloseTo(annualized, 10);
    expect(byId(overviewView(at).rows, 'energy').yield).toBeCloseTo(delta, 10);
    const card = byId(attributesView(input).cards, 'energy');
    expect(card.kind === 'market' && card.actualAnnualized).toBeCloseTo(annualized, 10);
  });
});

describe('a position sold out after the last snapshot', () => {
  // The seed's last snapshot is 27 July; energy's 6 000 units are sold on the 29th. A window
  // ends at the last snapshot and counts every row after it, so the sale's units count too.
  const input = {
    ...ledger('seed'),
    transactions: [
      ...ledger('seed').transactions,
      {
        id: 'late',
        date: '2026-07-29',
        type: 'sell' as const,
        assetId: 'energy',
        amount: 60_500,
        quantity: 6000,
      },
    ],
  };
  const at = { ...input, period: 'all' as const };

  it('counts its proceeds and none of its last quote, on Overview as on the sidebar', () => {
    // REIT, …8976 and …6475 held, beside 60 500 of proceeds, against 144 556 in.
    expect(capitalView(input).net.uah).toBeCloseTo(4866.52, 2);
    expect(overviewView(at).net.uah).toBeCloseTo(4866.52, 2);
  });

  it("reads its proceeds against its basis on /yield and in Portfolio's row", () => {
    const delta = 60_500 / 59_208 - 1;
    expect(byId(yieldView(at).rows, 'energy').deltaTotal).toBeCloseTo(delta, 10);
    const row = byId(portfolioView(input).rows, 'energy');
    expect(row.pnl! / row.invested).toBeCloseTo(row.pnlPct!, 10);
  });
});

describe('a position bought back after the last snapshot', () => {
  // …8976 is sold out on 1 July and 5 units are bought back on the 30th, after the last
  // snapshot. Its stale 15-unit quote values none of them: a late buy waits for its day's quote.
  const base = ledger('sold-out');
  const input = {
    ...base,
    transactions: [
      ...base.transactions,
      {
        id: 'back',
        date: '2026-07-30',
        type: 'buy' as const,
        assetId: 'ovdp8976',
        amount: 5300,
        quantity: 5,
      },
    ],
  };

  it('counts none of the stale quote, on the sidebar and on Overview', () => {
    // sold-out's figures, less the 5 300 the buy took from cash.
    expect(capitalView(input).total).toBeCloseTo(149383.97 - 5300, 2);
    expect(capitalView(input).net.uah).toBeCloseTo(4820.22 - 5300, 2);
    expect(overviewView({ ...input, period: 'all' }).net.uah).toBeCloseTo(4820.22 - 5300, 2);
  });
});

describe("Portfolio's per-asset return is /yield's Δ at the full history", () => {
  it.each(['sold-and-unquoted', 'sold-out'])(
    '%s: every row, and the rows sum to the Total',
    (name) => {
      const input = ledger(name);
      const view = portfolioView(input);
      expect(view.rows.map((r) => [r.asset.id, r.pnlPct])).toStrictEqual(
        yieldView({ ...input, period: 'all' }).rows.map((r) => [r.asset.id, r.deltaTotal]),
      );
      // An unvalued position's row has no gain, while the Total counts what went into it as
      // spent: the seam `headlineTotalAsOf` documents. Neither ledger sells one.
      const gains = view.rows.reduce((sum, r) => sum + (r.pnl ?? -r.invested), 0);
      expect(gains).toBeCloseTo(view.totals.net.uah, 6);
    },
  );

  it("a row's gain counts the asset's proceeds", () => {
    const energy = byId(portfolioView(ledger('sold-and-unquoted')).rows, 'energy');
    expect(energy.pnl).toBeCloseTo(60_086.09 + 10_000 - 59_208, 6);
  });
});

describe('best performer and laggard rank on that return', () => {
  it('a sale counts, and an asset with no quote is not ranked', () => {
    // Energy +18,37 % with its proceeds; Fresh, unquoted, would otherwise rank at −100 %.
    const view = portfolioView(ledger('sold-and-unquoted'));
    const at = (id: string) => ({
      asset: expect.objectContaining({ id }),
      yield: byId(view.rows, id).pnlPct,
    });
    expect(view.best).toEqual(at('energy'));
    expect(view.worst).toEqual(at('ovdp8976'));
  });

  it('ranks nothing where nothing is quoted', () => {
    for (const name of ['empty', 'linked']) {
      const view = portfolioView(ledger(name));
      expect([view.best, view.worst]).toEqual([undefined, undefined]);
    }
  });
});
