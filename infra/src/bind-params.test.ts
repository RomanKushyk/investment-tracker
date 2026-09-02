import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// EVERY `client.query` MUST BIND AS MANY PARAMETERS AS ITS SQL HAS PLACEHOLDERS.
//
// This is a guard bought with a live failure. W4 added a fourth parameter to
// `NEWEST_CAPTURE_PER_DATE` and the edit that updated its call sites hit the
// wrong one: a neighbouring three-placeholder query in `diagnose` was given
// four arguments, and the shared statement's own open-range EXPLAIN was left at
// three. The result was `bind message supplies 4 parameters, but prepared
// statement requires 3` — from the LIVE Lambda, after the branch had merged and
// deployed.
//
// NOTHING ELSE CAN CATCH IT. TypeScript does not count placeholders inside a
// template literal, `pnpm test` has no cluster, and `diagnose` is reached only
// by an explicit `{diagnose:true}` event, so no scheduled run exercises it. The
// defect therefore survives all five gates and appears the first time an
// operator asks the archive how it is doing — which is exactly when a
// diagnostic must not be the broken thing.
//
// SOURCE TEXT, like `order-by-alias.test.ts` beside it and for the same reason:
// the mistake type-checks and the code path needs AWS to run.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'capture.ts'), 'utf8');

/** Highest `$n` in a SQL string. `$1` alone means one parameter is expected. */
function placeholders(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * How many top-level arguments a literal array's inner text holds.
 *
 * COMMENTS AND TRAILING COMMAS BOTH LIE, and both were found by this guard
 * failing on correct code before it ever saw the real defect. Argument arrays
 * here carry explanatory comments containing commas, and prettier puts a
 * trailing comma on every multi-line array. A guard that reports a defect which
 * is not there is worse than none: it teaches the next reader to disbelieve it.
 *
 * DEPTH-AWARE, because an argument may itself be a call with commas in it —
 * `addDays(today, -OBSERVE_WINDOW_DAYS)` is one argument, not two.
 */
function argCount(inner: string): number {
  const bare = inner
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim()
    .replace(/,$/, '');
  if (bare === '') return 0;
  let depth = 0;
  let args = 1;
  for (const c of bare) {
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) args += 1;
  }
  return args;
}

/**
 * Every `client.query(...)` whose SQL and argument array are both literal.
 *
 * THE SQL IS MATCHED WITH A NEGATED BACKTICK CLASS, NOT A LAZY ANY-CHAR, and
 * that difference is the whole guard. A template literal body cannot contain an
 * unescaped backtick, so ``([^`]*)`` ends at its own closing tick. A lazy
 * `[\s\S]*?` does not: on a call that binds NO parameters it runs past that
 * call's closing paren and pairs its SQL with the NEXT call's argument array.
 *
 * THE FIRST VERSION OF THIS FILE DID EXACTLY THAT, then treated the mis-paired
 * match as suspicious and skipped it — which silently dropped the very call the
 * live defect was in. The guard passed on the broken source it was written for,
 * and a review caught it rather than a test. That is also where the "measured"
 * count of 7 came from: an artifact of the dropped calls, written into a
 * docblock that invited the next reader to trust it.
 */
function literalCalls(): { sql: string; args: number; at: number }[] {
  const out: { sql: string; args: number; at: number }[] = [];
  for (const m of source.matchAll(
    /client\.query(?:<[^>]*>)?\(\s*`([^`]*)`\s*,\s*\[([\s\S]*?)\]\s*,?\s*\)/g,
  )) {
    const sql = m[1];
    // INTERPOLATED SQL IS SKIPPED HERE, not resolved. `EXPLAIN (…)
    // ${NEWEST_CAPTURE_PER_DATE}` carries no `$n` of its own, so counting its
    // literal text reports zero placeholders against four bound arguments — a
    // false positive on correct code. Those sites are covered by the
    // shared-statement test below, which reads the constant's own text.
    if (sql.includes('${')) continue;
    const args = argCount(m[2]);
    if (args === 0) continue;
    out.push({ sql, args, at: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('every literal client.query binds what its SQL asks for', () => {
  const calls = literalCalls();

  it('finds the calls at all, so an empty pass cannot look green', () => {
    // A FLOOR, so adding a query does not fail it. What it catches is the call
    // SHAPE changing — a helper, a different client, a rename — which would
    // otherwise leave every assertion below iterating over nothing and
    // reporting green. The number is re-derived from the file rather than
    // remembered, because the last one written here was wrong.
    expect(calls.length).toBeGreaterThanOrEqual(11);
  });

  it('matches placeholder count to argument count', () => {
    const wrong = calls
      .filter((c) => placeholders(c.sql) !== c.args)
      .map(
        (c) =>
          `capture.ts:${c.at}: SQL wants ${placeholders(c.sql)}, ${c.args} bound — ${c.sql
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 70)}`,
      );
    expect(wrong).toEqual([]);
  });

  it('holds for the SHARED statement too, at every call site', () => {
    // `NEWEST_CAPTURE_PER_DATE` is one string used by two observers and two
    // EXPLAINs — the arrangement that made the original defect possible, since
    // changing the constant obliges four call sites at once.
    const decl = source.match(/const NEWEST_CAPTURE_PER_DATE = `([^`]*)`;/);
    expect(decl).not.toBeNull();
    const wanted = placeholders(decl![1]);
    expect(wanted).toBeGreaterThan(0);

    const sites = [...source.matchAll(/NEWEST_CAPTURE_PER_DATE[^[\n]*(?:\n\s*)?\[([\s\S]*?)\]/g)];
    expect(sites.length).toBeGreaterThanOrEqual(4);
    for (const site of sites) expect(argCount(site[1])).toBe(wanted);
  });
});
