import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS } from '../../lib/seed';
import {
  balanceChartData,
  buildBalanceRow,
  completeSnapshots,
  paginateSnapshots,
} from './balances';

const snaps = buildSeedSnapshots();

describe('completeSnapshots', () => {
  it('excludes the partial 27.07 row, keeps all 173 daily rows', () => {
    const complete = completeSnapshots(snaps, SEED_ASSETS);
    expect(complete).toHaveLength(173);
    expect(complete.some((s) => s.date === '2026-07-27')).toBe(false);
    expect(complete[complete.length - 1].date).toBe('2026-07-25');
    expect(complete[0].date).toBe('2026-02-03');
  });

  it('does not require a quote for an asset not yet purchased', () => {
    const feb = snaps.find((s) => s.date === '2026-02-10')!; // before ovdp6475 exists
    expect(completeSnapshots([feb], SEED_ASSETS)).toEqual([feb]);
  });
});

describe('balanceChartData', () => {
  it('maps complete snapshots to {date, total}, ascending', () => {
    const data = balanceChartData(snaps, SEED_ASSETS);
    expect(data).toHaveLength(173);
    expect(data[0].date).toBe('2026-02-03');
    const last = data[data.length - 1];
    expect(last.date).toBe('2026-07-25');
    expect(last.total).toBeCloseTo(148943.62, 2);
  });
});

describe('buildBalanceRow', () => {
  it('27.07: REIT value, 3 pending cells, total null (design "—")', () => {
    const row = buildBalanceRow(snaps[snaps.length - 1], SEED_ASSETS);
    expect(row.cells[0]).toEqual({ status: 'value', amount: 68702.1 });
    expect(row.cells[1]).toEqual({ status: 'pending' });
    expect(row.cells[2]).toEqual({ status: 'pending' });
    expect(row.cells[3]).toEqual({ status: 'pending' });
    expect(row.total).toBeNull();
  });

  it('25.07: all values present, total 148 943,62', () => {
    const row = buildBalanceRow(
      snaps.find((s) => s.date === '2026-07-25')!,
      SEED_ASSETS,
    );
    expect(row.cells.every((c) => c.status === 'value')).toBe(true);
    expect(row.total).toBeCloseTo(148943.62, 2);
  });

  it('an asset not yet purchased renders "none", not "pending"', () => {
    const row = buildBalanceRow(
      snaps.find((s) => s.date === '2026-02-10')!,
      SEED_ASSETS,
    );
    expect(row.cells[3]).toEqual({ status: 'none' }); // ovdp6475 doesn't exist until 02.06
  });
});

describe('paginateSnapshots', () => {
  it('page 0 = newest 6 rows: 27.07 down to 21.07, newest first', () => {
    const { rows, total, totalPages } = paginateSnapshots(snaps, 0);
    expect(rows.map((s) => s.date)).toEqual([
      '2026-07-27',
      '2026-07-25',
      '2026-07-24',
      '2026-07-23',
      '2026-07-22',
      '2026-07-21',
    ]);
    expect(total).toBe(174);
    expect(totalPages).toBe(29); // ceil(174/6)
  });

  it('clamps page to valid range', () => {
    expect(paginateSnapshots(snaps, -5).page).toBe(0);
    expect(paginateSnapshots(snaps, 999).page).toBe(28);
  });

  it('last page has the remaining rows ending at the oldest = 03.02', () => {
    const { rows } = paginateSnapshots(snaps, 28);
    expect(rows[rows.length - 1].date).toBe('2026-02-03');
  });
});
