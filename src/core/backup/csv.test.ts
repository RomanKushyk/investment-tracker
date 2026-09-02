import { describe, expect, it } from 'vitest';

import {
  ASSET_CSV_COLUMNS,
  CSV_BOM,
  CSV_EOL,
  serializeAssetsCsv,
  serializeSnapshotsCsv,
  serializeTransactionsCsv,
  snapshotColumnHeader,
  TRANSACTION_CSV_COLUMNS,
} from './csv';
import type { Asset, Snapshot, Transaction } from '../types';

const REIT: Asset = {
  id: 'reit',
  name: 'Inzhur REIT',
  code: 'RE',
  colorKey: 'reit',
  yieldType: 'div_cap',
  expectedPct: 14,
  targetPct: 40,
  payoutSchedule: 'monthly',
  firstPurchase: '2026-02-03',
  createdAt: '2026-02-03T10:00:00',
  reinvestPolicy: 'Auto (dividends)',
};

const ENERGY: Asset = {
  id: 'energy',
  name: 'Inzhur Energy',
  code: 'EN',
  colorKey: 'energy',
  yieldType: 'capitalization',
  expectedPct: 10,
  targetPct: 40,
  payoutSchedule: 'none',
  firstPurchase: '2026-02-03',
  createdAt: '2026-02-03T10:00:01',
};

const ASSETS = [REIT, ENERGY];

// The 25.07 complete day + the PARTIAL 27.07 one (D5#1: Energy is pending
// there, and pending is never zero).
const SNAPSHOTS: Snapshot[] = [
  { date: '2026-07-25', quotes: { reit: 68629.36, energy: 60086.09 }, cash: 7.75 },
  { date: '2026-07-27', quotes: { reit: 68702.1 }, cash: 7.75, savedAt: '2026-07-27T21:14:00' },
];

function lines(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  expect(csv.endsWith(CSV_EOL)).toBe(true);
  return csv.slice(CSV_BOM.length).split(CSV_EOL).slice(0, -1);
}

/** A minimal RFC 4180 reader — the tests must not trust the writer's own rules. */
function readCsv(csv: string): string[][] {
  const text = csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv;
  const rows: string[][] = [[]];
  let field = '';
  let quoted = false;
  let i = 0;
  const push = () => {
    rows[rows.length - 1].push(field);
    field = '';
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      push();
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      push();
      rows.push([]);
      i += 2;
      continue;
    }
    field += ch;
    i += 1;
  }
  push();
  if (rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop();
  return rows;
}

describe('the CSV dialect (RFC 4180)', () => {
  it('prefixes a UTF-8 BOM and separates every record with CRLF', () => {
    const csv = serializeSnapshotsCsv(SNAPSHOTS, ASSETS);
    expect(csv.codePointAt(0)).toBe(0xfeff);
    expect(csv).toContain(CSV_EOL);
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n'); // never a bare LF
    expect(lines(csv)).toHaveLength(3); // header + 2 dates
  });

  it('quotes a field containing a comma, doubles inner quotes, and keeps a newline inside quotes', () => {
    const tricky: Asset = {
      ...REIT,
      id: 'tricky',
      name: 'Fund, Inc.',
      reinvestPolicy: 'Auto "always"\nevery month',
    };
    const csv = serializeAssetsCsv([tricky]);
    expect(csv).toContain('"Fund, Inc."');
    expect(csv).toContain('"Auto ""always""\nevery month"');
    // A quoted newline must NOT end the record: two lines, not three.
    const rows = readCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('Fund, Inc.');
    expect(rows[1][13]).toBe('Auto "always"\nevery month');
  });

  it('writes dot decimals with no thousands grouping and no currency symbol', () => {
    const csv = serializeSnapshotsCsv(SNAPSHOTS, ASSETS);
    expect(csv).toContain('2026-07-25,7.75,68629.36,60086.09');
    expect(csv).not.toContain('₴');
    expect(csv).not.toContain(' 702'); // no space thousands
    expect(csv).not.toContain('702,10'); // no comma decimals
  });

  it('pads money to 2 decimals but never loses precision beyond them', () => {
    const csv = serializeSnapshotsCsv(
      [{ date: '2026-08-01', quotes: { reit: 1, energy: 2.005 }, cash: 0 }],
      ASSETS,
    );
    expect(lines(csv)[1]).toBe('2026-08-01,0.00,1.00,2.005');
  });

  it('writes quantities and percentages as they are', () => {
    const linked: Asset = {
      ...REIT,
      expectedPct: 16.4,
      inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 6164 },
    };
    const row = readCsv(serializeAssetsCsv([linked]))[1];
    expect(row[5]).toBe('16.4');
    expect(row[16]).toBe('6164');
  });
});

describe('column orders (pinned contract)', () => {
  it('assets serialize LONG in the pinned order, optional fields as empty cells', () => {
    const rows = readCsv(serializeAssetsCsv(ASSETS));
    expect(rows[0]).toEqual([...ASSET_CSV_COLUMNS]);
    expect(rows[1]).toEqual([
      'reit',
      'Inzhur REIT',
      'RE',
      'reit',
      'div_cap',
      '14',
      '40',
      'monthly',
      '2026-02-03',
      '2026-02-03T10:00:00',
      '',
      '',
      '',
      'Auto (dividends)',
      '',
      '',
      '',
      // `couponRatePct`, APPENDED after `inzhurUnits` (D119) — the legacy
      // `couponAmount` column keeps its place further up so an existing
      // spreadsheet's formulas hold.
      '',
    ]);
  });

  it('carries the coupon RATE, appended after the legacy columns (D119)', () => {
    const [, row] = readCsv(
      serializeAssetsCsv([{ ...ASSETS[0], yieldType: 'fixed_coupon', couponRatePct: 15.68 }]),
    );
    expect(row.at(-1)).toBe('15.68');
    // `plain`, not `money`: a rate is a percentage, and padding 15.68 to two
    // decimals is right by luck here and wrong for 16.
    expect(readCsv(serializeAssetsCsv([{ ...ASSETS[0], couponRatePct: 16 }]))[1].at(-1)).toBe('16');
  });

  it('transactions serialize LONG in the pinned order', () => {
    const tx: Transaction = {
      id: 'tx-0001',
      date: '2026-02-03',
      type: 'deposit',
      assetId: '',
      amount: 143176.37,
      source: 'own',
    };
    const rows = readCsv(serializeTransactionsCsv([tx]));
    expect(rows[0]).toEqual([...TRANSACTION_CSV_COLUMNS]);
    // A deposit moves no position, so both #31 columns are EMPTY — never 0,
    // which would read as "zero units bought" rather than "not applicable".
    expect(rows[1]).toEqual(['tx-0001', '2026-02-03', 'deposit', '', '143176.37', 'own', '', '']);
  });

  it('carries units and the per-unit price, unrounded (#31)', () => {
    const tx: Transaction = {
      id: 'tx-0002',
      date: '2026-08-10',
      type: 'reinvest',
      assetId: 'reit',
      amount: 484.36,
      source: 'reinvest_reit',
      quantity: 43.4785,
      unitPrice: 11.1389,
    };
    const [, row] = readCsv(serializeTransactionsCsv([tx]));
    // `money()` on the amount, `plain()` on both counts: a reinvestment buys a
    // fractional number of units, and padding that to two decimals in the one
    // column whose purpose is exactness is how a unit total drifts.
    expect(row).toEqual([
      'tx-0002',
      '2026-08-10',
      'reinvest',
      'reit',
      '484.36',
      'reinvest_reit',
      '43.4785',
      '11.1389',
    ]);
  });

  it('snapshots serialize WIDE: date, cash, then one column per asset', () => {
    const rows = readCsv(serializeSnapshotsCsv(SNAPSHOTS, ASSETS));
    expect(rows[0]).toEqual(['date', 'cash', 'Inzhur REIT (reit)', 'Inzhur Energy (energy)']);
    expect(snapshotColumnHeader(ENERGY)).toBe('Inzhur Energy (energy)');
  });

  it('an empty table exports a header-only file', () => {
    expect(lines(serializeAssetsCsv([]))).toEqual([ASSET_CSV_COLUMNS.join(',')]);
    expect(lines(serializeSnapshotsCsv([], []))).toEqual(['date,cash']);
  });
});

describe('empty cell = pending, never 0', () => {
  it('writes an EMPTY cell for a pending quote and 0.00 for a real zero', () => {
    const csv = serializeSnapshotsCsv(
      [
        { date: '2026-07-27', quotes: { reit: 68702.1 }, cash: 7.75 },
        { date: '2026-07-28', quotes: { reit: 68702.1, energy: 0 }, cash: 7.75 },
      ],
      ASSETS,
    );
    expect(lines(csv)[1]).toBe('2026-07-27,7.75,68702.10,'); // pending → empty
    expect(lines(csv)[2]).toBe('2026-07-28,7.75,68702.10,0.00'); // zero → 0.00
  });
});
