import { describe, expect, it } from 'vitest';

import { makeFormat } from '../../core/money';

import type { Reminder } from '../../core/reminders';
import {
  moreRemindersLabel,
  REMINDER_ACTION,
  reminderText,
  reminderToastText,
} from './reminder-labels';

// The formatter is a parameter now (Contract 0), so these fixtures bind it
// to Ukrainian — the language whose forms these expectations were written in
// and still are: dd.MM.yyyy dates, comma decimals.
const f = makeFormat('uk');

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
    expect(reminderText(quoteMissing, '', f)).toBe('No quotes saved today yet.');
    expect(reminderText(upcoming, NAMES.ovdp8976, f)).toBe(
      'OVDP UA4000238976 pays a coupon in 5 days (25.08.2026).',
    );
    expect(reminderText(overdue, NAMES.ovdp8976, f)).toBe(
      'OVDP UA4000238976 coupon was due 25.07.2026 — record it on Daily quotes.',
    );
    expect(reminderText(maturity, NAMES.ovdp6475, f)).toBe(
      'OVDP UA4000236475 matures in 23 days (27.09.2028).',
    );
  });

  it('keeps the day count grammatical at its edges', () => {
    expect(reminderText({ ...upcoming, days: 1 }, NAMES.ovdp8976, f)).toContain('in 1 day (');
    expect(reminderText({ ...maturity, days: 1 }, NAMES.ovdp6475, f)).toContain('matures in 1 day (');
    expect(reminderText({ ...maturity, days: 0 }, NAMES.ovdp6475, f)).toBe(
      'OVDP UA4000236475 matures today (27.09.2028).',
    );
  });
});

describe('REMINDER_ACTION', () => {
  it('offers a link for the two kinds the design gives one, and no other', () => {
    expect(REMINDER_ACTION['quote-missing']).toBe('Enter quotes →');
    expect(REMINDER_ACTION['coupon-overdue']).toBe('Open Daily quotes →');
    expect(REMINDER_ACTION.coupon).toBeUndefined();
    expect(REMINDER_ACTION.maturity).toBeUndefined();
  });
});

describe('reminderToastText', () => {
  it('uses the first (highest-severity) reminder and appends the rest count', () => {
    expect(reminderToastText([overdue], NAMES, f)).toBe(
      'OVDP UA4000238976 coupon was due 25.07.2026 — record it on Daily quotes.',
    );
    expect(reminderToastText([overdue, quoteMissing, upcoming], NAMES, f)).toBe(
      'OVDP UA4000238976 coupon was due 25.07.2026 — record it on Daily quotes. · +2 more',
    );
  });

  it('is empty with nothing to announce (the toast then never fires)', () => {
    expect(reminderToastText([], NAMES, f)).toBe('');
  });
});

describe('moreRemindersLabel', () => {
  it('renders the overflow line, singular at 1', () => {
    expect(moreRemindersLabel(2)).toBe('+2 more reminders');
    expect(moreRemindersLabel(1)).toBe('+1 more reminder');
  });
});
