import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// THE GAP RECONCILIATION MEASURES ONLY DAYS THE SOURCE HAS CAPTURED.
//
// `diagnose` compares each observation group's distinct dates against the
// capture days for its source over the group's own span. The fund-history
// import writes rows from before the first capture, with nothing behind them,
// so a span that reached back to them read negative forever and a missing
// daily row could not surface. Bounding the span at the source's first
// capture day is what makes the comparison honest, and it holds however the
// rows got there: an imported row on a captured day is coverage, not a gap.
// Source text, like `bind-params.test.ts` beside it and for the same reason:
// the statement needs a cluster to run, and the defect is visible only there.
const source = readFileSync(new URL('./capture.ts', import.meta.url), 'utf8');

function statement(): string {
  const found = [
    ...source.matchAll(/`([^`]*GROUP BY o\.instrument_ref, o\.basis, o\.source[^`]*)`/g),
  ];
  // Exactly one, so a second grouped statement cannot be validated in its place.
  expect(found, 'one statement grouping price_observation by (ref, basis, source)').toHaveLength(1);
  return found[0][1];
}

describe('diagnose reconciles over the source’s captured days only', () => {
  it('takes each source’s first successful capture day', () => {
    expect(statement()).toMatch(
      /WITH captured AS \(\s*SELECT source, min\(as_of\) AS since\s+FROM price_capture\s+WHERE ok = true\s+GROUP BY source\)/,
    );
    expect(statement()).toMatch(/LEFT JOIN captured c ON c\.source = o\.source/);
  });

  it('conditions the distinct dates and both span bounds on that day', () => {
    const sql = statement();
    const conditioned = /CASE WHEN o\.as_of >= c\.since THEN o\.as_of END/g;
    expect(sql).toMatch(/count\(DISTINCT CASE WHEN o\.as_of >= c\.since THEN o\.as_of END\)/);
    expect(sql).toMatch(/min\(CASE WHEN o\.as_of >= c\.since THEN o\.as_of END\)/);
    expect(sql).toMatch(/max\(CASE WHEN o\.as_of >= c\.since THEN o\.as_of END\)/);
    expect(sql.match(conditioned)).toHaveLength(3);
  });

  it('still counts every row, and says how many and from when the archive holds before', () => {
    const sql = statement();
    expect(sql).toMatch(/count\(\*\)::text AS n/);
    expect(sql).toMatch(
      /CASE WHEN c\.since IS NULL OR o\.as_of < c\.since THEN 1 ELSE 0 END\)::text AS before_capture/,
    );
    expect(sql).toMatch(/to_char\(min\(o\.as_of\), 'YYYY-MM-DD'\) AS earliest_as_of/);
  });
});
