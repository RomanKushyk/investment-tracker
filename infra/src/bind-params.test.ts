import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Nothing else catches a placeholder/argument mismatch: TypeScript does not
// count `$n` inside a template literal, `pnpm test` has no cluster, and
// `diagnose` is reached only by an explicit event.
const here = dirname(fileURLToPath(import.meta.url));

/** `capture.ts` is read through this, once, so a commented-out call is no call. LINE BY LINE,
 *  and the line boundary is the point: a regex literal may hold a quote, and one desync would
 *  switch stripping off for the rest of the file.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a commented-out `client.query(\`SELECT $1, $2\`, [a])` leaves this green
 *  and turns the reader it replaces red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

const source = stripTs(readFileSync(join(here, 'capture.ts'), 'utf8'));

/** Highest `$n` in a SQL string. `$1` alone means one parameter is expected. */
function placeholders(sql: string): number {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Top-level arguments in a literal array's inner text. The reader leaves a comment on the line
 * that closes a multi-line template, taking its backtick for an opening one, so comments are
 * dropped here too. A string may hold a comma or a `//`, so quoted text is stepped over whole; a
 * trailing comma lies; and an argument may itself be a call with commas in it.
 */
function argCount(inner: string): number {
  let code = '';
  let quote = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      code += c;
      if (c === '\\') code += inner[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '/' && inner[i + 1] === '/') {
      while (i + 1 < inner.length && inner[i + 1] !== '\n') i++;
    } else if (c === '/' && inner[i + 1] === '*') {
      const end = inner.indexOf('*/', i + 2);
      i = end === -1 ? inner.length : end + 1;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      code += c;
    }
  }
  const bare = code.trim().replace(/,$/, '');
  if (bare === '') return 0;
  let depth = 0;
  let args = 1;
  quote = '';
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) args += 1;
  }
  return args;
}

/**
 * Every `client.query(...)` whose SQL and argument array are both literal. A
 * NEGATED BACKTICK CLASS, NEVER A LAZY ANY-CHAR: ``([^`]*)`` ends at its own
 * closing tick, where a lazy `[\s\S]*?` runs past a no-parameter call's closing
 * paren and pairs its SQL with the NEXT call's argument array. The array ends at
 * the first `]` that an optional comma and `)` follow, so a string argument
 * holding `])` would cut it short.
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

describe('argCount reads an argument list, strings and all', () => {
  it('counts past a `//` inside a string argument', () => {
    expect(argCount(`'https://quirenote.com', id`)).toBe(2);
  });

  it('counts past a comma inside a string argument', () => {
    expect(argCount(`'a, b', id`)).toBe(2);
  });

  it('counts past a comment the reader left on the line closing a multi-line template', () => {
    expect(argCount(`a, // was a, b\n`)).toBe(1);
  });
});

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
