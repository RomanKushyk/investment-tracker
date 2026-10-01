import { describe, expect, it } from 'vitest';

import { attributesView } from './attributes';
import { overviewView } from './overview';
import { portfolioView } from './portfolio';
import { TEST_LEDGERS } from './test-ledgers';
import { yieldView } from './yield';

// Figures that disagree with core moved unchanged; each pin names the issue that changes it.
// The ledger sells 1 000 of energy's 6 000 units and holds an asset no snapshot quotes.
const input = TEST_LEDGERS.find((l) => l.name === 'sold-and-unquoted')!.input;
const all = { ...input, period: 'all' as const };
const row = <T extends { asset: { id: string } }>(rows: T[], id: string) =>
  rows.find((r) => r.asset.id === id)!;

describe('#288 — two returns that drop the sale proceeds /yield adds', () => {
  it("#288: Overview's per-asset yield omits the sold amount", () => {
    expect(row(overviewView(all).rows, 'energy').yield).toBe(0.0148305972165923);
    expect(row(yieldView(all).rows, 'energy').deltaTotal).toBe(0.18372669233887318);
  });

  it('#288: Overview reads an unquoted asset as −100 %, where /yield reads nothing', () => {
    expect(row(overviewView(all).rows, 'fresh').yield).toBe(-1);
    expect(row(yieldView(all).rows, 'fresh').deltaTotal).toBeUndefined();
  });

  it("#288: Attributes' annualized return omits the sold amount", () => {
    const card = attributesView(input).cards.find((c) => c.asset.id === 'energy')!;
    expect(card.kind === 'market' && card.actualAnnualized).toBe(0.03111016082790914);
    expect(row(yieldView(all).rows, 'energy').annualized).toBe(0.38540369369936045);
  });
});

describe('#323 — Portfolio drops the proceeds per asset that its Total row adds', () => {
  it("#323: a row's gain and return omit the sold amount", () => {
    const energy = row(portfolioView(input).rows, 'energy');
    expect(energy.pnl).toBe(878.0899999999965);
    expect(energy.pnlPct).toBe(0.0148305972165923);
  });

  it('#323: the laggard is the unquoted asset, at −100 %', () => {
    expect(portfolioView(input).worst).toEqual({
      asset: expect.objectContaining({ id: 'fresh' }),
      yield: -1,
    });
  });
});
