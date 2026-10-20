// `importDerivedSell` on PGlite with the cluster connection replaced: what the import writes, what
// it leaves as it was, and that a second run writes nothing.
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDays } from '@quirenote/core/dates';
import { freshDb } from './__fixtures__/pglite';
import { zipOf } from './__fixtures__/xlsx';
import { handler } from './capture';
import { DERIVED_SELL_PARSER_VERSION, DERIVED_SELL_RUNS, divisorOn } from './derived-sell';
import { connect } from './dsql';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

let db: PGlite;
/** An observation insert to fail, by a value it carries, to reach the import's rollback. */
let failOn: RegExp | undefined;

// `ensureSchema` builds its indexes `ASYNC`, a DSQL verb PGlite refuses; `rowCount` is pg's name
// for PGlite's `affectedRows`.
beforeEach(async () => {
  db = await freshDb();
  failOn = undefined;
  vi.mocked(connect).mockResolvedValue({
    query: async (text: string, values?: unknown[]) => {
      const insert = /^\s*INSERT INTO price_observation/.test(text);
      if (insert && failOn !== undefined && values?.some((v) => failOn!.test(String(v)))) {
        throw new Error('injected failure');
      }
      const r = await db.query(text.replace(/\bINDEX\s+ASYNC\b/i, 'INDEX'), values);
      return { ...r, rowCount: r.affectedRows };
    },
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FIRST_CAPTURE = '2026-08-11';
const LAST_DAY = '2026-08-12';
/** A steady quote per ref; the import divides the tracker's value by the run's divisor. */
const SELL: Record<string, string> = {
  'inzhur-energy': '5837.3895',
  UA4000238976: '1000.00',
  UA4000236475: '1052.25',
  'inzhur-reit': '11.0000',
};
/** REIT's checked holdings each need an observed quote inside them, copied before the capture. */
const REIT_OBSERVED = ['2026-05-08', '2026-05-11', '2026-07-28'];

const firstDay = (ref: string) => DERIVED_SELL_RUNS.find((r) => r.ref === ref)!.holdings[0].from;
/** The last day a ref is derived on: the span's end, less its excluded and observed days. */
const lastDerived = (ref: string) => {
  const run = DERIVED_SELL_RUNS.find((r) => r.ref === ref)!;
  let d = addDays(FIRST_CAPTURE, -1);
  while (run.exclude.includes(d) || (ref === 'inzhur-reit' && REIT_OBSERVED.includes(d)))
    d = addDays(d, -1);
  return d;
};

const serial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 864e5;
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cell = (ref: string, v: string | number) =>
  typeof v === 'number'
    ? `<c r="${ref}"><v>${v}</v></c>`
    : `<c r="${ref}" t="str"><v>${escape(v)}</v></c>`;
const sheetXml = (lines: (string | number)[][]) =>
  '<worksheet><sheetData>' +
  lines
    .map(
      (line, i) =>
        `<row r="${i + 1}">` +
        line.map((v, c) => cell(`${String.fromCharCode(65 + c)}${i + 1}`, v)).join('') +
        '</row>',
    )
    .join('') +
  '</sheetData></worksheet>';

/** The tracker as base64, each ref valued at its holding's divisor × its quote from its start on. */
function tracker(): string {
  const quotes: (string | number)[][] = [['Дата зрізу', 'Актив', 'Поточна ціна']];
  for (const run of DERIVED_SELL_RUNS) {
    for (let d = run.holdings[0].from; d <= LAST_DAY; d = addDays(d, 1)) {
      // In ten-thousandths, so the kopeck rounding is the tracker's and not a float's.
      const units = divisorOn(run.ref, d)! * Math.round(Number(SELL[run.ref]) * 1e4);
      quotes.push([serial(d), run.asset, Math.round(units / 100) / 100]);
    }
    // Every excluded day must be one the tracker holds; past `LAST_DAY` its value decides nothing.
    for (const d of run.exclude.filter((day) => day > LAST_DAY)) {
      quotes.push([serial(d), run.asset, 1]);
    }
  }
  const operations = [
    ['Дата', 'Актив', 'Тип операції'],
    ...DERIVED_SELL_RUNS.flatMap((run) =>
      run.holdings.map((h) => [serial(h.from), run.asset, 'Купівля']),
    ),
  ];
  const bytes = zipOf({
    'xl/workbook.xml':
      '<workbook><sheets><sheet name="Котирування" r:id="rId1"/><sheet name="Транзакції" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml(quotes),
    'xl/worksheets/sheet2.xml': sheetXml(operations),
  });
  return Buffer.from(bytes).toString('base64');
}

const observe = (
  asOf: string,
  ref: string,
  basis: string,
  source: string,
  price: string,
  parserVersion: string,
) =>
  db.query(
    `INSERT INTO price_observation
       (as_of, instrument_ref, basis, source, price, observed_at, parser_version)
     VALUES ($1, $2, $3, $4, $5, now(), $6)`,
    [asOf, ref, basis, source, price, parserVersion],
  );

/** The schema from `ensureSchema` itself, then the captured era: two days of `sell` per ref, and
 *  REIT's copied quotes inside its checked holdings. */
async function archive() {
  await handler({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });
  for (const run of DERIVED_SELL_RUNS) {
    await observe(FIRST_CAPTURE, run.ref, 'sell', 'inzhur', SELL[run.ref], '1');
    await observe(LAST_DAY, run.ref, 'sell', 'inzhur', SELL[run.ref], '2');
  }
  for (const d of REIT_OBSERVED) {
    await observe(d, 'inzhur-reit', 'sell', 'inzhur', SELL['inzhur-reit'], 'wayback-1');
  }
}

const rows = async (where = 'true', values: unknown[] = []) =>
  (
    await db.query<{ row: string }>(
      `SELECT concat_ws(' ', to_char(as_of, 'YYYY-MM-DD'), instrument_ref, basis, source,
                        price::text, parser_version) AS row
         FROM price_observation WHERE ${where} ORDER BY 1`,
      values,
    )
  ).rows.map((r) => r.row);

const run = (workbook = tracker()) => handler({ importDerivedSell: { workbook } });

describe('importDerivedSell', () => {
  it('writes each ref from its first holding to the day before the capture start, and no observed day', async () => {
    await archive();
    const captured = await rows();
    const result = await run();

    for (const r of DERIVED_SELL_RUNS) {
      const derived = await rows('instrument_ref = $1 AND parser_version = $2', [
        r.ref,
        DERIVED_SELL_PARSER_VERSION,
      ]);
      expect(derived[0].startsWith(firstDay(r.ref)), r.ref).toBe(true);
      expect(derived.at(-1)!.startsWith(lastDerived(r.ref)), r.ref).toBe(true);
      // A copied quote keeps its day.
      if (r.ref === 'inzhur-reit') {
        expect(derived.some((d) => REIT_OBSERVED.some((day) => d.startsWith(day)))).toBe(false);
      }
      expect(
        derived.some((d) => r.exclude.some((day) => d.startsWith(day))),
        r.ref,
      ).toBe(false);
      expect(
        derived.every((d) => d.includes(` ${r.ref} sell inzhur `)),
        r.ref,
      ).toBe(true);
    }
    expect(await rows(`parser_version <> $1`, [DERIVED_SELL_PARSER_VERSION])).toEqual(captured);
    expect(result).toMatchObject({ mode: 'importDerivedSell', parserVersion: 'derived-sell-2' });
  });

  it('echoes each run’s holdings and exclusions, and counts what it wrote', async () => {
    await archive();
    type Stated = { from: string; divisor: number; unchecked?: boolean };
    const result = (await run()) as unknown as {
      refs: (Record<string, unknown> & { holdings: Stated[] })[];
    };
    const derived = await rows(`parser_version = $1`, [DERIVED_SELL_PARSER_VERSION]);
    const stated = (h: Stated) => [h.from, h.divisor, h.unchecked === true];
    expect(result.refs.map((r) => [r.ref, r.holdings.map(stated), r.exclude])).toEqual(
      DERIVED_SELL_RUNS.map((r) => [r.ref, r.holdings.map(stated), r.exclude]),
    );
    for (const r of result.refs) {
      expect(r.written, String(r.ref)).toBe(r.rows);
    }
    expect(result.refs.reduce((n, r) => n + Number(r.written), 0)).toBe(derived.length);
  });

  it('writes nothing the second time', async () => {
    await archive();
    await run();
    const after = await rows();
    const second = (await run()) as { refs: { written: number; rows: number }[] };
    expect(second.refs.map((r) => r.written)).toEqual([0, 0, 0, 0]);
    expect(second.refs.every((r) => r.rows > 0)).toBe(true);
    expect(await rows()).toEqual(after);
  });

  it('leaves a row of another basis on the same instrument and day as it was', async () => {
    await archive();
    await observe('2026-06-01', 'inzhur-energy', 'nav', 'inzhur', '5780.1234', 'fund-history-1');
    await observe('2026-06-01', 'UA4000236475', 'fair', 'nbu_fv', '1049.876543', '1');
    const before = await rows(`basis IN ('nav', 'fair')`);
    await run();
    expect(await rows(`basis IN ('nav', 'fair')`)).toEqual(before);
    expect((await rows(`as_of = '2026-06-01' AND basis = 'sell'`)).sort()).toEqual([
      '2026-06-01 UA4000236475 sell inzhur 1052.25 derived-sell-2',
      '2026-06-01 UA4000238976 sell inzhur 1000.00 derived-sell-2',
      '2026-06-01 inzhur-energy sell inzhur 5837.3900 derived-sell-2',
      '2026-06-01 inzhur-reit sell inzhur 11.0000 derived-sell-2',
    ]);
  });

  it('marks its rows apart from the feed, the offer page, the history file, a copy and its own first version', async () => {
    await archive();
    await observe('2026-06-01', 'inzhur-energy', 'nav', 'inzhur', '5780.1234', 'fund-history-1');
    await run();
    // A row the first version wrote, outside this run's span.
    await observe('2026-04-10', 'inzhur-energy', 'sell', 'inzhur', '5800.0000', 'derived-sell-1');
    const versions = await db.query<{ parser_version: string; basis: string; first: string }>(
      `SELECT parser_version, min(basis) AS basis, to_char(min(as_of), 'YYYY-MM-DD') AS first
         FROM price_observation GROUP BY parser_version ORDER BY parser_version`,
    );
    expect(versions.rows).toEqual([
      { parser_version: '1', basis: 'sell', first: FIRST_CAPTURE },
      { parser_version: '2', basis: 'sell', first: LAST_DAY },
      { parser_version: 'derived-sell-1', basis: 'sell', first: '2026-04-10' },
      { parser_version: 'derived-sell-2', basis: 'sell', first: '2026-04-23' },
      { parser_version: 'fund-history-1', basis: 'nav', first: '2026-06-01' },
      { parser_version: 'wayback-1', basis: 'sell', first: '2026-05-08' },
    ]);
  });

  it('keeps the first version’s rows and writes nothing over them, deriving only what is new', async () => {
    await archive();
    await run();
    // As #466 left them: the three refs' rows under the first version.
    await db.query(
      `UPDATE price_observation SET parser_version = 'derived-sell-1'
        WHERE parser_version = 'derived-sell-2' AND instrument_ref <> 'inzhur-reit'`,
    );
    const before = await rows();
    const second = (await run()) as { refs: { ref: string; written: number }[] };
    expect(second.refs.map((r) => r.written)).toEqual([0, 0, 0, 0]);
    expect(await rows()).toEqual(before);
  });

  it('checks a holding against a copied quote inside the span, and leaves that day and the span’s end as they were', async () => {
    await archive();
    await observe(
      '2026-05-10',
      'inzhur-energy',
      'sell',
      'inzhur',
      SELL['inzhur-energy'],
      'wayback-1',
    );
    await run();
    expect(await rows(`as_of = '2026-05-10' AND instrument_ref = 'inzhur-energy'`)).toEqual([
      '2026-05-10 inzhur-energy sell inzhur 5837.3895 wayback-1',
    ]);
    expect(
      (await rows(`instrument_ref = 'inzhur-energy' AND parser_version = 'derived-sell-2'`)).at(-1),
    ).toMatch(/^2026-08-10 /);
  });

  it('refuses a holding a copied quote inside the span disagrees with, writing nothing', async () => {
    await archive();
    await observe('2026-05-10', 'inzhur-energy', 'sell', 'inzhur', '5837.4000', 'wayback-1');
    const before = await rows();
    await expect(run()).rejects.toThrow(
      /inzhur-energy from 2026-05-08 ÷9: does not reproduce the observed sell on 2026-05-10/,
    );
    expect(await rows()).toEqual(before);
  });

  it('writes no ref when a write fails partway, the earlier refs included', async () => {
    await archive();
    const before = await rows();
    // The last run's rows go last, so every ref before it was already inserted.
    failOn = /^inzhur-reit$/;
    await expect(run()).rejects.toThrow('injected failure');
    failOn = undefined;
    expect(await rows()).toEqual(before);
  });

  it('refuses a ref the first captures skipped, whose payloads a replay may still observe', async () => {
    await archive();
    await db.query(
      `DELETE FROM price_observation WHERE instrument_ref = 'UA4000238976' AND as_of = $1`,
      [FIRST_CAPTURE],
    );
    const before = await rows();
    await expect(run()).rejects.toThrow(
      'UA4000238976: first captured sell on 2026-08-12 is after the capture start 2026-08-11',
    );
    expect(await rows()).toEqual(before);
  });

  it('writes no ref when the plan refuses one', async () => {
    await archive();
    await db.query(`DELETE FROM price_observation WHERE instrument_ref = 'UA4000238976'`);
    const before = await rows();
    await expect(run()).rejects.toThrow(/UA4000238976: no captured sell/);
    expect(await rows()).toEqual(before);
  });
});
