// Number/date formatting per README §8. Pure, unit-tested.
// (v1 lib/format.ts + screens/shared/format.ts, merged in next-phase Phase 1.)

const SYMBOL = { UAH: '₴', USD: '$' } as const;
type Currency = keyof typeof SYMBOL;

// THE one signing helper — every signed display string in the app goes through
// it, so the sign glyph is pinned in exactly one place: U+2212 minus, never
// ASCII '-'. The design reference's mock copy prints ASCII hyphens, but v1
// shipped the U+2212 convention and typography agrees — pinned in
// docs/decisions/README.md D8. Language-independent, which is why it survived
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
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const NUM: Record<Lang, { two: Intl.NumberFormat; whole: Intl.NumberFormat; free: Intl.NumberFormat }> = {
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

export interface Format {
  /** 68 702,10 / 68,702.10 — the number alone, two decimals. */
  num(n: number): string;
  /** 149 016 / 149,016 — no decimals. */
  numWhole(n: number): string;
  /** 6 164 / 15,5 — unit counts: no forced decimals, no rounding of what exists. */
  units(n: number): string;
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
      signed(
        n,
        decimal(Math.abs(n).toFixed(1), uk) + (suffix === '%' && uk ? `${NBSP}%` : suffix),
      ),
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
