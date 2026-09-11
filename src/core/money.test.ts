import { describe, expect, it } from 'vitest';

import { groupedForInput, inputValue, makeFormat, signed, toUsd, valueFromInput } from './money';
import { amountInputSchema, groupsWithCommaFor, normalizeNumberInput } from './schemas';

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
      uk.num(1234567.89),
      uk.numWhole(1234567),
      uk.units(6164),
      uk.money(1234567.89),
      uk.moneyWhole(1234567),
      uk.money(1234.5, 'USD'),
      uk.pct(0.0308),
      en.date('2026-08-12'),
      en.dateShort('2026-08-12'),
      uk.signedMoney(-4452.61),
      uk.signedNum(2902.1),
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
    // BELOW WHAT `f.free` CAN PRINT (20 fraction digits), so the formatted form
    // rounds to "0" and the round trip fails — this is the one value in the list
    // that leaves through `input`'s `String(n)` last resort, and the assertion
    // below is what keeps that branch honest rather than merely unreachable.
    1e-25,
  ];

  for (const lang of ['uk', 'en'] as const) {
    it(`round-trips every value in ${lang}`, () => {
      const f = makeFormat(lang);
      for (const v of VALUES) {
        const shown = f.input(v);
        // UNDER ITS OWN LANGUAGE, which is the whole guarantee: `input` prints
        // in one grammar, so the parser it is checked against has to be that
        // grammar's. Checked against the other one, a Ukrainian «6,164» reads
        // as 6164 and the round trip certifies a 1000x.
        expect(
          Number(normalizeNumberInput(shown, groupsWithCommaFor(lang))),
          `${v} rendered "${shown}"`,
        ).toBe(v);
      }
    });
  }

  it("prints the language's own decimal mark", () => {
    expect(makeFormat('uk').input(17.5)).toBe('17,5');
    expect(makeFormat('en').input(17.5)).toBe('17.5');
  });

  it('adds nothing to a whole number and rounds nothing off a fraction', () => {
    expect(makeFormat('uk').input(40)).toBe('40');
    expect(makeFormat('uk').input(7.25)).toBe('7,25');
  });

  it('falls back to the dot form only when the language cannot print the value', () => {
    // The `String(n)` last resort, asserted directly: the round-trip check above
    // would still pass if `f.free` ever started printing 1e-25, leaving the
    // branch unreachable with the suite green.
    expect(makeFormat('uk').input(1e-25)).toBe('1e-25');
    expect(makeFormat('en').input(1e-25)).toBe('1e-25');
  });

  it('prints a three-decimal fraction plainly, with nothing added to disambiguate it', () => {
    // «6,1640» was a pad against a parser that read the Ukrainian text under the
    // English rule. The rule follows the language now, so the value is shown as
    // it is written — and still reads back as itself.
    expect(makeFormat('uk').input(6.164)).toBe('6,164');
    expect(makeFormat('en').input(6.164)).toBe('6.164');
  });
});

describe('what a numeric field stores, and what it shows', () => {
  const NBSP = ' ';
  // Both take the value the field HELD, because the edit is what gets judged.
  const typed = (raw: string, lang: 'uk' | 'en', stored = '') =>
    valueFromInput(raw, stored, lang, false);
  const pasted = (raw: string, lang: 'uk' | 'en', stored = '') =>
    valueFromInput(raw, stored, lang, true);
  /** One key pressed at `at` in what the field is showing. */
  const key = (stored: string, ch: string, lang: 'uk' | 'en', at?: number) => {
    const shown = groupedForInput(stored, lang);
    const pos = at ?? shown.length;
    return valueFromInput(shown.slice(0, pos) + ch + shown.slice(pos), stored, lang, false);
  };
  /** A paste onto the end of a field already holding `stored`. */
  const pasteInto = (stored: string, text: string, lang: 'uk' | 'en') =>
    valueFromInput(groupedForInput(stored, lang) + text, stored, lang, true);

  it('stores ONE language-free spelling, whichever language typed it', () => {
    // The defect that forced this shape: stored as it was shown, an English
    // `1,234` reads as 1.234 the moment the language changes. Both languages now
    // store the same text, so the value cannot change meaning underneath it.
    expect(typed('1,234', 'en')).toBe('1234');
    expect(typed(`1${NBSP}234`, 'uk')).toBe('1234');
    expect(typed('1 234,56', 'uk')).toBe('1234.56');
    expect(typed('1,234.56', 'en')).toBe('1234.56');
    for (const lang of ['uk', 'en'] as const) {
      expect(Number(normalizeNumberInput('1234', groupsWithCommaFor(lang))), lang).toBe(1234);
      expect(Number(normalizeNumberInput('1234.56', groupsWithCommaFor(lang))), lang).toBe(1234.56);
    }
  });

  it("shows it grouped in the language's own mark, fraction untouched", () => {
    expect(groupedForInput('1234567', 'uk')).toBe(`1${NBSP}234${NBSP}567`);
    expect(groupedForInput('1234567', 'en')).toBe('1,234,567');
    expect(groupedForInput('1234567.89', 'uk')).toBe(`1${NBSP}234${NBSP}567,89`);
    expect(groupedForInput('1234567.89', 'en')).toBe('1,234,567.89');
    expect(groupedForInput('123', 'uk')).toBe('123');
    // A fraction is never grouped — this app has no `1 234,567 89`.
    expect(groupedForInput('1234.123456', 'uk')).toBe(`1${NBSP}234,123456`);
  });

  it('keeps a decimal mark the typist has only just pressed', () => {
    expect(groupedForInput(typed('1234,', 'uk'), 'uk')).toBe(`1${NBSP}234,`);
    expect(groupedForInput(typed('1234.', 'en'), 'en')).toBe('1,234.');
    expect(typed('1234,', 'uk')).toBe('1234.');
  });

  it('reads back its own display, keystroke by keystroke', () => {
    // What the browser walks: whatever is on screen is what the next keystroke
    // lands in, so every state a typist passes through has to survive the trip.
    for (const [lang, mark, want] of [
      ['uk', ',', `1${NBSP}234${NBSP}567,89`],
      ['en', '.', '1,234,567.89'],
    ] as const) {
      let stored = '';
      for (const ch of `1234567${mark}89`) {
        stored = typed(groupedForInput(stored, lang) + ch, lang);
      }
      expect(groupedForInput(stored, lang), lang).toBe(want);
    }
  });

  it('settles a pasted both-marks value on the value it means, in both languages', () => {
    for (const lang of ['uk', 'en'] as const) {
      for (const text of ['1,234.56', '1.234,56']) {
        expect(pasted(text, lang), `${lang}: ${text}`).toBe('1234.56');
      }
    }
  });

  it('REFUSES a pasted European decimal under English, as it always did', () => {
    // `1234,567` is 1234.567 to half of Europe and a grouped 1234567 to the
    // other half, and English has no lone-comma reading (D87) — so it stays
    // unreadable rather than being stored a thousandfold too large. It cannot be
    // told from `1239,456`, the state a digit typed into `123,456` passes
    // through, which is why a PASTE is judged by the grammar and a KEYSTROKE is
    // not.
    expect(pasted('1234,567', 'en')).toBe('1234,567');
    expect(amountInputSchema('en').safeParse(pasted('1234,567', 'en')).success).toBe(false);
    expect(key('123456', '9', 'en', 3)).toBe('1239456');
    // Pasted into Ukrainian the same text is a lone comma, so it reads.
    expect(pasted('1234,567', 'uk')).toBe('1234.567');
  });

  it('pastes digits INTO a field that is already grouped', () => {
    // The whole box used to be handed to the grammar on a paste, so the field's
    // own comma came back at it: `1,234` + `567` read as `1,234567`, which
    // English refuses, and the row went red on the user's own figure.
    expect(pasteInto('1234', '567', 'en')).toBe('1234567');
    expect(pasteInto('1234', '567', 'uk')).toBe('1234567');
    expect(pasteInto('1234567', '.5', 'en')).toBe('1234567.5');
  });

  it('goes on refusing a pasted European decimal after the next keystroke', () => {
    // A refusal one keystroke deep is no refusal: a Backspace used to take the
    // comma as this field's grouping and store 123456 for a value that had just
    // been rejected. While the stored value is not a number, the marks in the
    // box are the typist's and stay theirs.
    const refused = pasted('1234,567', 'en');
    expect(refused).toBe('1234,567');
    expect(typed('1234,56', 'en', refused)).toBe('1234,56');
    expect(typed('1234,5678', 'en', refused)).toBe('1234,5678');
    expect(amountInputSchema('en').safeParse(typed('1234,56', 'en', refused)).success).toBe(false);
    // Taking the comma out is the way back, and it reads at once.
    expect(typed('1234567', 'en', refused)).toBe('1234567');
  });

  it('leaves a leading zero ungrouped — it is a value mid-typing, not a figure', () => {
    expect(groupedForInput('0007', 'uk')).toBe('0007');
    expect(groupedForInput('00071', 'en')).toBe('00071');
    expect(groupedForInput('007', 'uk')).toBe('007');
    expect(groupedForInput('0.5', 'uk')).toBe('0,5');
  });

  it('never writes a stored value in exponent form', () => {
    // `String(1e-9)` is `1e-9`, which is not canonical — the field would drop
    // its grouping and show the exponent. The Σ/1 toggle reaches it with a big
    // enough count.
    expect(inputValue(1e-9)).toBe('0.000000001');
    expect(groupedForInput(inputValue(1e-9), 'uk')).toBe('0,000000001');
    expect(inputValue(1e21)).toBe('1000000000000000000000');
  });

  it('reads a whole number that ARRIVED, however it got there', () => {
    // Autofill and an IME commit are not keystrokes and do not come in under
    // `insertFromPaste` either, so judging them as typed de-grouped `1.234,56`
    // into 1.23456 — a silent 1000x, and a legal number nothing refuses. Length
    // settles it regardless of what the caller believed: one character is the
    // only thing a key can be.
    expect(valueFromInput('1.234,56', '', 'en', false)).toBe('1234.56');
    expect(valueFromInput('1234,56', '', 'en', false)).toBe('1234,56');
    expect(valueFromInput('1.234,56', '', 'uk', false)).toBe('1234.56');
    // A single keyed character is still read as this field's own mark.
    expect(key('16', ',', 'en')).toBe('16');
  });

  it('takes a typed comma in English as the grouping it is, not a decimal', () => {
    // English groups with the comma and the field inserts its own, so one the
    // typist adds is redundant — and it disappears as they type, which is the
    // field saying so. Pasted, the same text is refused instead.
    expect(key('16', ',', 'en')).toBe('16');
    expect(key(key('16', ',', 'en'), '5', 'en')).toBe('165');
    expect(pasted('16,5', 'en')).toBe('16,5');
    expect(key('16', ',', 'uk')).toBe('16.');
    expect(key('16.', '5', 'uk')).toBe('16.5');
  });

  it('stores text it cannot read exactly as typed, and shows it unchanged', () => {
    for (const text of ['', '-', 'abc', '12abc']) {
      expect(typed(text, 'uk'), text).toBe(text);
      expect(groupedForInput(text, 'uk'), text).toBe(text);
    }
  });

  it('refuses to dress up something only `Number` calls a number', () => {
    // `Number('0x1000')` is 4096, so a guard on finiteness alone let the field
    // render `0x1 000` — digits it was never given.
    expect(typed('0x1000', 'uk')).toBe('0x1000');
    expect(groupedForInput('0x1000', 'uk')).toBe('0x1000');
    expect(typed('1e5', 'en')).toBe('1e5');
  });

  it('keeps leading zeros rather than renumbering what is being typed', () => {
    expect(typed('007', 'uk')).toBe('007');
    expect(groupedForInput('007', 'uk')).toBe('007');
    expect(typed('0,5', 'uk')).toBe('0.5');
  });

  it('cleans a currency token off a pasted figure it can read', () => {
    expect(pasted('4 214,24 грн. ', 'uk')).toBe('4214.24');
    expect(pasted('₴68,629.36', 'en')).toBe('68629.36');
  });

  it('round-trips what `inputValue` writes into the same fields', () => {
    // The prefill writers store through `inputValue`; the field shows that and
    // stores it back unchanged if nobody edits it.
    for (const lang of ['uk', 'en'] as const) {
      for (const v of [0.1, 17.5, 1234.567, 6.164, 1500, 68702.1]) {
        const stored = inputValue(v);
        expect(typed(groupedForInput(stored, lang), lang), `${lang}: ${v}`).toBe(stored);
      }
      expect(groupedForInput(inputValue(68702.1, 2), lang)).toBe(
        lang === 'uk' ? `68${NBSP}702,10` : '68,702.10',
      );
    }
  });
});
