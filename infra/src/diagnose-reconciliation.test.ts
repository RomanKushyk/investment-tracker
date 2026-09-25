import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { beforeEach, describe, expect, it } from 'vitest';

import { addDays } from '@quirenote/core/dates';
import { freshDb } from './__fixtures__/pglite';
import { EMPTY_DATES_CAP, reconcileObservations } from './diagnose-reconciliation';

/** `capture.ts` is read through this, so a commented-out copy of a table cannot stand in for it
 *  or break the three-table anchor.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}

// The tables come from `ensureSchema`'s own literals: the archive's DDL already exists twice, and
// a third copy here could agree with the test while the deployed table disagrees.
const capture = stripTs(
  readFileSync(new URL('./capture.ts', import.meta.url), 'utf8'),
  './capture.ts',
);
const TABLES = [
  ...capture.matchAll(
    /`\s*(CREATE TABLE IF NOT EXISTS (?:price_capture|price_observation|instrument) \([^`]*)`/g,
  ),
].map((m) => m[1]);

const INZHUR = 'inzhur';
const NBU = 'nbu_fv';
const ABSENT = 'tracked ref absent: UA4000238976';
const UNSCHEDULED = 'schedule absent: UA4000238976';
// The patterns `observeInzhur` and `diagnose` both pass, read rather than restated, so the suite
// runs with what production runs.
const READ_PAST = {
  source: INZHUR,
  errorsLike: [
    ...(capture.match(/const READ_PAST_LIKE = \[([^\]]*)\];/)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((m) => m[1]),
};
const NAV = { basis: 'nav' };
// The stored literal, not `FUND_HISTORY_PARSER_VERSION`: rows keep the version they were written
// with, so a bump of the constant must fail here before it strands them.
const IMPORTED = { basis: 'nav', parser: 'fund-history-1' };
const D = '2026-08-11';
const day = (n: number) => addDays(D, n);
const run = (from: string, length: number) => Array.from({ length }, (_, i) => addDays(from, i));

describe('diagnose reconciles against the capture days the observer reads', () => {
  let db: PGlite;

  beforeEach(async () => {
    expect(TABLES, 'the three archive tables, from capture.ts').toHaveLength(3);
    db = await freshDb();
    for (const ddl of TABLES) await db.exec(ddl);
  });

  async function captured(source: string, asOf: string, error: string | null = null) {
    await db.query(
      `INSERT INTO price_capture (id, requested_at, as_of, source, ok, error,
                                  payload_gzip, payload_bytes, payload_sha256, parser_version)
       VALUES ($1, now(), $2, $3, $4, $5, ''::bytea, 0, '', '1')`,
      [randomUUID(), asOf, source, error === null, error],
    );
  }

  // The bases the writers use: NBU writes `fair` alone, Inzhur `sell` on every entry, and `nav`
  // comes from a fund.
  const basisOf = (source: string) => (source === NBU ? 'fair' : 'sell');

  async function observed(
    ref: string,
    source: string,
    asOf: string,
    { basis = basisOf(source), parser = '1' } = {},
  ) {
    await db.query(
      `INSERT INTO price_observation (as_of, instrument_ref, basis, source, price, observed_at,
                                      parser_version)
       VALUES ($1, $2, $3, $4, 100, now(), $5)`,
      [asOf, ref, basis, source, parser],
    );
  }

  async function listed(ref: string, from: string) {
    await db.query(`INSERT INTO instrument (ref, kind, listed_from) VALUES ($1, $2, $3)`, [
      ref,
      ref.startsWith('inzhur-') ? 'fund' : 'bond',
      from,
    ]);
  }

  async function group(ref: string, source = INZHUR, basis = basisOf(source)) {
    const all = await reconcileObservations(db, READ_PAST);
    const found = all.filter(
      (g) => g.instrument_ref === ref && g.source === source && g.basis === basis,
    );
    expect(found).toHaveLength(1);
    return found[0];
  }

  it('passes diagnose exactly what the observers read past', () => {
    // `usable` restates the observers' predicate; a change to it must change that CTE too.
    expect(capture).toContain(
      'AND (ok = true OR ($4::text[] IS NOT NULL AND error LIKE ANY ($4::text[])))',
    );
    expect(READ_PAST.errorsLike).toEqual(['tracked ref absent:%', 'schedule absent:%']);
    expect(capture).toMatch(
      /NEWEST_CAPTURE_PER_DATE, \[SOURCE\.inzhur, from, windowEnd, READ_PAST_LIKE\]/,
    );
    // `ReadPast` carries one source because NBU reads past nothing.
    expect(capture).toMatch(
      /NEWEST_CAPTURE_PER_DATE, \[SOURCE\.nbuFairValue, from, windowEnd, null\]/,
    );
    expect(capture).toMatch(
      /reconcileObservations\(client, \{\s*source: SOURCE\.inzhur,\s*errorsLike: READ_PAST_LIKE/,
    );
  });

  it('counts a day whose capture carries only a schedule-absent error', async () => {
    await captured(INZHUR, day(0));
    await captured(INZHUR, day(1), UNSCHEDULED);
    for (const n of [0, 1]) await observed('inzhur-reit', INZHUR, day(n));

    expect(await group('inzhur-reit')).toMatchObject({ dates: '2', publishedDays: '2', gaps: 0 });
  });

  it('counts a day whose capture carries only a tracked-ref-absent error, once', async () => {
    // Nothing settles such a day, so each of the day's firings writes another capture.
    await captured(INZHUR, day(0));
    await captured(INZHUR, day(1), 'HTTP 500');
    await captured(INZHUR, day(1));
    for (const n of [2, 3]) {
      for (let firing = 0; firing < 3; firing += 1) await captured(INZHUR, day(n), ABSENT);
    }
    for (const n of [0, 1, 2, 3]) await observed('inzhur-reit', INZHUR, day(n));

    expect(await group('inzhur-reit')).toMatchObject({ dates: '4', publishedDays: '4', gaps: 0 });
  });

  it('starts the source at such a day when it is the earliest', async () => {
    await captured(INZHUR, day(0), ABSENT);
    await captured(INZHUR, day(1));
    for (const n of [0, 1]) await observed('inzhur-reit', INZHUR, day(n));

    expect(await group('inzhur-reit')).toMatchObject({
      before_capture: '0',
      dates: '2',
      first_as_of: day(0),
      gaps: 0,
    });
  });

  it('reads past that error for Inzhur alone, and past no other', async () => {
    // `observeNbu` reads past nothing, and an Inzhur capture that failed outright derives nothing.
    await captured(NBU, day(0));
    await captured(NBU, day(1), ABSENT);
    await captured(NBU, day(2));
    await captured(INZHUR, day(0));
    await captured(INZHUR, day(1), 'HTTP 500');
    await captured(INZHUR, day(2));
    for (const source of [NBU, INZHUR]) {
      for (const n of [0, 2]) await observed('UA4000238976', source, day(n));
    }

    for (const source of [NBU, INZHUR]) {
      expect(await group('UA4000238976', source)).toMatchObject({ publishedDays: '2', gaps: 0 });
    }
  });

  it('counts a day missing before the group’s first observation as a gap', async () => {
    for (let n = 0; n < 5; n += 1) await captured(INZHUR, day(n));
    for (const n of [2, 3, 4]) await observed('UA4000238976', INZHUR, day(n));
    // NBU saw the bond first. Where this observer is the only writer, `listed_from` IS its first
    // row, and a leading day it missed cannot be told from one before the ref existed.
    await listed('UA4000238976', day(-30));

    expect(await group('UA4000238976')).toMatchObject({
      measured_from: day(0),
      first_as_of: day(2),
      dates: '3',
      publishedDays: '5',
      gaps: 2,
      emptyDays: 2,
      emptyDates: [day(0), day(1)],
    });
  });

  it('measures a younger instrument from its listed_from, not before it', async () => {
    for (let n = 0; n < 5; n += 1) await captured(INZHUR, day(n));
    await listed('inzhur-miltech', day(2));
    for (const n of [2, 3, 4]) await observed('inzhur-miltech', INZHUR, day(n));
    await listed('UA4000239115', day(2));
    for (const n of [2, 4]) await observed('UA4000239115', INZHUR, day(n));

    expect(await group('inzhur-miltech')).toMatchObject({ measured_from: day(2), gaps: 0 });
    expect(await group('UA4000239115')).toMatchObject({ measured_from: day(2), gaps: 1 });
  });

  it('counts the days between listed_from and a late first row, and none before it', async () => {
    for (let n = 0; n < 5; n += 1) await captured(INZHUR, day(n));
    await listed('UA4000239107', day(1));
    for (const n of [3, 4]) await observed('UA4000239107', INZHUR, day(n));

    expect(await group('UA4000239107')).toMatchObject({
      measured_from: day(1),
      first_as_of: day(3),
      publishedDays: '4',
      gaps: 2,
    });
  });

  it('opens at a row that predates listed_from, and at the first row with none', async () => {
    // `observeInzhur` writes `instrument` after its date loop, so a run that threw mid-loop leaves
    // rows a later run's `listed_from` postdates.
    for (let n = 0; n < 4; n += 1) await captured(INZHUR, day(n));
    await listed('UA4000239107', day(1));
    for (const n of [0, 1, 3]) await observed('UA4000239107', INZHUR, day(n));
    await listed('UA4000233704', day(9));
    for (const n of [0, 1]) await observed('UA4000233704', INZHUR, day(n));
    for (const n of [2, 3]) await observed('UA4000235865', INZHUR, day(n));

    expect(await group('UA4000239107')).toMatchObject({ measured_from: day(0), gaps: 1 });
    expect(await group('UA4000233704')).toMatchObject({ measured_from: day(0), gaps: 0 });
    expect(await group('UA4000235865')).toMatchObject({ measured_from: day(2), gaps: 0 });
  });

  it('reads unmeasured, not zero gaps, when the source has no usable capture', async () => {
    await captured(NBU, day(0), 'not_published');
    for (const n of [0, 1]) await observed('UA4000238976', NBU, day(n));

    expect(await group('UA4000238976', NBU)).toMatchObject({
      n: '2',
      before_capture: '2',
      dates: '0',
      measured_from: null,
      publishedDays: null,
      gaps: null,
      importedDays: null,
      emptyDays: null,
      emptyDates: null,
    });
  });

  it('measures rows that all precede the first capture by the calendar, to the last', async () => {
    // The captured era never counts past a group's last row, and neither does the imported one.
    await captured(INZHUR, day(5));
    for (const n of [0, 1]) await observed('inzhur-energy', INZHUR, day(n), IMPORTED);

    expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
      n: '2',
      before_capture: '2',
      dates: '0',
      measured_from: null,
      publishedDays: null,
      gaps: null,
      importedDays: '2',
      emptyDays: 0,
      emptyDates: [],
    });
  });

  it('reads a reconciled group exactly as before, over its source’s own calendar', async () => {
    // Friday, a weekend NBU does not publish, Monday.
    await captured(NBU, '2026-08-14');
    await captured(NBU, '2026-08-15', 'not_published');
    await captured(NBU, '2026-08-16', 'not_published');
    await captured(NBU, '2026-08-17');
    await listed('UA4000236475', '2026-08-14');
    for (const d of ['2026-08-14', '2026-08-17']) await observed('UA4000236475', NBU, d);

    // EQUAL, not a subset: a group with no imported rows reads every field it read before, and
    // the imported era's fields read as absent.
    expect(await group('UA4000236475', NBU)).toEqual({
      instrument_ref: 'UA4000236475',
      basis: 'fair',
      source: NBU,
      n: '2',
      before_capture: '0',
      earliest_as_of: '2026-08-14',
      dates: '2',
      measured_from: '2026-08-14',
      first_as_of: '2026-08-14',
      last_as_of: '2026-08-17',
      publishedDays: '2',
      gaps: 0,
      importedDays: null,
      emptyDays: 0,
      emptyDates: [],
    });
  });

  // Imported history sits before the first capture: outside the capture days' count, inside the
  // calendar's.
  it('holds imported rows before the first capture outside the count', async () => {
    for (let n = 0; n < 3; n += 1) await captured(INZHUR, day(n));
    await listed('inzhur-energy', day(-3));
    for (const n of [-3, -2, -1]) await observed('inzhur-energy', INZHUR, day(n), IMPORTED);
    for (const n of [0, 1, 2]) await observed('inzhur-energy', INZHUR, day(n), NAV);

    expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
      n: '6',
      before_capture: '3',
      earliest_as_of: day(-3),
      measured_from: day(0),
      dates: '3',
      gaps: 0,
      importedDays: '3',
      emptyDays: 0,
    });
  });

  it('still reads a missing captured nav day as a gap of one', async () => {
    for (let n = 0; n < 3; n += 1) await captured(INZHUR, day(n));
    await listed('inzhur-energy', day(-1));
    await observed('inzhur-energy', INZHUR, day(-1), IMPORTED);
    for (const n of [0, 2]) await observed('inzhur-energy', INZHUR, day(n), NAV);

    expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
      dates: '2',
      gaps: 1,
      emptyDays: 1,
      emptyDates: [day(1)],
    });
  });

  describe('reports every empty day over the whole span, imported era included', () => {
    it('finds a hole among imported rows and the seam before the first capture', async () => {
      for (let n = 0; n < 3; n += 1) await captured(INZHUR, day(n));
      await listed('inzhur-energy', day(-6));
      for (const n of [-6, -5, -3]) await observed('inzhur-energy', INZHUR, day(n), IMPORTED);
      for (const n of [0, 1, 2]) await observed('inzhur-energy', INZHUR, day(n), NAV);

      expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
        // What the captured era alone reads, and all that was read before.
        gaps: 0,
        importedDays: '6',
        emptyDays: 3,
        emptyDates: [day(-4), day(-2), day(-1)],
      });
    });

    it('reads the seam between a fund’s history file and its first capture', async () => {
      // The archive's shape: both files stop on the same day, and capture begins after a gap.
      for (const d of run('2026-08-11', 3)) await captured(INZHUR, d);
      for (const ref of ['inzhur-energy', 'inzhur-reit']) {
        await listed(ref, '2026-07-01');
        for (const d of run('2026-07-01', 6)) await observed(ref, INZHUR, d, IMPORTED);
        for (const d of run('2026-08-11', 3)) await observed(ref, INZHUR, d, NAV);
      }

      for (const ref of ['inzhur-energy', 'inzhur-reit']) {
        const g = await group(ref, INZHUR, 'nav');
        expect(g).toMatchObject({
          measured_from: '2026-08-11',
          gaps: 0,
          importedDays: '41',
          emptyDays: 35,
          emptyDates: run('2026-07-07', 35),
        });
        expect(g.emptyDates?.at(-1)).toBe('2026-08-10');
      }
    });

    it('keeps the latest empty dates up to the cap, and counts every one', async () => {
      // An old hole longer than the cap must not push a recent, repairable one out of the list.
      // Sized from the cap, so the old hole outruns it whatever the cap is.
      const span = EMPTY_DATES_CAP + 50;
      for (let n = 0; n < 3; n += 1) await captured(INZHUR, day(n));
      await observed('inzhur-energy', INZHUR, day(-span), IMPORTED);
      for (const n of [0, 2]) await observed('inzhur-energy', INZHUR, day(n), NAV);

      expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
        importedDays: String(span),
        emptyDays: span,
        emptyDates: [...run(day(1 - EMPTY_DATES_CAP), EMPTY_DATES_CAP - 1), day(1)],
      });
    });

    it('measures imported rows to the last of them when the source has no usable capture', async () => {
      await captured(INZHUR, day(0), 'HTTP 500');
      for (const n of [0, 1, 3]) await observed('inzhur-energy', INZHUR, day(n), IMPORTED);

      expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
        before_capture: '3',
        measured_from: null,
        publishedDays: null,
        gaps: null,
        importedDays: '4',
        emptyDays: 1,
        emptyDates: [day(2)],
      });
    });

    it('keeps capture days as the captured era’s denominator across both eras', async () => {
      await captured(INZHUR, day(0));
      await captured(INZHUR, day(1), 'HTTP 500');
      await captured(INZHUR, day(2));
      await captured(INZHUR, day(3));
      for (const n of [-3, -1]) await observed('inzhur-energy', INZHUR, day(n), IMPORTED);
      for (const n of [0, 3]) await observed('inzhur-energy', INZHUR, day(n), NAV);

      // Day 1 has no usable capture, so it is no empty day; day -2 has no capture to need.
      expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
        publishedDays: '3',
        gaps: 1,
        importedDays: '3',
        emptyDays: 2,
        emptyDates: [day(-2), day(2)],
      });
    });

    it('opens the captured era where the imported one ends, with no listed_from', async () => {
      for (let n = 0; n < 4; n += 1) await captured(INZHUR, day(n));
      for (const n of [-2, -1]) await observed('inzhur-energy', INZHUR, day(n), IMPORTED);
      for (const n of [2, 3]) await observed('inzhur-energy', INZHUR, day(n), NAV);

      expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
        measured_from: day(0),
        gaps: 2,
        importedDays: '2',
        emptyDays: 2,
        emptyDates: [day(0), day(1)],
      });
    });

    it('counts an empty day that gaps nets away against a row with no usable capture', async () => {
      // An imported row on or after the first capture belongs to the captured era.
      await captured(INZHUR, day(0));
      await captured(INZHUR, day(1), 'HTTP 500');
      await captured(INZHUR, day(2));
      await captured(INZHUR, day(3));
      for (const n of [0, 3]) await observed('inzhur-energy', INZHUR, day(n), NAV);
      await observed('inzhur-energy', INZHUR, day(1), IMPORTED);

      expect(await group('inzhur-energy', INZHUR, 'nav')).toMatchObject({
        dates: '3',
        publishedDays: '3',
        gaps: 0,
        importedDays: null,
        emptyDays: 1,
        emptyDates: [day(2)],
      });
    });
  });
});
