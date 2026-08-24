import { describe, expect, it } from 'vitest';

import { makeFormat, signed, toUsd } from './money';
import { normalizeNumberInput } from './schemas';

// The legacy exports these covered are gone: each language now owns one
// coherent set, so "prose vs table" is not a distinction the code can make.
// What did NOT survive automatically is the behaviour of `signedPp`, which the
// old block tested and the Contract 0 block did not — ported here onto `pp`
// rather than deleted with its function.
describe('pp — a signed percentage-point gap', () => {
  const uk = makeFormat('uk');
  const en = makeFormat('en');
  const NBSP = ' ';

  it('signs explicitly and keeps one decimal', () => {
    expect(en.pp(6.1)).toBe('+6.1');
    expect(uk.pp(6.1)).toBe('+6,1');
  });

  it('uses U+2212, never an ASCII hyphen', () => {
    const r = en.pp(-6.4);
    expect(r).toBe('−6.4');
    expect(r).not.toContain('-');
  });

  it('spaces a % suffix like every other percentage', () => {
    // Overview puts a pp gap and a plain percentage in one sentence; without
    // this they read "−6,4% ... 17 %" — two conventions, four words apart.
    expect(uk.pp(-6.4, '%')).toBe(`−6,4${NBSP}%`);
    expect(en.pp(-6.4, '%')).toBe('−6.4%');
    // any other suffix is the caller's, appended as given
    expect(uk.pp(-4.7, ' pp')).toBe('−4,7 pp');
  });

  it('appends a non-percent suffix exactly as given (Yield uses " pp")', () => {
    expect(en.pp(-4.7, ' pp')).toBe('−4.7 pp');
  });

  it('defaults to no suffix (Allocation pills)', () => {
    expect(en.pp(-0.1)).toBe('−0.1');
  });

  it('rounds to one decimal place', () => {
    expect(en.pp(6.14)).toBe('+6.1');
    expect(en.pp(6.16)).toBe('+6.2');
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

  it('writes an unsigned percentage without inventing a direction', () => {
    // pctPlain takes a value ALREADY in percent and never signs it — a 46.1%
    // share is not "+46.1%". The Ukrainian space before % applies to both.
    expect(uk.pctPlain(46.1)).toBe(`46,1${NBSP}%`);
    expect(en.pctPlain(46.1)).toBe('46.1%');
    expect(uk.pctPlain(17, 0)).toBe(`17${NBSP}%`);
    expect(uk.pctPlain(0.01, 2)).toBe(`0,01${NBSP}%`);
    // and it must NOT gain a sign, which is the whole reason it exists
    expect(uk.pctPlain(46.1).startsWith('+')).toBe(false);
    expect(en.pctPlain(0)).toBe('0.0%');
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

describe('the two exports Contract 0 left bare', () => {
  it('signed pins U+2212 and is language-independent (D8)', () => {
    expect(signed(-1, 'x')).toBe('−x');
    expect(signed(1, 'x')).toBe('+x');
    expect(signed(-1, 'x')).not.toContain('-');
  });

  it('toUsd is arithmetic, not formatting — it stays a bare number', () => {
    expect(toUsd(149016.36, 44.83)).toBeCloseTo(3324.03, 2);
  });
});

describe('input — the editable form, and the round trip it guarantees', () => {
  // THE PROPERTY, not a list of examples: whatever `input` prints, the app's own
  // parser must read back as the same number, in every language. The first cut
  // of A36 used `units` and pinned 16,4 / 17,5 / 7,25 — none of which is the
  // class that fails, so 754 green tests certified a contract that did not hold.
  const VALUES = [
    0, 3, 17, 40, 100, 0.1, 7.25, 16.4, 17.5, 44.83, 44.6988,
    // exactly three decimals: in Ukrainian these collide with the parser's
    // grouped-thousand rule (`6,164` is also how it would write 6164).
    1.234, 6.164, 0.125, 99.999,
    // and the neighbours that must keep working
    1234.567, 1500, 12.3456,
  ];

  for (const lang of ['uk', 'en'] as const) {
    it(`round-trips every value in ${lang}`, () => {
      const f = makeFormat(lang);
      for (const v of VALUES) {
        const shown = f.input(v);
        expect(Number(normalizeNumberInput(shown)), `${v} rendered "${shown}"`).toBe(v);
      }
    });
  }

  it('prints the language\'s own decimal mark', () => {
    expect(makeFormat('uk').input(17.5)).toBe('17,5');
    expect(makeFormat('en').input(17.5)).toBe('17.5');
  });

  it('adds nothing to a whole number and rounds nothing off a fraction', () => {
    expect(makeFormat('uk').input(40)).toBe('40');
    expect(makeFormat('uk').input(7.25)).toBe('7,25');
  });

  it('disambiguates the three-decimal collision with one trailing zero', () => {
    // Not a rendering fault: `6,164` would parse as 6164 — a 1000x error on an
    // untouched Save — and `6,1640` no longer matches the grouped-integer rule.
    expect(makeFormat('uk').input(6.164)).toBe('6,1640');
    expect(makeFormat('en').input(6.164)).toBe('6.164');
  });
});
