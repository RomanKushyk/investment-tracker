import { describe, expect, it } from 'vitest';

import { fmtDate, fmtDateShort, fmtPct, fmtProse, fmtProseWhole, fmtSavedAt, fmtTable, fmtUnits, makeFormat, signed, signedPp, signedProse, signedTable, toUsd } from './money';

it('prose/KPI format per README §8', () => {
  expect(fmtProse(68629.36)).toBe('₴68,629.36');
  expect(fmtProse(toUsd(149016.36, 44.83), 'USD')).toBe('$3,324.03');
  expect(fmtProse(toUsd(4452.61, 44.83), 'USD')).toBe('$99.32'); // renderVals ovNet USD
});

it('whole-hryvnia prose (sidebar capital, Deposited KPI)', () => {
  expect(fmtProseWhole(149016.36)).toBe('₴149,016');
  expect(fmtProseWhole(143176.37)).toBe('₴143,176');
  expect(fmtProseWhole(toUsd(143176.37, 44.83), 'USD')).toBe('$3,194'); // ovDep is ₴-whole only; USD uses fmtProse
});

it('table format: NBSP thousands, comma decimals', () => {
  expect(fmtTable(68702.1)).toBe('68 702,10');
  expect(fmtTable(7.75)).toBe('7,75');
  expect(fmtTable(1183.5)).toBe('1 183,50');
});

it('units format: table locale without forced decimals (S3 Units prefill)', () => {
  expect(fmtUnits(6164)).toBe('6 164'); // NBSP grouping, no ",00"
  expect(fmtUnits(15)).toBe('15'); // integers stay bare (edit reference shows "15")
  expect(fmtUnits(15.5)).toBe('15,5'); // fractions keep exact digits
});

it('percent format: explicit sign, default 2 dp, optional dp override', () => {
  expect(fmtPct(0.0441)).toBe('+4.41%');
  expect(fmtPct(-0.064)).toBe('−6.40%'); // U+2212 — unified sign convention (D8)
  expect(fmtPct(0.0308)).toBe('+3.08%');
  expect(fmtPct(0.093, 1)).toBe('+9.3%'); // Yield table annualized column
  expect(fmtPct(0.109, 1)).toBe('+10.9%');
});

it('every signed helper routes through signed() and pins U+2212', () => {
  expect(signed(-1, 'x')).toBe('−x');
  expect(signed(1, 'x')).toBe('+x');
  expect(fmtPct(-0.064)).not.toContain('-'); // ASCII hyphen-minus must not appear
  expect(signedProse(-120)).toBe('−₴120.00');
  expect(signedProse(4452.61)).toBe('+₴4,452.61'); // Overview Net result
  expect(signedTable(-120)).toBe('−120,00');
  expect(signedTable(2902.1)).toBe('+2 902,10'); // NBSP thousands, Portfolio P&L
});

it('dates: dd.MM.yyyy / dd.MM / saved-at', () => {
  expect(fmtDate('2026-07-27')).toBe('27.07.2026');
  expect(fmtDateShort('2026-07-25')).toBe('25.07');
  expect(fmtSavedAt('2026-07-25T21:14:00')).toBe('25.07, 21:14');
});

describe('signedPp', () => {
  it('formats a positive gap with an explicit "+" and 1 decimal', () => {
    expect(signedPp(6.1)).toBe('+6.1');
  });

  it('formats a negative gap with U+2212 (not ASCII hyphen)', () => {
    const result = signedPp(-6.4);
    expect(result).toBe('−6.4');
    expect(result).not.toContain('-'); // ASCII hyphen-minus must not appear
  });

  it('appends an optional suffix (Overview "%", Yield " pp")', () => {
    expect(signedPp(-6.4, '%')).toBe('−6.4%');
    expect(signedPp(-4.7, ' pp')).toBe('−4.7 pp');
  });

  it('defaults to no suffix (Allocation pills)', () => {
    expect(signedPp(-0.1)).toBe('−0.1');
  });

  it('rounds to 1 decimal place', () => {
    expect(signedPp(6.14)).toBe('+6.1');
    expect(signedPp(6.16)).toBe('+6.2');
  });
});

// ── Contract 0 ─────────────────────────────────────────────────────────────
// The phase-5 brief's table, asserted rather than described. Every expectation
// below is the brief's own example where it gives one, so a disagreement here
// is a disagreement with the binding document, not with a preference.
describe('makeFormat — Contract 0', () => {
  const uk = makeFormat('uk');
  const en = makeFormat('en');
  const NBSP = ' ';

  it('writes the brief’s table exactly', () => {
    expect(uk.num(68702.1)).toBe(`68${NBSP}702,10`);
    expect(en.num(68702.1)).toBe('68,702.10');

    expect(uk.money(68629.36)).toBe(`68${NBSP}629,36${NBSP}₴`);
    expect(en.money(68629.36)).toBe('₴68,629.36');

    expect(uk.money(3324.03, 'USD')).toBe(`3${NBSP}324,03${NBSP}$`);
    expect(en.money(3324.03, 'USD')).toBe('$3,324.03');

    expect(uk.pct(0.0308)).toBe(`+3,08${NBSP}%`);
    expect(en.pct(0.0308)).toBe('+3.08%');

    expect(uk.date('2026-08-12')).toBe('12.08.2026');
    expect(en.date('2026-08-12')).toBe(`12${NBSP}Aug${NBSP}2026`);

    expect(uk.dateShort('2026-08-12')).toBe('12.08');
    expect(en.dateShort('2026-08-12')).toBe(`12${NBSP}Aug`);
  });

  it('uses U+00A0 for every gap inside a figure, in either language', () => {
    // A plain space would let a number wrap across lines mid-value, and the
    // trailing symbol and the % sign would wrap away from their number for the
    // same reason.
    //
    // Asserted POSITIVELY, and that is the point: Node's ICU already emits
    // U+00A0 for uk-UA grouping, so "contains no ASCII space" passes whether or
    // not the normaliser runs — a guard that cannot fail. Naming the exact
    // codepoint instead catches the case the normaliser exists for: an ICU
    // build that emits the NARROW no-break space U+202F.
    const samples = [
      uk.num(1234567.89), uk.numWhole(1234567), uk.units(6164),
      uk.money(1234567.89), uk.moneyWhole(1234567), uk.money(1234.5, 'USD'),
      uk.pct(0.0308), en.date('2026-08-12'), en.dateShort('2026-08-12'),
      uk.signedMoney(-4452.61), uk.signedNum(2902.1),
    ];
    for (const s of samples) {
      const gaps = [...s].filter((c) => /\s/.test(c));
      expect(gaps.length, `${s} has no gap to check`).toBeGreaterThan(0);
      for (const c of gaps) {
        expect(c.codePointAt(0), `${s} — U+${c.codePointAt(0)!.toString(16)}`).toBe(0x00a0);
      }
    }
  });

  it('keeps U+2212 as the minus in both languages (D8)', () => {
    for (const f of [uk, en]) {
      expect(f.pct(-0.0308).startsWith('−')).toBe(true);
      expect(f.pp(-6.4).startsWith('−')).toBe(true);
      expect(f.signedMoney(-120).startsWith('−')).toBe(true);
      expect(f.signedNum(-120).startsWith('−')).toBe(true);
      expect(f.pct(0.01).startsWith('+')).toBe(true);
    }
  });

  it('drops the English month name into the right slot, not the number', () => {
    // Guards the off-by-one every month-index table invites.
    expect(en.date('2026-01-05')).toBe(`5${NBSP}Jan${NBSP}2026`);
    expect(en.date('2026-12-31')).toBe(`31${NBSP}Dec${NBSP}2026`);
    expect(en.dateShort('2026-03-01')).toBe(`1${NBSP}Mar`);
  });

  it('formats a saved-at stamp without touching the clock', () => {
    expect(uk.savedAt('2026-07-25T21:14:00')).toBe('25.07, 21:14');
    expect(en.savedAt('2026-07-25T21:14:00')).toBe(`25${NBSP}Jul, 21:14`);
  });

  it('honours the requested decimal places on percentages', () => {
    expect(uk.pct(0.0702, 1)).toBe(`+7,0${NBSP}%`);
    expect(en.pct(0.0702, 1)).toBe('+7.0%');
  });

  it('leaves unit counts unrounded and undecorated', () => {
    expect(uk.units(6164)).toBe(`6${NBSP}164`);
    expect(uk.units(15.5)).toBe('15,5');
    expect(en.units(15.5)).toBe('15.5');
  });

  it('says the same NUMBER in both languages — only the writing differs', () => {
    // The ruling that matters most: language changes how a figure is written,
    // never which figure it is. Strip the writing and the two must agree.
    const bare = (s: string) => s.replace(/[^\d]/g, '');
    for (const n of [0, 7.75, 68702.1, 149016.36, 1234567.89]) {
      expect(bare(uk.num(n))).toBe(bare(en.num(n)));
      expect(bare(uk.money(n))).toBe(bare(en.money(n)));
    }
  });
});
