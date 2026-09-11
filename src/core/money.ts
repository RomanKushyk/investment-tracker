// Number/date formatting per README §8. Pure, unit-tested.
// (v1 lib/format.ts + screens/shared/format.ts, merged in next-phase Phase 1.)

// The one module this file imports from, and it is the PARSER: `input()` below
// guarantees its output survives a round trip, and a guarantee cannot be made
// by reasoning about a regexp in another file — only by running it. `schemas.ts`
// imports only a type from here, so at runtime the direction is one-way.
import { groupsWithCommaFor, normalizeNumberInput } from './schemas';

const SYMBOL = { UAH: '₴', USD: '$' } as const;
type Currency = keyof typeof SYMBOL;

// THE one signing helper — every signed display string in the app goes through
// it, so the sign glyph is pinned in exactly one place: U+2212 minus, never
// ASCII '-'. The design reference's mock copy prints ASCII hyphens, but v1
// shipped the U+2212 convention and typography agrees — pinned in
// docs/DECISIONS.md D8. Language-independent, which is why it survived
// Contract 0 as a bare export rather than moving onto the bound object.
export function signed(n: number, body: string): string {
  return (n < 0 ? '−' : '+') + body;
}

export function toUsd(uah: number, rate: number): number {
  return uah / rate;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CONTRACT 0 — formatting follows the language (Phase 5 brief, A10)
 *
 * The old exports below split by CONTEXT: prose was English-shaped
 * (₴68,629.36) and tables Ukrainian-shaped (68 702,10). The owner ruling
 * rejects that mixture — each language owns ONE set, applied everywhere:
 *
 *            Ukrainian (default)   English
 *   number   68 702,10             68,702.10
 *   money ₴  68 629,36 ₴           ₴68,629.36
 *   money $  3 324,03 $            $3,324.03
 *   percent  +3,08 %               +3.08%
 *   date     12.08.2026            12 Aug 2026
 *   short    12.08                 12 Aug
 *
 * The simplification worth noticing: once the convention follows the language,
 * `prose` and `table` stop being different FORMATS. What still separates them
 * is only whether a currency symbol is shown — a table is headed "Amount, ₴"
 * and repeats no symbol. So this API has `num` and `money`, not four variants.
 *
 * Three details are decisions, not lookups:
 *  · Ukrainian thousands are U+00A0, never a plain space, or a figure wraps
 *    across lines mid-number. The same NBSP separates a value from its trailing
 *    symbol and from `%`, for the same reason.
 *  · Ukrainian puts a space before `%` (ДСТУ); English does not.
 *  · English dates are `12 Aug 2026`, never slashed — a slashed form is
 *    ambiguous between British and American reading.
 *
 * PURE, and `lang` is a parameter rather than a module global because `core`
 * may not read state (G1) — and because the language control swaps text
 * INSTANTLY with no reload (brief Surface 2), so every formatted figure has to
 * re-render when it changes. A module-level current-language would leave stale
 * figures on screen until something else happened to re-render them.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Lang = 'uk' | 'en';

const NBSP = ' ';

/** Month abbreviations for the English date form. Ukrainian never needs them. */
const EN_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const NUM: Record<
  Lang,
  { two: Intl.NumberFormat; whole: Intl.NumberFormat; free: Intl.NumberFormat }
> = {
  uk: {
    two: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    whole: new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }),
    free: new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 20 }),
  },
  en: {
    two: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    whole: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
    free: new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }),
  },
};

// ICU variants disagree on WHICH space they emit for uk-UA grouping, so every
// whitespace is normalised to NBSP rather than trusted.
const nbsp = (s: string) => s.replace(/\s/g, NBSP);

/**
 * The two marks a language parts a number with, taken from the formatter rather
 * than written out again. `formatToParts` TAGS them, and the sample is seven
 * digits wide so a locale whose `minimumGroupingDigits` is 2 still emits a
 * grouping part — read off `1000.5`, such a locale would hand back no mark at
 * all and grouping would quietly become a no-op.
 */
const MARKS: Record<Lang, { group: string; decimal: string }> = {
  uk: marksOf('uk'),
  en: marksOf('en'),
};

function marksOf(lang: Lang): { group: string; decimal: string } {
  const parts = NUM[lang].free.formatToParts(1234567.5);
  const of = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { group: nbsp(of('group')), decimal: of('decimal') };
}

/** Digits, an optional single dot, an optional sign — and at least one digit. */
const CANONICAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** No exponent, ever: `String(1e-9)` is `1e-9` and `(1e21).toFixed(2)` is `1e+21`,
 * neither of which a field can show or read back. */
const PLAIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20, useGrouping: false });

/** A number as a field stores it — the form `valueFromInput` would produce. */
export function inputValue(n: number, fractionDigits?: number): string {
  // A field shows nothing rather than the word NaN, which it could not read back.
  if (!Number.isFinite(n)) return '';
  if (fractionDigits === undefined) return PLAIN.format(n);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  }).format(n);
}

/**
 * WHAT A NUMERIC FIELD STORES — one language-free spelling, so a stored value
 * does not change meaning when the language does.
 *
 * THE EDIT IS WHAT IS JUDGED, not the whole box. Only the text that ARRIVED can
 * be read by the grammar: the rest is either this field's own grouping, or —
 * when the stored value is not canonical — text the grammar has already refused
 * and must go on refusing, or a paste is unrefusable after one keystroke.
 *
 * And only an arriving mark can be told apart at all. `1239,456` (a digit typed
 * into `123,456`) and `1234,567` (a European 1234.567) are the same string, so a
 * comma from a KEY is this field's grouping — English has no other use for one
 * (D87) — and one that arrived any other way is read, which is what keeps the
 * European form refused.
 */
export function valueFromInput(typed: string, stored: string, lang: Lang, pasted: boolean): string {
  const { group } = MARKS[lang];
  const ours = CANONICAL.test(stored);
  const edit = splitEdit(groupedForInput(stored, lang), typed);
  const drop = (text: string) => text.split(group).join('');
  // ONE CHARACTER IS THE ONLY THING A KEY CAN BE. Anything longer arrived from
  // somewhere — a paste, an autofill, an IME commit — and is read by the grammar
  // whatever the caller believed, because a whole number's marks are its own.
  const keyed = !pasted && edit.arrived.length <= 1;
  const cleaned =
    (ours ? drop(edit.kept) : edit.kept) +
    (keyed ? drop(edit.arrived) : edit.arrived) +
    (ours ? drop(edit.tail) : edit.tail);
  const normalized = normalizeNumberInput(cleaned, groupsWithCommaFor(lang));
  // `Number` alone takes `0x1000` as 4096 and would let the field dress it as
  // `0x1 000`; a field may only show digits it was given.
  return CANONICAL.test(normalized) ? normalized : cleaned;
}

/** The one run `typed` replaced in `shown`, found from the ends in. */
function splitEdit(shown: string, typed: string): { kept: string; arrived: string; tail: string } {
  let head = 0;
  while (head < shown.length && head < typed.length && shown[head] === typed[head]) head++;
  let foot = 0;
  while (
    foot < shown.length - head &&
    foot < typed.length - head &&
    shown[shown.length - 1 - foot] === typed[typed.length - 1 - foot]
  )
    foot++;
  return {
    kept: typed.slice(0, head),
    arrived: typed.slice(head, typed.length - foot),
    tail: typed.slice(typed.length - foot),
  };
}

/**
 * WHAT THAT FIELD SHOWS — the stored value grouped in this language's own mark,
 * the fraction left alone (this app never groups one). A leading zero is a value
 * mid-typing rather than a figure, so `0007` is left as it is; anything that is
 * not a stored number is shown as it is, because the field cannot format what it
 * could not read.
 */
export function groupedForInput(stored: string, lang: Lang): string {
  if (!CANONICAL.test(stored)) return stored;
  const { group, decimal } = MARKS[lang];
  // No mark to part the halves with would run them together — `1 2345` for
  // 1234.5, digits the field was never given. Show the stored form instead.
  if (decimal === '') return stored;
  const [whole, fraction] = stored.split('.');
  const digits = whole.replace(/^[+-]/, '');
  const grouped =
    digits.length > 1 && digits.startsWith('0')
      ? whole
      : whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}

export interface Format {
  /** 68 702,10 / 68,702.10 — the number alone, two decimals. */
  num(n: number): string;
  /** 149 016 / 149,016 — no decimals. */
  numWhole(n: number): string;
  /** 6 164 / 15,5 — unit counts: no forced decimals, no rounding of what exists. */
  units(n: number): string;
  /**
   * The value as it should appear INSIDE AN EDITABLE FIELD — the language's
   * decimal mark, nothing forced, nothing rounded, and **guaranteed to parse
   * back to the same number** through `normalizeNumberInput`.
   *
   * VERIFIED UNDER THIS FORMATTER'S OWN LANGUAGE, and that is the whole of what
   * makes it safe — checked against the other grammar, a Ukrainian «6,164» reads
   * as 6164 and the guarantee certifies a 1000x. So give the field that parses
   * it the same `language` this was bound to; no signature can enforce that.
   * The dot form is the last resort, a Contract 0 violation accepted only where
   * the alternative is a wrong number.
   */
  input(n: number): string;
  /** 68 629,36 ₴ / ₴68,629.36 — symbol placed by language. */
  money(n: number, currency?: Currency): string;
  /** 149 016 ₴ / ₴149,016. */
  moneyWhole(n: number, currency?: Currency): string;
  /** +3,08 % / +3.08% — takes a FRACTION, always signed. */
  pct(n: number, fractionDigits?: number): string;
  /**
   * 46,1 % / 46.1% — takes a value ALREADY IN PERCENT, never signed.
   * Separate from `pct` because these two differ in both respects, and the
   * sites that need this one (a share of a portfolio, a YTM, an implied yield)
   * were written by hand precisely because `pct` would have forced a `+` onto
   * a quantity that has no direction.
   */
  pctPlain(n: number, fractionDigits?: number): string;
  /** +6,1 / −6.4 — a signed percentage-point gap, unit suffix per call site. */
  pp(n: number, suffix?: string): string;
  /** 12.08.2026 / 12 Aug 2026. */
  date(iso: string): string;
  /** 12.08 / 12 Aug. */
  dateShort(iso: string): string;
  /** 25.07, 21:14 / 25 Jul, 21:14. */
  savedAt(iso: string): string;
  /** +4 452,61 ₴ / +₴4,452.61. */
  signedMoney(n: number, currency?: Currency): string;
  /** +2 902,10 / +2,902.10 — signed, no symbol (table columns). */
  signedNum(n: number): string;
}

/** Binds every formatter to one language. Call it once per render, not per value. */
export function makeFormat(lang: Lang): Format {
  const f = NUM[lang];
  const uk = lang === 'uk';
  // Ukrainian trails the symbol after an NBSP; English leads with it, tight.
  const withSymbol = (body: string, currency: Currency) =>
    uk ? `${body}${NBSP}${SYMBOL[currency]}` : `${SYMBOL[currency]}${body}`;

  const num = (n: number) => nbsp(f.two.format(n));
  const date = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return uk ? `${d}.${m}.${y}` : `${Number(d)}${NBSP}${EN_MONTHS[Number(m) - 1]}${NBSP}${y}`;
  };
  const dateShort = (iso: string) => {
    const [, m, d] = iso.split('-');
    return uk ? `${d}.${m}` : `${Number(d)}${NBSP}${EN_MONTHS[Number(m) - 1]}`;
  };

  return {
    num,
    numWhole: (n) => nbsp(f.whole.format(n)),
    units: (n) => nbsp(f.free.format(n)),
    input: (n) => {
      const shown = nbsp(f.free.format(n));
      return Number(normalizeNumberInput(shown, groupsWithCommaFor(lang))) === n
        ? shown
        : String(n);
    },
    money: (n, currency = 'UAH') => withSymbol(num(n), currency),
    moneyWhole: (n, currency = 'UAH') => withSymbol(nbsp(f.whole.format(n)), currency),
    // The percent sign is glued with NBSP in Ukrainian so a figure never wraps
    // away from its unit; English has no space to protect.
    // `toFixed` then a decimal swap, NOT Intl: a percentage is never grouped
    // (there is no `1 234,56 %` in this app), so the only locale difference is
    // the decimal mark, and toFixed is exact about digit count where a
    // formatter's rounding options are one more thing to keep in step.
    pct: (n, fractionDigits = 2) => signed(n, pctBody(Math.abs(n * 100), fractionDigits, uk)),
    pctPlain: (n, fractionDigits = 1) => pctBody(n, fractionDigits, uk),
    // A raw suffix would bypass the language rule, and did: Overview passes
    // '%' and rendered "−6,4%" beside a "17 %" produced by pctPlain, one space
    // apart in the same sentence. The percent sign is therefore spaced here
    // like everywhere else; any other suffix (' pp') is appended as given.
    pp: (n, suffix = '') =>
      signed(n, decimal(Math.abs(n).toFixed(1), uk) + (suffix === '%' && uk ? `${NBSP}%` : suffix)),
    date,
    dateShort,
    savedAt: (iso) => {
      const [d, time] = iso.split('T');
      return `${dateShort(d)}, ${time.slice(0, 5)}`;
    },
    signedMoney: (n, currency = 'UAH') => signed(n, withSymbol(num(Math.abs(n)), currency)),
    signedNum: (n) => signed(n, num(Math.abs(n))),
  };
}

/** Swaps the decimal mark of an already-fixed string. */
const decimal = (fixed: string, uk: boolean) => (uk ? fixed.replace('.', ',') : fixed);

/** `3,08 %` / `3.08%` — the unsigned body of a percentage. */
function pctBody(absPct: number, dp: number, uk: boolean): string {
  return decimal(absPct.toFixed(dp), uk) + (uk ? `${NBSP}%` : '%');
}
