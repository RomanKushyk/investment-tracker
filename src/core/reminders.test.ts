import { describe, expect, it } from 'vitest';

import { couponReminderId } from './accrual';
import {
  computeReminders,
  couponOverdueReminderId,
  DEFAULT_LEAD_DAYS,
  MATURITY_LEAD_DAYS,
  maturityReminderId,
  quoteMissingReminderId,
} from './reminders';
import type { Asset, Snapshot, Transaction } from './types';

// Fixture basis = the demo seed (lib/seed.ts): …8976 pays 1 240,00 semiannually
// with nextCoupon 25.08.2026 and maturity 25.02.2027.
function bond(over: Partial<Asset> = {}): Asset {
  return {
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
    ...over,
  };
}

function fund(over: Partial<Asset> = {}): Asset {
  return {
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
    ...over,
  };
}

function snapshot(date: string, quotes: Record<string, number>): Snapshot {
  return { date, quotes, cash: 7.75 };
}

function payout(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: '2026-08-25',
    type: 'interest_payout',
    assetId: 'ovdp8976',
    amount: 1240,
    source: 'accrual',
    ...over,
  };
}

const TODAY = '2026-08-04';

describe('quote-missing', () => {
  it('fires when the day has no snapshot at all', () => {
    const r = computeReminders([fund()], [snapshot('2026-08-03', { reit: 68702.1 })], [], TODAY);
    expect(r).toEqual([
      {
        id: 'quote-missing:2026-08-04',
        kind: 'quote-missing',
        severity: 'warn',
        date: TODAY,
        days: 0,
      },
    ]);
  });

  // The plan's explicit Verify item: an asset with no quote key is PENDING, not
  // 0 (D5#1) — so a partial day is still an unfinished ritual.
  it('fires on a PARTIAL snapshot missing some assets', () => {
    const assets = [fund(), fund({ id: 'energy', name: 'Inzhur Energy', code: 'EN' })];
    const partial = [snapshot(TODAY, { reit: 68702.1 })];
    expect(computeReminders(assets, partial, [], TODAY).map((r) => r.kind)).toEqual([
      'quote-missing',
    ]);
  });

  it('is silent once every asset is quoted for the day', () => {
    const assets = [fund(), fund({ id: 'energy', name: 'Inzhur Energy', code: 'EN' })];
    const complete = [snapshot(TODAY, { reit: 68702.1, energy: 60086.09 })];
    expect(computeReminders(assets, complete, [], TODAY)).toEqual([]);
  });

  it('is silent with no assets — nothing to quote', () => {
    expect(computeReminders([], [], [], TODAY)).toEqual([]);
  });
});

describe('coupon lead-day boundaries', () => {
  const quoted = [snapshot(TODAY, { ovdp8976: 15846.3 })];

  it('announces a coupon exactly `leadDays` away and not one day further', () => {
    // nextCoupon 11.08.2026 is exactly 7 days after 04.08.2026.
    const atBoundary = computeReminders([bond({ nextCoupon: '2026-08-11' })], quoted, [], TODAY, {
      leadDays: DEFAULT_LEAD_DAYS,
    });
    expect(atBoundary).toEqual([
      {
        id: 'coupon:ovdp8976:2026-08-11',
        kind: 'coupon',
        severity: 'info',
        date: '2026-08-11',
        days: 7,
        assetId: 'ovdp8976',
      },
    ]);

    const pastBoundary = computeReminders([bond({ nextCoupon: '2026-08-12' })], quoted, [], TODAY, {
      leadDays: DEFAULT_LEAD_DAYS,
    });
    expect(pastBoundary).toEqual([]);
  });

  it('defaults to a 7-day lead when no option is given', () => {
    expect(computeReminders([bond({ nextCoupon: '2026-08-11' })], quoted, [], TODAY)).toHaveLength(1);
    expect(computeReminders([bond({ nextCoupon: '2026-08-12' })], quoted, [], TODAY)).toEqual([]);
  });

  // The S8 field re-windows the banners immediately (no reload) — the seed's
  // real 25.08 coupon is 21 days out, so it appears only from leadDays 21 on.
  it('re-windows with a wider lead time', () => {
    expect(computeReminders([bond()], quoted, [], TODAY, { leadDays: 20 })).toEqual([]);
    expect(computeReminders([bond()], quoted, [], TODAY, { leadDays: 21 })).toHaveLength(1);
  });
});

describe('upcoming → overdue transition', () => {
  const quoted = (date: string) => [snapshot(date, { ovdp8976: 15846.3 })];

  it('flips kind, severity and id the day the coupon arrives', () => {
    const asset = bond({ nextCoupon: '2026-08-05' });

    const [upcoming] = computeReminders([asset], quoted('2026-08-04'), [], '2026-08-04');
    expect(upcoming.kind).toBe('coupon');
    expect(upcoming.severity).toBe('info');
    expect(upcoming.id).toBe('coupon:ovdp8976:2026-08-05');
    expect(upcoming.days).toBe(1);

    const [dueToday] = computeReminders([asset], quoted('2026-08-05'), [], '2026-08-05');
    expect(dueToday.kind).toBe('coupon-overdue');
    expect(dueToday.severity).toBe('overdue');
    expect(dueToday.id).toBe('coupon-overdue:ovdp8976:2026-08-05');
    expect(dueToday.days).toBe(0);

    const [overdue] = computeReminders([asset], quoted('2026-08-09'), [], '2026-08-09');
    expect(overdue.kind).toBe('coupon-overdue');
    expect(overdue.days).toBe(-4);
  });

  // An overdue coupon is announced however long ago it was due — the lead time
  // windows the FUTURE only.
  it('keeps announcing an old unrecorded coupon regardless of lead days', () => {
    const r = computeReminders([bond({ nextCoupon: '2026-05-25' })], quoted(TODAY), [], TODAY, {
      leadDays: 1,
    });
    expect(r.map((x) => x.kind)).toEqual(['coupon-overdue']);
  });
});

describe('coupon dedupe against recorded payouts (S5 rule, ±7 days)', () => {
  const quoted = [snapshot(TODAY, { ovdp8976: 15846.3 })];

  it('drops an overdue coupon whose payout is already recorded', () => {
    const asset = bond({ nextCoupon: '2026-07-25' });
    expect(computeReminders([asset], quoted, [], TODAY)).toHaveLength(1);
    expect(
      computeReminders([asset], quoted, [payout({ date: '2026-07-27' })], TODAY),
    ).toEqual([]);
    // Outside the ±7-day window the payout belongs to another occurrence.
    expect(
      computeReminders([asset], quoted, [payout({ date: '2026-07-10' })], TODAY),
    ).toHaveLength(1);
  });

  it('drops an upcoming coupon recorded early', () => {
    const asset = bond({ nextCoupon: '2026-08-08' });
    expect(computeReminders([asset], quoted, [], TODAY)).toHaveLength(1);
    expect(computeReminders([asset], quoted, [payout({ date: '2026-08-03' })], TODAY)).toEqual([]);
  });

  it('ignores payouts of other assets and other transaction types', () => {
    const asset = bond({ nextCoupon: '2026-07-25' });
    const other = [
      payout({ date: '2026-07-25', assetId: 'ovdp6475' }),
      payout({ date: '2026-07-25', type: 'dividend_accrual' }),
    ];
    expect(computeReminders([asset], quoted, other, TODAY)).toHaveLength(1);
  });
});

describe('maturity window', () => {
  const quoted = [snapshot(TODAY, { ovdp8976: 15846.3 })];

  it('announces a maturity inside 30 days, including the boundary and today', () => {
    const inside = computeReminders(
      [bond({ nextCoupon: undefined, maturity: '2026-09-03' })],
      quoted,
      [],
      TODAY,
    );
    expect(inside).toEqual([
      {
        id: 'maturity:ovdp8976:2026-09-03',
        kind: 'maturity',
        severity: 'info',
        date: '2026-09-03',
        days: MATURITY_LEAD_DAYS,
        assetId: 'ovdp8976',
      },
    ]);

    const today = computeReminders(
      [bond({ nextCoupon: undefined, maturity: TODAY })],
      quoted,
      [],
      TODAY,
    );
    expect(today.map((r) => r.days)).toEqual([0]);
  });

  it('stays silent one day outside the window and after maturity', () => {
    expect(
      computeReminders([bond({ nextCoupon: undefined, maturity: '2026-09-04' })], quoted, [], TODAY),
    ).toEqual([]);
    expect(
      computeReminders([bond({ nextCoupon: undefined, maturity: '2026-08-03' })], quoted, [], TODAY),
    ).toEqual([]);
  });

  it('is independent of the coupon reminder — both can fire for one asset', () => {
    const asset = bond({ nextCoupon: '2026-08-06', maturity: '2026-08-06' });
    expect(computeReminders([asset], quoted, [], TODAY).map((r) => r.kind)).toEqual([
      'coupon',
      'maturity',
    ]);
  });
});

describe('dismissal filtering', () => {
  const quoted = [snapshot(TODAY, { ovdp8976: 15846.3 })];

  it('hides a reminder whose derived id is dismissed', () => {
    const assets = [bond({ nextCoupon: '2026-08-06' })];
    const id = couponReminderId('ovdp8976', '2026-08-06');
    expect(computeReminders(assets, quoted, [], TODAY, { dismissed: [id] })).toEqual([]);
    // …and leaves every other reminder alone.
    expect(
      computeReminders(assets, [], [], TODAY, { dismissed: [id] }).map((r) => r.kind),
    ).toEqual(['quote-missing']);
  });

  it('hides the quote-missing banner for the dismissed DATE only', () => {
    const assets = [fund()];
    const dismissed = [quoteMissingReminderId(TODAY)];
    expect(computeReminders(assets, [], [], TODAY, { dismissed })).toEqual([]);
    // Tomorrow is a new occurrence — a new id, so the dismissal expired.
    expect(computeReminders(assets, [], [], '2026-08-05', { dismissed })).toHaveLength(1);
  });

  it('lets an S5 card skip silence its own overdue banner (D21 shared id)', () => {
    const assets = [bond({ nextCoupon: '2026-07-25' })];
    const skipped = [couponReminderId('ovdp8976', '2026-07-25')];
    expect(computeReminders(assets, quoted, [], TODAY, { dismissed: skipped })).toEqual([]);
  });

  it('does not let an overdue-banner dismissal leak to other occurrences', () => {
    const assets = [bond({ nextCoupon: '2026-07-25' })];
    const dismissed = [couponOverdueReminderId('ovdp8976', '2026-07-25')];
    expect(computeReminders(assets, quoted, [], TODAY, { dismissed })).toEqual([]);
    // The NEXT coupon date is a different id — still announced.
    expect(
      computeReminders([bond({ nextCoupon: '2026-08-06' })], quoted, [], TODAY, { dismissed }),
    ).toHaveLength(1);
  });

  it('ignores dismissals of ids nothing produces', () => {
    expect(
      computeReminders([fund()], [], [], TODAY, { dismissed: ['coupon:ghost:2020-01-01'] }),
    ).toHaveLength(1);
  });
});

describe('derived-id stability', () => {
  // The dismissal contract: the SAME occurrence keeps its id on every later
  // day (so a dismissal holds), and only the day count moves.
  it('keeps a coupon id stable across days while the occurrence stands', () => {
    const asset = bond({ nextCoupon: '2026-08-06' });
    const quotedOn = (d: string) => [snapshot(d, { ovdp8976: 15846.3 })];
    const ids = ['2026-08-01', '2026-08-04', '2026-08-05'].map(
      (d) => computeReminders([asset], quotedOn(d), [], d, { leadDays: 30 })[0].id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('coupon:ovdp8976:2026-08-06');
  });

  it('keeps a maturity id stable across days', () => {
    const asset = bond({ nextCoupon: undefined, maturity: '2026-08-20' });
    const quotedOn = (d: string) => [snapshot(d, { ovdp8976: 15846.3 })];
    const ids = ['2026-07-25', '2026-08-04', '2026-08-19'].map(
      (d) => computeReminders([asset], quotedOn(d), [], d)[0].id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(maturityReminderId('ovdp8976', '2026-08-20'));
  });

  it('gives the next occurrence a different id (a dismissal never leaks forward)', () => {
    const first = couponReminderId('ovdp8976', '2026-08-25');
    const next = couponReminderId('ovdp8976', '2027-02-25');
    expect(first).not.toBe(next);
  });
});

describe('ordering', () => {
  it('sorts overdue → warn → info, by date inside a severity', () => {
    const assets = [
      bond({ id: 'a', nextCoupon: '2026-07-25' }), // overdue, older
      bond({ id: 'b', nextCoupon: '2026-08-01' }), // overdue, newer
      bond({ id: 'c', nextCoupon: '2026-08-09', maturity: '2026-08-20' }), // info coupon + info maturity
      fund({ id: 'd' }), // makes the day partial → warn
    ];
    const r = computeReminders(assets, [], [], TODAY, { leadDays: 7 });
    expect(r.map((x) => `${x.kind}:${x.date}`)).toEqual([
      'coupon-overdue:2026-07-25',
      'coupon-overdue:2026-08-01',
      'quote-missing:2026-08-04',
      'coupon:2026-08-09',
      'maturity:2026-08-20',
    ]);
  });
});

describe('the demo seed on 04.08.2026', () => {
  // navigation-map checkpoint: the seed's newest snapshot is the partial 27.07,
  // so today has none → exactly one warn banner; both coupons (25.08 / 03.12)
  // and both maturities (25.02.2027 / 27.05.2027) are far outside their windows.
  it('produces exactly the quote-missing banner', () => {
    const assets = [
      fund(),
      fund({ id: 'energy', name: 'Inzhur Energy', code: 'EN', yieldType: 'capitalization' }),
      bond(),
      bond({
        id: 'ovdp6475',
        name: 'OVDP UA4000236475',
        nextCoupon: '2026-12-03',
        maturity: '2027-05-27',
        couponAmount: 216,
      }),
    ];
    const snapshots = [snapshot('2026-07-27', { reit: 68702.1 })];
    expect(computeReminders(assets, snapshots, [], TODAY).map((r) => r.id)).toEqual([
      'quote-missing:2026-08-04',
    ]);
  });
});
