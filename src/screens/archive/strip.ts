// THE COVERAGE STRIP'S GEOMETRY (`design/extensions/archive-admin.dc.html`, T4), in percent of one
// axis per source. A position the API neither serves nor lets be derived is never drawn.
import { addDays, daysBetween } from '@quirenote/core/dates';

import type { ArchiveGroup } from '../../lib/repository';

/** A source's axis: every day from `from` to `to`, both included, one cell each. */
export interface Axis {
  from: string;
  to: string;
  days: number;
}

export interface Strip {
  /** Imported history: half the band's height, rounded only where it meets the track's start. */
  imported?: { left: number; width: number; roundLeft: boolean };
  /** The captured era; `seam` is the 2 px `card` line where imported history meets it. */
  captured?: {
    left: number;
    width: number;
    roundLeft: boolean;
    roundRight: boolean;
    seam: boolean;
  };
  /** One per run of adjacent empty days. */
  marks: { left: number; width: number }[];
  /** `emptyDays` past the latest 100: hatched from the earliest expected day where it is served. */
  cut?: { left?: number; width?: number; count: number; before: string };
}

export interface Tick {
  left: number;
  /** 0–11; none on a year axis. */
  month?: number;
  /** On a year axis, on the first tick and on January. */
  year?: number;
}

const measured = (g: ArchiveGroup) => g.emptyDays !== null;

/** The captured era's first day, served only where the group has one. */
const capturedFrom = (g: ArchiveGroup) => (Number(g.dates) > 0 ? g.measured_from : null);

/** The imported era ends the day before the captured one begins, so it starts `importedDays`
 *  before it (`diagnose-reconciliation.ts`, `imported_to`). */
function importedFrom(g: ArchiveGroup): string | null {
  const from = capturedFrom(g);
  const days = Number(g.importedDays ?? 0);
  return from === null || days <= 0 ? null : addDays(from, -days);
}

export function axisOf(groups: ArchiveGroup[], today: string): Axis | undefined {
  const bounds = groups.flatMap((g) =>
    [importedFrom(g), capturedFrom(g), g.emptyDates?.[0] ?? null].filter(
      (d): d is string => d !== null,
    ),
  );
  if (bounds.length === 0) return undefined;
  const from = bounds.reduce((a, b) => (b < a ? b : a));
  const days = daysBetween(from, today) + 1;
  // A clock behind the archive's days leaves no span to draw.
  return days > 0 ? { from, to: today, days } : undefined;
}

// The steps a span takes, and a tick this close to the end gives way to «сьогодні».
const MONTHS_UNDER_DAYS = 200;
const QUARTERS_UNDER_DAYS = 731;
const END_CLEARANCE = 0.12;

export function ticksOf(axis: Axis): Tick[] {
  const step = axis.days < MONTHS_UNDER_DAYS ? 1 : axis.days < QUARTERS_UNDER_DAYS ? 3 : 12;
  const [y, m] = axis.from.split('-').map(Number) as [number, number];
  const ticks: Tick[] = [];
  // The first boundary of the step after the axis starts.
  let month = Math.ceil(m / step) * step;
  let year = y;
  for (;;) {
    year += Math.floor(month / 12);
    month %= 12;
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const left = (daysBetween(axis.from, iso) * 100) / axis.days;
    if (left > (1 - END_CLEARANCE) * 100) break;
    if (iso > axis.from) {
      ticks.push(
        step === 12
          ? { left, year }
          : { left, month, ...(ticks.length === 0 || month === 0 ? { year } : {}) },
      );
    }
    month += step;
  }
  return ticks;
}

export function stripOf(g: ArchiveGroup, axis: Axis): Strip {
  const at = (iso: string) => (daysBetween(axis.from, iso) * 100) / axis.days;
  const cell = 100 / axis.days;
  const strip: Strip = { marks: [] };

  const captured = capturedFrom(g);
  const imported = importedFrom(g);
  if (captured !== null && g.last_as_of !== null) {
    const left = at(captured);
    strip.captured = {
      left,
      width: at(g.last_as_of) + cell - left,
      roundLeft: left === 0,
      roundRight: g.last_as_of >= axis.to,
      seam: imported !== null,
    };
    if (imported !== null) {
      const from = at(imported);
      strip.imported = { left: from, width: left - from, roundLeft: from === 0 };
    }
  }

  const dates = g.emptyDates ?? [];
  for (const iso of dates) {
    const last = strip.marks.at(-1);
    const left = at(iso);
    if (last !== undefined && Math.abs(last.left + last.width - left) < cell / 2) {
      last.width += cell;
    } else {
      strip.marks.push({ left, width: cell });
    }
  }

  const unlisted = (g.emptyDays ?? 0) - dates.length;
  if (unlisted > 0 && dates[0] !== undefined) {
    const earliest = imported ?? captured;
    const before = dates[0];
    strip.cut =
      earliest === null
        ? { count: unlisted, before }
        : { left: at(earliest), width: at(before) - at(earliest), count: unlisted, before };
  }
  return strip;
}

/** The most empty days first, then the order the route serves them in, a group not measured last. */
export function orderGroups(groups: ArchiveGroup[]): ArchiveGroup[] {
  const rank = (g: ArchiveGroup) => (measured(g) ? (g.emptyDays ?? 0) : -1);
  return [...groups].sort((a, b) => rank(b) - rank(a));
}
