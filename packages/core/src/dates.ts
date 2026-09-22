// Pure date math, ISO `yyyy-MM-dd` in and out. English date labels live in
// `components/ui/date-labels.ts` — core returns tokens only.
import type { Snapshot } from './types';

// Local-time today: daily quotes are local-day based.
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

export function latestSnapshotDate(snapshots: Snapshot[]): string | undefined {
  return snapshots.reduce<string | undefined>(
    (max, s) => (!max || s.date > max ? s.date : max),
    undefined,
  );
}

/**
 * A window’s opening position is what was held the day BEFORE it opens, not on
 * its first day: `transactionsIn` includes both ends, so a purchase dated on
 * `from` belongs to the window’s flows and valuing the position on `from` would
 * count it twice. It also makes the full-history window reduce exactly.
 */
export function dayBefore(iso: string): string {
  return addDays(iso, -1);
}

/** Pinned to UTC midnight, so the shift is plain integer day arithmetic and no
 *  local DST switch can move it. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Same day-of-month N months later, CLAMPED to the target month’s last day —
// which is why it is not invertible. See `accrual.ts`’ coupon grid.
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// --- Europe/Kyiv -----------------------------------------------------------
// The Inzhur feed lives on Kyiv time: its `paymentSchedule` stamps midnight-Kyiv
// instants and its prices refresh early afternoon Kyiv. Both helpers read the
// offset from Intl AT THE INSTANT IN QUESTION — the +2/+3 DST offset is never
// hardcoded, so they hold on both sides of a switch and on the switch day itself.
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

function kyivOffsetMs(instant: Date): number {
  const p = kyivPartsOf(instant);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// Two passes: guess with the offset at the guessed instant, then correct with the
// one that actually applies there. They differ only across a DST switch.
function kyivHourMs(year: number, month: number, day: number, hour: number): number {
  const wall = Date.UTC(year, month - 1, day, hour);
  const guess = wall - kyivOffsetMs(new Date(wall));
  return wall - kyivOffsetMs(new Date(guess));
}

// An instant’s Kyiv calendar date — a naive UTC slice lands a day early and
// contradicts the bond’s own `maturityDate`.
export function kyivDateIso(instant: Date): string {
  const p = kyivPartsOf(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// The feed’s prices are stamped on Kyiv’s clock, so the time shown beside them is
// Kyiv’s too, whatever the viewer’s zone.
export function kyivTimeHm(instant: Date): string {
  const p = kyivPartsOf(instant);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// The Inzhur query’s staleTime: quotes stay fresh until the feed refreshes.
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
