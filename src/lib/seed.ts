// Reference seed dataset — pure data builders, no db access (*Derived figures and the seed*).
import type { Asset, Snapshot, Transaction } from '../core/types';

export const SEED_ASSETS: Asset[] = [
  {
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
  },
  {
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
  },
  {
    id: 'ovdp8976',
    name: 'OVDP UA4000238976',
    code: 'GB',
    colorKey: 'ovdp8976',
    yieldType: 'fixed_coupon',
    expectedPct: 16.4,
    targetPct: 17,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-02-05',
    createdAt: '2026-02-05T10:00:00',
    maturity: '2027-02-25',
    couponAmount: 1240,
    nextCoupon: '2026-08-25',
  },
  {
    id: 'ovdp6475',
    name: 'OVDP UA4000236475',
    code: 'GB',
    colorKey: 'ovdp6475',
    yieldType: 'fixed_coupon',
    expectedPct: 15.2,
    targetPct: 3,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-06-02',
    createdAt: '2026-06-02T10:00:00',
    maturity: '2027-05-27',
    couponAmount: 216,
    nextCoupon: '2026-12-03',
  },
];

// Deposits = own-funded buys + the ₴7,75 cash residue; the reference log's
// 12.05/648,13 dividend is seeded as 10.05/472,13, and a reinvest shares its
// source payout's date and asset so the Destination cells derive.
// p7 IS THE ONLY ROW THAT CAN CARRY A WITHHOLDING: it needs a dividend (ОВДП
// coupons are exempt), inside the 3-month window, with a reinvest payable out of
// the NET — p8's 687,02 exceeds what 700,36 less the rate leaves.
// The alignment is the fixture's point: at printWidth 100 only the three `deposit`
// rows fit on one line and every other row becomes a multi-line object, so scanning
// for a wrong amount would mean reading two layouts in one array.
// prettier-ignore
export const SEED_TRANSACTIONS: Transaction[] = [
  { id: 'd1', date: '2026-02-03', type: 'deposit', assetId: '', amount: 123844.37 },
  { id: 'd2', date: '2026-02-05', type: 'deposit', assetId: '', amount: 15390 },
  { id: 'd3', date: '2026-06-02', type: 'deposit', assetId: '', amount: 3942 },
  { id: 'b1', date: '2026-02-03', type: 'buy', assetId: 'reit', amount: 64628.62, quantity: 6164 },
  { id: 'b2', date: '2026-02-03', type: 'buy', assetId: 'energy', amount: 59208, quantity: 6000 },
  { id: 'b3', date: '2026-02-05', type: 'buy', assetId: 'ovdp8976', amount: 15390, quantity: 15 },
  { id: 'b4', date: '2026-06-02', type: 'buy', assetId: 'ovdp6475', amount: 3942, quantity: 4 },
  { id: 'p1', date: '2026-02-10', type: 'dividend_accrual', assetId: 'reit', amount: 580.2 },
  { id: 'p2', date: '2026-02-25', type: 'interest_payout', assetId: 'ovdp8976', amount: 1183.5 },
  { id: 'p3', date: '2026-03-10', type: 'dividend_accrual', assetId: 'reit', amount: 595.8 },
  { id: 'p4', date: '2026-04-10', type: 'dividend_accrual', assetId: 'reit', amount: 612.4 },
  { id: 'p5', date: '2026-05-10', type: 'dividend_accrual', assetId: 'reit', amount: 472.13 },
  { id: 'p6', date: '2026-06-03', type: 'interest_payout', assetId: 'ovdp6475', amount: 216 },
  { id: 'p7', date: '2026-06-10', type: 'dividend_accrual', assetId: 'reit', amount: 680.55, taxWithheld: 95.28 },
  { id: 'p8', date: '2026-07-10', type: 'dividend_accrual', assetId: 'reit', amount: 700.36 },
  { id: 'r1', date: '2026-06-03', type: 'reinvest', assetId: 'ovdp6475', amount: 216, quantity: 0.2192 },
  { id: 'r2', date: '2026-06-10', type: 'reinvest', assetId: 'reit', amount: 484.36, quantity: 43.4835 },
  { id: 'r3', date: '2026-07-10', type: 'reinvest', assetId: 'reit', amount: 687.02, quantity: 61.6161 },
];

const DAY = 86_400_000;
const CASH = 7.75;
const PIN_START = '2026-07-21';

// Verbatim from the Balances table in `design/Investment Tracker.dc.html`.
const PINNED: Record<string, Record<string, number>> = {
  '2026-07-21': { reit: 68450.12, energy: 59980.44, ovdp8976: 15830.1, ovdp6475: 4368.9 },
  '2026-07-22': { reit: 68478.03, energy: 60001.12, ovdp8976: 15833.35, ovdp6475: 4370.02 },
  '2026-07-23': { reit: 68502.55, energy: 60022.61, ovdp8976: 15836.6, ovdp6475: 4371.15 },
  '2026-07-24': { reit: 68560.9, energy: 60050.87, ovdp8976: 15841.44, ovdp6475: 4372.6 },
  '2026-07-25': { reit: 68629.36, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 },
};

const PATHS: {
  id: string;
  from: string;
  start: number;
  end: number;
  phase: number;
  bumps: { date: string; amount: number }[];
}[] = [
  {
    id: 'reit',
    from: '2026-02-03',
    start: 64628.62,
    end: 67278.74,
    phase: 0.7,
    bumps: [
      { date: '2026-06-10', amount: 484.36 },
      { date: '2026-07-10', amount: 687.02 },
    ],
  },
  { id: 'energy', from: '2026-02-03', start: 59208, end: 59980.44, phase: 2.1, bumps: [] },
  { id: 'ovdp8976', from: '2026-02-05', start: 15390, end: 15830.1, phase: 3.6, bumps: [] },
  {
    id: 'ovdp6475',
    from: '2026-06-02',
    start: 3942,
    end: 4152.9,
    phase: 5.0,
    bumps: [{ date: '2026-06-03', amount: 216 }],
  },
];

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

function pathQuote(p: (typeof PATHS)[number], date: string): number | undefined {
  const t0 = utc(p.from);
  const d = utc(date);
  if (d < t0) return undefined;
  const t = Math.min(1, (d - t0) / (utc(PIN_START) - t0));
  const amp = 0.12 * (p.end - p.start);
  const wiggle = amp * Math.sin(2 * Math.PI * 1.5 * t + p.phase) * Math.sin(Math.PI * t);
  const bumps = p.bumps.reduce((sum, b) => (d >= utc(b.date) ? sum + b.amount : sum), 0);
  return round2(p.start + (p.end - p.start) * t + wiggle + bumps);
}

export function buildSeedSnapshots(): Snapshot[] {
  const out: Snapshot[] = [];
  for (let ms = utc('2026-02-03'); ms <= utc('2026-07-25'); ms += DAY) {
    const date = isoOf(ms);
    const quotes: Record<string, number> = {};
    for (const p of PATHS) {
      const q = PINNED[date]?.[p.id] ?? pathQuote(p, date);
      if (q !== undefined) quotes[p.id] = q;
    }
    out.push(
      date === '2026-07-25'
        ? { date, quotes, cash: CASH, savedAt: '2026-07-25T21:14:00' }
        : { date, quotes, cash: CASH },
    );
  }
  out.push({ date: '2026-07-27', quotes: { reit: 68702.1 }, cash: CASH });
  return out;
}
