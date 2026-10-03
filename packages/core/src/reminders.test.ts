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
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from './seed';
import type { Asset, Snapshot, Transaction } from './types';

// Fixture basis = the demo seed (seed.ts): …8976 pays 1 240,00 semiannually
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
  return { date, quotes };
}

function payout(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: '2026-08-25',
    type: 'interest_payout',
    assetId: 'ovdp8976',
    amount: 1240,
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

  // The plan's explicit Verify item: an asset with no quote key is PENDING, not 0 —
  // so a partial day is still an unfinished ritual.
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
    expect(computeReminders([bond({ nextCoupon: '2026-08-11' })], quoted, [], TODAY)).toHaveLength(
      1,
    );
    expect(computeReminders([bond({ nextCoupon: '2026-08-12' })], quoted, [], TODAY)).toEqual([]);
  });

  // The S8 field re-windows the banners immediately (no reload) — the seed’s real
  // 25.08 coupon is 21 days out, so it appears only from leadDays 21 on.
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
    expect(computeReminders([asset], quoted, [payout({ date: '2026-07-27' })], TODAY)).toEqual([]);
    // Outside the ±7-day window the payout belongs to another occurrence.
    expect(computeReminders([asset], quoted, [payout({ date: '2026-07-10' })], TODAY)).toHaveLength(
      1,
    );
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

  // The dedupe used to read `asset.nextCoupon` alone, and that field only moves
  // through the S5 confirm — so a coupon recorded by hand silenced every LATER
  // occurrence of that bond too, forever.
  it('announces the next occurrence once the pointer one is settled', () => {
    const asset = bond({ nextCoupon: '2026-07-25' }); // recorded by hand on the day
    const recorded = [payout({ date: '2026-07-25' })];
    // 182 days on, 2027-01-23 is the next date: silent now, announced inside its lead window.
    expect(computeReminders([asset], quoted, recorded, TODAY)).toEqual([]);
    const later = computeReminders(
      [asset],
      [snapshot('2027-01-20', { ovdp8976: 15846.3 })],
      recorded,
      '2027-01-20',
    );
    expect(later.map((r) => r.id)).toEqual(['coupon:ovdp8976:2027-01-23']);
  });

  it('announces the next occurrence after a skip (S5 → S6 hand-over)', () => {
    const asset = bond({ nextCoupon: '2026-07-25' });
    const skipped = { dismissed: [couponReminderId('ovdp8976', '2026-07-25')] };
    expect(computeReminders([asset], quoted, [], TODAY, skipped)).toEqual([]);
    const later = computeReminders(
      [asset],
      [snapshot('2027-01-20', { ovdp8976: 15846.3 })],
      [],
      '2027-01-20',
      skipped,
    );
    expect(later.map((r) => r.id)).toEqual(['coupon:ovdp8976:2027-01-23']);
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
      computeReminders(
        [bond({ nextCoupon: undefined, maturity: '2026-09-04' })],
        quoted,
        [],
        TODAY,
      ),
    ).toEqual([]);
    expect(
      computeReminders(
        [bond({ nextCoupon: undefined, maturity: '2026-08-03' })],
        quoted,
        [],
        TODAY,
      ),
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
    expect(computeReminders(assets, [], [], TODAY, { dismissed: [id] }).map((r) => r.kind)).toEqual(
      ['quote-missing'],
    );
  });

  it('hides the quote-missing banner for the dismissed DATE only', () => {
    const assets = [fund()];
    const dismissed = [quoteMissingReminderId(TODAY)];
    expect(computeReminders(assets, [], [], TODAY, { dismissed })).toEqual([]);
    // Tomorrow is a new occurrence — a new id, so the dismissal expired.
    expect(computeReminders(assets, [], [], '2026-08-05', { dismissed })).toHaveLength(1);
  });

  it('lets an S5 card skip silence its own overdue banner (shared id)', () => {
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
  // The dismissal contract: the SAME occurrence keeps its id on every later day, so
  // a dismissal holds and only the day count moves.
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
  // navigation-map checkpoint: the seed's newest snapshot is the partial 27.07, so
  // today has none → one warn banner; both coupons and both maturities are outside
  // their windows.
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

// The rule Balances reads a snapshot as complete by: an asset needs a quote on a date while the
// ledger holds units of it, or, where the ledger cannot count them, from its first purchase on.
describe('quote-missing asks only for an asset that needs a quote that day', () => {
  const DAY = '2026-07-28';
  const seedSnaps = buildSeedSnapshots();
  const sale: Transaction = {
    id: 's2',
    date: '2026-07-01',
    type: 'sell',
    assetId: 'ovdp8976',
    amount: 15800,
    quantity: 15,
  };
  const heldThree = { reit: 68702.1, energy: 60086.09, ovdp6475: 4374.12 };
  const quoteMissing = (assets: Asset[], snaps: Snapshot[], txs: Transaction[], today = DAY) =>
    computeReminders(assets, snaps, txs, today)
      .filter((r) => r.kind === 'quote-missing')
      .map((r) => r.id);

  it('is silent after a sell-out once every position still held is quoted', () => {
    const snaps = [...seedSnaps, snapshot(DAY, heldThree)];
    expect(quoteMissing(SEED_ASSETS, snaps, [...SEED_TRANSACTIONS, sale])).toEqual([]);
  });

  it('does not ask for an asset with no ledger row whose first purchase is still ahead', () => {
    const ahead = fund({
      id: 'fresh',
      name: 'Fresh fund',
      code: 'FR',
      firstPurchase: '2026-08-15',
    });
    const allFour = { ...heldThree, ovdp8976: 15846.3 };
    const assets = [...SEED_ASSETS, ahead];
    expect(quoteMissing(assets, [...seedSnaps, snapshot(DAY, allFour)], SEED_TRANSACTIONS)).toEqual(
      [],
    );
    // From its first purchase on, it is asked for.
    const onTheDay = [...seedSnaps, snapshot('2026-08-15', allFour)];
    expect(quoteMissing(assets, onTheDay, SEED_TRANSACTIONS, '2026-08-15')).toEqual([
      quoteMissingReminderId('2026-08-15'),
    ]);
  });

  it('still asks for a held position with no quote that day', () => {
    const snaps = [...seedSnaps, snapshot(DAY, heldThree)];
    expect(quoteMissing(SEED_ASSETS, snaps, SEED_TRANSACTIONS)).toEqual([
      quoteMissingReminderId(DAY),
    ]);
  });

  it('asks for a position whose units the ledger cannot count, from its first purchase on', () => {
    const uncounted = SEED_TRANSACTIONS.map((t) =>
      t.id === 'b3' ? { ...t, quantity: undefined } : t,
    );
    // The sale cannot zero a position the ledger cannot count.
    const snaps = [...seedSnaps, snapshot(DAY, heldThree)];
    expect(quoteMissing(SEED_ASSETS, snaps, [...uncounted, sale])).toEqual([
      quoteMissingReminderId(DAY),
    ]);
    // On its first purchase, 05.02, the unquantified row leaves it uncounted. On 04.02 that row is
    // still ahead, so the ledger counts it at 0 units. …6475 is bought on 02.06.
    const funds = { reit: 64648.47, energy: 59214.04 };
    expect(
      quoteMissing(SEED_ASSETS, [snapshot('2026-02-05', funds)], uncounted, '2026-02-05'),
    ).toEqual([quoteMissingReminderId('2026-02-05')]);
    expect(
      quoteMissing(SEED_ASSETS, [snapshot('2026-02-04', funds)], uncounted, '2026-02-04'),
    ).toEqual([]);
  });

  it('is silent with every position sold out and no snapshot for the day', () => {
    // Literal quantities: each sums its position's rows to exactly 0 units.
    const sales: Transaction[] = [
      {
        id: 'x1',
        date: '2026-07-27',
        type: 'sell',
        assetId: 'reit',
        amount: 69000,
        quantity: 6269.0996,
      },
      {
        id: 'x2',
        date: '2026-07-27',
        type: 'sell',
        assetId: 'energy',
        amount: 60500,
        quantity: 6000,
      },
      {
        id: 'x3',
        date: '2026-07-27',
        type: 'sell',
        assetId: 'ovdp8976',
        amount: 15800,
        quantity: 15,
      },
      {
        id: 'x4',
        date: '2026-07-27',
        type: 'sell',
        assetId: 'ovdp6475',
        amount: 4400,
        quantity: 4.2192,
      },
    ];
    expect(quoteMissing(SEED_ASSETS, seedSnaps, [...SEED_TRANSACTIONS, ...sales])).toEqual([]);
  });
});

// The NBU depository pays a coupon or a redemption to the holders it fixes at the end of the day
// before the payment date, so a bond the ledger holds none of then is owed nothing.
describe('coupon and maturity reminders ask only for what the record date owes', () => {
  const seedSnaps = buildSeedSnapshots();
  const sale = (date: string): Transaction => ({
    id: 's2',
    date,
    type: 'sell',
    assetId: 'ovdp8976',
    amount: 15800,
    quantity: 15,
  });
  const buyBack: Transaction = {
    id: 'b9',
    date: '2026-09-01',
    type: 'buy',
    assetId: 'ovdp8976',
    amount: 5300,
    quantity: 5,
  };
  const of8976 = (rows: Transaction[], today: string) =>
    computeReminders(SEED_ASSETS, seedSnaps, [...SEED_TRANSACTIONS, ...rows], today)
      .filter((r) => r.assetId === 'ovdp8976')
      .map((r) => r.id);

  it('raises no coupon and no maturity for a bond sold before its coupon', () => {
    expect(of8976([sale('2026-07-01')], '2026-10-02')).toEqual([]);
    expect(of8976([sale('2026-07-01')], '2027-02-01')).toEqual([]);
  });

  it('owes nothing after a sale on the record day, and the coupon after one on the payment day', () => {
    expect(of8976([sale('2026-08-24')], '2026-10-02')).toEqual([]);
    expect(of8976([sale('2026-08-25')], '2026-10-02')).toEqual([
      couponOverdueReminderId('ovdp8976', '2026-08-25'),
    ]);
  });

  it('announces the next occurrence owed to units bought back, and the maturity', () => {
    const rows = [sale('2026-07-01'), buyBack];
    expect(of8976(rows, '2026-10-02')).toEqual([]);
    expect(of8976(rows, '2027-02-01')).toEqual([maturityReminderId('ovdp8976', '2027-02-25')]);
    expect(of8976(rows, '2027-02-20')).toEqual([
      couponReminderId('ovdp8976', '2027-02-25'),
      maturityReminderId('ovdp8976', '2027-02-25'),
    ]);
  });

  it('keeps both where the ledger cannot count the units', () => {
    const uncounted = SEED_TRANSACTIONS.map((t) =>
      t.id === 'b3' ? { ...t, quantity: undefined } : t,
    );
    const ids = (today: string) =>
      computeReminders(SEED_ASSETS, seedSnaps, [...uncounted, sale('2026-07-01')], today)
        .filter((r) => r.assetId === 'ovdp8976')
        .map((r) => r.id);
    expect(ids('2026-10-02')).toEqual([couponOverdueReminderId('ovdp8976', '2026-08-25')]);
    expect(ids('2027-02-01')).toEqual([
      couponOverdueReminderId('ovdp8976', '2026-08-25'),
      maturityReminderId('ovdp8976', '2027-02-25'),
    ]);
  });

  it('raises nothing, and throws nothing, for a coupon date no calendar has', () => {
    const assets = SEED_ASSETS.map((a) =>
      a.id === 'ovdp8976' ? { ...a, nextCoupon: '2026-13-01' } : a,
    );
    const ids = computeReminders(assets, seedSnaps, SEED_TRANSACTIONS, '2026-10-02')
      .filter((r) => r.assetId === 'ovdp8976')
      .map((r) => r.id);
    expect(ids).toEqual([]);
  });

  it('leaves the seed alone: 04.08 raises quote-missing, and a 21-day lead adds the coupon', () => {
    const ids = (leadDays?: number) =>
      computeReminders(SEED_ASSETS, seedSnaps, SEED_TRANSACTIONS, TODAY, { leadDays }).map(
        (r) => r.id,
      );
    expect(ids()).toEqual([quoteMissingReminderId(TODAY)]);
    expect(ids(21)).toEqual([
      quoteMissingReminderId(TODAY),
      couponReminderId('ovdp8976', '2026-08-25'),
    ]);
  });
});
