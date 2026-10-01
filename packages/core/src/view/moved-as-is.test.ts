import { describe, expect, it } from 'vitest';

import { portfolioView } from './portfolio';
import { TEST_LEDGERS } from './test-ledgers';

// Figures that disagree with core moved unchanged; each pin names the issue that changes it.
// The ledger sells 1 000 of energy's 6 000 units and holds an asset no snapshot quotes.
const input = TEST_LEDGERS.find((l) => l.name === 'sold-and-unquoted')!.input;
const row = <T extends { asset: { id: string } }>(rows: T[], id: string) =>
  rows.find((r) => r.asset.id === id)!;

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
