import { describe, expect, it } from 'vitest';

import { makeFormat } from '../../core/money';
import { en, uk } from '../../i18n/messages';

import type { Reminder } from '../../core/reminders';
import {
  moreRemindersLabel,
  reminderAction,
  reminderText,
  reminderToastText,
} from './reminder-labels';

// The formatter is a parameter now (Contract 0), so these fixtures bind it
// to Ukrainian — the language whose forms these expectations were written in
// and still are: dd.MM.yyyy dates, comma decimals.
// English is the language these sentences were pinned in, so the English
// rendering is asserted verbatim — WITH English dates, which Contract 0 now
// makes "25 Aug 2026" rather than "25 Aug 2026". A Ukrainian block follows,
// because that is where the plural rule can go wrong.
const f = makeFormat('en');
const t = en;
const fUk = makeFormat('uk');

const NAMES = { ovdp8976: 'OVDP UA4000238976', ovdp6475: 'OVDP UA4000236475' };

const quoteMissing: Reminder = {
  id: 'quote-missing:2026-08-20',
  kind: 'quote-missing',
  severity: 'warn',
  date: '2026-08-20',
  days: 0,
};

const upcoming: Reminder = {
  id: 'coupon:ovdp8976:2026-08-25',
  kind: 'coupon',
  severity: 'info',
  date: '2026-08-25',
  days: 5,
  assetId: 'ovdp8976',
};

const overdue: Reminder = {
  id: 'coupon-overdue:ovdp8976:2026-07-25',
  kind: 'coupon-overdue',
  severity: 'overdue',
  date: '2026-07-25',
  days: -10,
  assetId: 'ovdp8976',
};

const maturity: Reminder = {
  id: 'maturity:ovdp6475:2028-09-27',
  kind: 'maturity',
  severity: 'info',
  date: '2028-09-27',
  days: 23,
  assetId: 'ovdp6475',
};

describe('reminderText', () => {
  // Verbatim from the reference's copy inventory.
  it('renders the four kinds exactly as the design pins them', () => {
    expect(reminderText(quoteMissing, '', f, t)).toBe('No quotes saved today yet.');
    expect(reminderText(upcoming, NAMES.ovdp8976, f, t)).toBe(
      'OVDP UA4000238976 pays a coupon in 5 days (25 Aug 2026).',
    );
    expect(reminderText(overdue, NAMES.ovdp8976, f, t)).toBe(
      'OVDP UA4000238976 coupon was due 25 Jul 2026 — record it on Daily quotes.',
    );
    expect(reminderText(maturity, NAMES.ovdp6475, f, t)).toBe(
      'OVDP UA4000236475 matures in 23 days (27 Sep 2028).',
    );
  });

  it('keeps the day count grammatical at its edges', () => {
    expect(reminderText({ ...upcoming, days: 1 }, NAMES.ovdp8976, f, t)).toContain('in 1 day (');
    expect(reminderText({ ...maturity, days: 1 }, NAMES.ovdp6475, f, t)).toContain(
      'matures in 1 day (',
    );
    expect(reminderText({ ...maturity, days: 0 }, NAMES.ovdp6475, f, t)).toBe(
      'OVDP UA4000236475 matures today (27 Sep 2028).',
    );
  });
});

describe('reminderAction', () => {
  it('offers a link for the two kinds the design gives one, and no other', () => {
    expect(reminderAction(t)['quote-missing']).toBe('Enter quotes →');
    expect(reminderAction(t)['coupon-overdue']).toBe('Open Daily quotes →');
    expect(reminderAction(t).coupon).toBeUndefined();
    expect(reminderAction(t).maturity).toBeUndefined();
  });
});

describe('reminderToastText', () => {
  it('uses the first (highest-severity) reminder and appends the rest count', () => {
    expect(reminderToastText([overdue], NAMES, f, t)).toBe(
      'OVDP UA4000238976 coupon was due 25 Jul 2026 — record it on Daily quotes.',
    );
    expect(reminderToastText([overdue, quoteMissing, upcoming], NAMES, f, t)).toBe(
      'OVDP UA4000238976 coupon was due 25 Jul 2026 — record it on Daily quotes. · +2 more',
    );
  });

  it('is empty with nothing to announce (the toast then never fires)', () => {
    expect(reminderToastText([], NAMES, f, t)).toBe('');
  });
});

describe('moreRemindersLabel', () => {
  it('renders the overflow line, singular at 1', () => {
    expect(moreRemindersLabel(2, t)).toBe('+2 more reminders');
    expect(moreRemindersLabel(1, t)).toBe('+1 more reminder');
  });
});

// The Ukrainian side, and specifically the plural rule: three forms where
// English has two, with the 11-14 band taking `many` despite ending in 1-4.
// A shared template with a count spliced in would read "2 днів" here.
describe('reminderText — Ukrainian plural forms', () => {
  const say = (days: number) => reminderText({ ...upcoming, days }, NAMES.ovdp8976, fUk, uk);

  it('uses the one/few/many forms at their boundaries', () => {
    expect(say(1)).toContain('через 1 день');
    expect(say(2)).toContain('через 2 дні');
    expect(say(4)).toContain('через 4 дні');
    expect(say(5)).toContain('через 5 днів');
    expect(say(21)).toContain('через 21 день');
    expect(say(22)).toContain('через 22 дні');
  });

  it('gives the 11-14 band the many form, which is the case naive rules miss', () => {
    for (const n of [11, 12, 13, 14]) expect(say(n), String(n)).toContain(`через ${n} днів`);
  });

  it('writes the date in the Ukrainian form beside it', () => {
    expect(say(5)).toContain('(25.08.2026)');
  });
});
