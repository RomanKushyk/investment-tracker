import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Nothing else catches a placeholder/argument mismatch: TypeScript does not
// count `$n` inside a template literal, `pnpm test` has no cluster, and
// `diagnose` is reached only by an explicit event.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'capture.ts'), 'utf8');

/** Highest `$n` in a SQL string. `$1` alone means one parameter is expected. */
function placeholders(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Top-level arguments in a literal array's inner text. Comments and trailing
 * commas both lie, and an argument may itself be a call with commas in it.
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
 * Every `client.query(...)` whose SQL and argument array are both literal. A
 * NEGATED BACKTICK CLASS, NEVER A LAZY ANY-CHAR: ``([^`]*)`` ends at its own
 * closing tick, where a lazy `[\s\S]*?` runs past a no-parameter call's closing
 * paren and pairs its SQL with the NEXT call's argument array.
 */
function literalCalls(): { sql: string; args: number; at: number }[] {
  const out: { sql: string; args: number; at: number }[] = [];
  for (const m of source.matchAll(
    /client\.query(?:<[^>]*>)?\(\s*`([^`]*)`\s*,\s*\[([\s\S]*?)\]\s*,?\s*\)/g,
  )) {
    const sql = m[1];
    // Interpolated SQL is skipped, not resolved: it carries no `$n` of its own,
    // so its literal text reports zero against four bound arguments.
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
    // A FLOOR here, where `order-by-alias.test.ts`'s is exact: what it catches
    // is the call SHAPE changing, which leaves every assertion below green.
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
    // One string, two observers and two EXPLAINs: changing it obliges four sites.
    const decl = source.match(/const NEWEST_CAPTURE_PER_DATE = `([^`]*)`;/);
    expect(decl).not.toBeNull();
    const wanted = placeholders(decl![1]);
    expect(wanted).toBeGreaterThan(0);

    const sites = [...source.matchAll(/NEWEST_CAPTURE_PER_DATE[^[\n]*(?:\n\s*)?\[([\s\S]*?)\]/g)];
    expect(sites.length).toBeGreaterThanOrEqual(4);
    for (const site of sites) expect(argCount(site[1])).toBe(wanted);
  });
});
