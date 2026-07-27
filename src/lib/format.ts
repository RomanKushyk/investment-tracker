// Number/date formatting per README §8. Pure, unit-tested.

const SYMBOL = { UAH: '₴', USD: '$' } as const;
type Currency = keyof typeof SYMBOL;

const proseFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const proseWholeFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const tableFmt = new Intl.NumberFormat('uk-UA', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ₴68,629.36 / $3,324.03 — prose & KPI figures.
export function fmtProse(n: number, currency: Currency = 'UAH'): string {
  return SYMBOL[currency] + proseFmt.format(n);
}

// ₴149,016 — sidebar capital, Deposited KPI.
export function fmtProseWhole(n: number, currency: Currency = 'UAH'): string {
  return SYMBOL[currency] + proseWholeFmt.format(n);
}

// 68 702,10 — NBSP (U+00A0) thousands, comma decimals; tables and inputs.
// ICU variants differ on the exact space character, so normalize explicitly.
export function fmtTable(n: number): string {
  return tableFmt.format(n).replace(/\s/g, '\u00A0');
}

// Fraction in → '+4.41%'. Explicit sign always; dp defaults to 2 (Yield annualized uses 1).
export function fmtPct(n: number, fractionDigits = 2): string {
  const abs = Math.abs(n * 100).toFixed(fractionDigits);
  return (n < 0 ? '-' : '+') + abs + '%';
}

// '2026-07-27' → '27.07.2026'
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// '2026-07-25' → '25.07'
export function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

// '2026-07-25T21:14:00' → '25.07, 21:14' (string-parsed — no timezone surprises)
export function fmtSavedAt(iso: string): string {
  const [date, time] = iso.split('T');
  return `${fmtDateShort(date)}, ${time.slice(0, 5)}`;
}

export function toUsd(uah: number, rate: number): number {
  return uah / rate;
}
