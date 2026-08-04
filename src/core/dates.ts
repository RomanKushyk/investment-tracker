// Pure date math (ISO yyyy-MM-dd strings in, ISO strings/numbers out).
// English date labels ("10 Aug", "10th", month names) live in
// components/ui/date-labels.ts — core returns tokens only (G1).
import type { Snapshot } from './types';

// Local-time today (daily quotes are local-day based) — the single source,
// was triplicated in Overview/DailyQuotes/TransactionPanel.
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// Max snapshot date across the store — the "now" basis for annualized/weeks-held copy.
export function latestSnapshotDate(snapshots: Snapshot[]): string | undefined {
  return snapshots.reduce<string | undefined>(
    (max, s) => (!max || s.date > max ? s.date : max),
    undefined,
  );
}

// Same day-of-month N months later (Next payouts' estimated dividend date),
// clamped to the target month's last day: 2026-08-31 +6m -> 2027-02-28 (G1).
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// --- Europe/Kyiv (G1's "Kyiv-time helper") ---------------------------------
// The Inzhur feed lives on Kyiv time (D19): its paymentSchedule stamps
// midnight-Kyiv instants and its prices refresh ~13:00 Kyiv. Both helpers read
// the zone offset from Intl at the instant in question — the +2/+3 DST offset
// is never hardcoded, so they hold on both sides of a switch and on the
// switch day itself.
const KYIV_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Kyiv',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface KyivParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function kyivPartsOf(instant: Date): KyivParts {
  const p: Record<string, string> = {};
  for (const part of KYIV_PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24, // some ICU builds render midnight as "24"
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

// Kyiv's UTC offset (ms) at a given instant, read from Intl.
function kyivOffsetMs(instant: Date): number {
  const p = kyivPartsOf(instant);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// Epoch ms of a Kyiv wall-clock hour. Two passes: guess with the offset at the
// guessed instant, then correct with the offset that actually applies there —
// the two differ only across a DST switch, which is exactly the case a
// hardcoded offset gets wrong.
function kyivHourMs(year: number, month: number, day: number, hour: number): number {
  const wall = Date.UTC(year, month - 1, day, hour);
  const guess = wall - kyivOffsetMs(new Date(wall));
  return wall - kyivOffsetMs(new Date(guess));
}

// An instant's Kyiv calendar date — '2027-03-23T22:00:00Z' -> '2027-03-24'
// (the feed's schedule dates are midnight Kyiv, so a naive UTC slice would be
// a day early and would contradict the bond's own maturityDate).
export function kyivDateIso(instant: Date): string {
  const p = kyivPartsOf(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// An instant's Kyiv wall-clock time as 'HH:MM' — the S1/S2 "fetched 13:05"
// microcopy. The feed's prices are stamped on Kyiv's clock (D19), so the time
// the app shows beside them is Kyiv's too, whatever the viewer's zone is.
export function kyivTimeHm(instant: Date): string {
  const p = kyivPartsOf(instant);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// Milliseconds from `now` until the next `hour`:00 in Kyiv (strictly future) —
// the Inzhur query's staleTime: quotes stay fresh until the feed refreshes.
export function msUntilNextKyivHour(now: Date, hour: number): number {
  const p = kyivPartsOf(now);
  const today = kyivHourMs(p.year, p.month, p.day, hour);
  if (today > now.getTime()) return today - now.getTime();
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day) + 86_400_000);
  const next = kyivHourMs(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    hour,
  );
  return next - now.getTime();
}
