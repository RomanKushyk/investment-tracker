// Number and date formatting. Pure, and `lang` is a PARAMETER rather than a
// module global because core may not read state — and because the language control
// swaps text instantly with no reload, so a module-level current-language would
// leave stale figures on screen until something else re-rendered them.
//
// The import from `schemas.ts` is the PARSER, and must stay type-only in the other
// direction so the runtime dependency is one-way: `input()` guarantees its output
// survives a round trip, and the only way to make that guarantee is to run the
// parser on the result.
import { CANONICAL, groupsWithCommaFor, normalizeNumberInput } from './schemas';

const SYMBOL = { UAH: '₴', USD: '$' } as const;
type Currency = keyof typeof SYMBOL;

// THE one signing helper — every signed display string goes through it, so the
// sign glyph is pinned in exactly one place: U+2212 minus, never ASCII '-'.
export function signed(n: number, body: string): string {
  return (n < 0 ? '−' : '+') + body;
}

export function toUsd(uah: number, rate: number): number {
  return uah / rate;
}

/* ════════════════════════════════════════════════════════════════════════════
 * FORMATTING FOLLOWS THE LANGUAGE. Each language owns ONE set, applied everywhere:
 *
 *            Ukrainian (default)   English
 *   number   68 702,10             68,702.10
 *   money ₴  68 629,36 ₴           ₴68,629.36
 *   money $  3 324,03 $            $3,324.03
 *   percent  +3,08 %               +3.08%
 *   date     12.08.2026            12 Aug 2026
 *   short    12.08                 12 Aug
 *
 * `prose` and `table` are therefore NOT different formats; what separates them is
 * only whether a currency symbol is shown, so this API has `num` and `money`
 * rather than four variants.
 *
 * Three details are decisions, not lookups:
 *  · Ukrainian thousands are U+00A0, never a plain space, or a figure wraps across
 *    lines mid-number. The same NBSP separates a value from a trailing symbol.
 *  · Ukrainian puts a space before `%` (ДСТУ); English does not.
 *  · English dates are `12 Aug 2026`, never slashed — a slashed form is ambiguous
 *    between British and American reading.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Lang = 'uk' | 'en';

const NBSP = ' ';

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
 * than written out again. The sample is seven digits wide so a locale whose
 * `minimumGroupingDigits` is 2 still emits a grouping part — read off a shorter
 * number, such a locale hands back no mark and grouping becomes a no-op.
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

/** No exponent, ever: `String(1e-9)` and `(1e21).toFixed(2)` are forms a field
 *  can neither show nor read back. */
const PLAIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20, useGrouping: false });

/**
 * LANGUAGE-FREE on purpose: what a field stores is canonical, so its validity
 * cannot depend on which language is on screen — validating under the live one is
 * how a box and its store come to disagree.
 */
export function storedNumber(value: string): number | undefined {
  if (!CANONICAL.test(value)) return undefined;
  const held = Number(value);
  // FINITE, which a digit run long enough to overflow is not: `Infinity` is
  // positive, so it passes a caller’s range check, and `persist` writes it as `null`.
  return Number.isFinite(held) ? held : undefined;
}

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
 * WHAT A NUMERIC FIELD STORES — one language-free spelling, so a stored value does
 * not change meaning when the language does.
 *
 * THE EDIT IS WHAT IS JUDGED, not the whole box, and only an arriving mark can be
 * told apart at all: `1239,456` and `1234,567` are the same string, so A COMMA
 * FROM A KEY IS THIS FIELD’S GROUPING — English has no other use for one — and one
 * that arrived any other way is READ, which is what keeps the European form
 * refused.
 */
export function valueFromInput(typed: string, stored: string, lang: Lang, pasted: boolean): string {
  const { group } = MARKS[lang];
  const ours = CANONICAL.test(stored);
  const edit = splitEdit(groupedForInput(stored, lang), typed);
  const drop = (text: string) => text.split(group).join('');
  // ONE CHARACTER IS THE ONLY THING A KEY CAN BE. Anything longer arrived from
  // somewhere — a paste, an autofill, an IME commit — and is read by the grammar
  // whatever the caller believed, because a whole number’s marks are its own.
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
 * A leading zero is a value mid-typing rather than a figure, so `0007` is left as
 * it is; anything not a stored number is shown as it is, because the field cannot
 * format what it could not read.
 */
export function groupedForInput(stored: string, lang: Lang): string {
  if (!CANONICAL.test(stored)) return stored;
  const { group, decimal } = MARKS[lang];
  // No mark to part the halves would run them together — digits the field was never
  // given. Show the stored form instead.
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
  num(n: number): string;
  numWhole(n: number): string;
  /** Unit counts: no forced decimals, no rounding of what exists. */
  units(n: number): string;
  /**
   * The value as it appears INSIDE AN EDITABLE FIELD, **guaranteed to parse back
   * to the same number** — but VERIFIED UNDER THIS FORMATTER’S OWN LANGUAGE, and
   * that is the whole of what makes it safe: checked against the other grammar, a
   * Ukrainian «6,164» reads as 6164 and the guarantee certifies a 1000x. Give the
   * field that parses it the same language this was bound to; no signature can
   * enforce that.
   */
  input(n: number): string;
  money(n: number, currency?: Currency): string;
  moneyWhole(n: number, currency?: Currency): string;
  /** Takes a FRACTION, always signed. */
  pct(n: number, fractionDigits?: number): string;
  /** `pct` for a seven-character column: fewer decimals as it grows, `>9999 %` past
   *  that. Only a rise is capped — a delta between positive prices stays above −100 %. */
  pctFit(n: number): string;
  /** Takes a value ALREADY IN PERCENT, never signed — separate from `pct` because
   *  these differ in both respects, and `pct` would force a `+` onto a quantity
   *  that has no direction. */
  pctPlain(n: number, fractionDigits?: number): string;
  /** A signed percentage-point gap, unit suffix per call site. */
  pp(n: number, suffix?: string): string;
  date(iso: string): string;
  dateShort(iso: string): string;
  savedAt(iso: string): string;
  signedMoney(n: number, currency?: Currency): string;
  signedNum(n: number): string;
}

/** Binds every formatter to one language. Call once per render, not per value. */
export function makeFormat(lang: Lang): Format {
  const f = NUM[lang];
  const uk = lang === 'uk';
  // Ukrainian trails the symbol after an NBSP; English leads with it, tight.
  const withSymbol = (body: string, currency: Currency) =>
    uk ? `${body}${NBSP}${SYMBOL[currency]}` : `${SYMBOL[currency]}${body}`;

  const num = (n: number) => nbsp(f.two.format(n));
  // THE DISPLAY BOUNDARY: `Intl` prints `NaN` and `∞` as words, which read as data.
  // Whatever produced the figure, a non-finite one renders the app's «—».
  const finite =
    <A extends unknown[]>(fmt: (n: number, ...rest: A) => string) =>
    (n: number, ...rest: A) =>
      Number.isFinite(n) ? fmt(n, ...rest) : '—';
  const date = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return uk ? `${d}.${m}.${y}` : `${Number(d)}${NBSP}${EN_MONTHS[Number(m) - 1]}${NBSP}${y}`;
  };
  const dateShort = (iso: string) => {
    const [, m, d] = iso.split('-');
    return uk ? `${d}.${m}` : `${Number(d)}${NBSP}${EN_MONTHS[Number(m) - 1]}`;
  };

  return {
    num: finite(num),
    numWhole: finite((n) => nbsp(f.whole.format(n))),
    units: finite((n) => nbsp(f.free.format(n))),
    input: (n) => {
      const shown = nbsp(f.free.format(n));
      return Number(normalizeNumberInput(shown, groupsWithCommaFor(lang))) === n
        ? shown
        : String(n);
    },
    money: finite((n, currency: Currency = 'UAH') => withSymbol(num(n), currency)),
    moneyWhole: finite((n, currency: Currency = 'UAH') =>
      withSymbol(nbsp(f.whole.format(n)), currency),
    ),
    // `toFixed` then a decimal swap, NOT Intl: a percentage is never grouped here, so
    // the only locale difference is the decimal mark, and `toFixed` is exact about
    // digit count where a formatter’s rounding options are one more thing to keep in
    // step.
    pct: finite((n, fractionDigits = 2) =>
      signed(n, pctBody(Math.abs(n * 100), fractionDigits, uk)),
    ),
    // Precision is picked on the ROUNDED figure, so 9,996 steps to `10,0` rather
    // than printing `10,00` one glyph too wide.
    pctFit: finite((n) => {
      const abs = Math.abs(n * 100);
      const tier = FIT_TIERS.find(([dp, below]) => Number(abs.toFixed(dp)) < below);
      return tier === undefined ? `>${pctBody(9999, 0, uk)}` : signed(n, pctBody(abs, tier[0], uk));
    }),
    pctPlain: finite((n, fractionDigits = 1) => pctBody(n, fractionDigits, uk)),
    // A raw suffix would bypass the language rule, and did: one screen passed '%' and
    // rendered "−6,4%" beside a "17 %" one space away in the same sentence.
    pp: finite((n, suffix = '') =>
      signed(n, decimal(Math.abs(n).toFixed(1), uk) + (suffix === '%' && uk ? `${NBSP}%` : suffix)),
    ),
    date,
    dateShort,
    savedAt: (iso) => {
      const [d, time] = iso.split('T');
      return `${dateShort(d)}, ${time.slice(0, 5)}`;
    },
    signedMoney: finite((n, currency: Currency = 'UAH') =>
      signed(n, withSymbol(num(Math.abs(n)), currency)),
    ),
    signedNum: finite((n) => signed(n, num(Math.abs(n)))),
  };
}

/** Swaps the decimal mark of an already-fixed string. */
const decimal = (fixed: string, uk: boolean) => (uk ? fixed.replace('.', ',') : fixed);

/** `pctFit`'s [decimals, magnitude it holds below], each at most four digits wide. */
const FIT_TIERS = [
  [2, 10],
  [1, 100],
  [0, 10000],
] as const;

/** `3,08 %` / `3.08%` — the unsigned body of a percentage. */
function pctBody(absPct: number, dp: number, uk: boolean): string {
  return decimal(absPct.toFixed(dp), uk) + (uk ? `${NBSP}%` : '%');
}
