import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A PAYOUT TYPE IS NOT AN ASSET. Dividends and coupons paint from their own token families, so
// re-valuing an asset's colour leaves /payouts alone (`palette.md`, «Decoupled, values kept»).
// `palette-mirror.test.ts` holds the families' values; this file holds which names the payout
// surfaces read, which no value test can see while the two families still equal the assets.
//
// SOURCE TEXT, the house idiom: this file runs in the suite's `node` environment.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** The comments in these files name the asset keys they moved off, so an unstripped match is
 *  failed by prose about a key instead of a read of it.
 *
 *  Copied SIGNATURE AND ALL rather than imported:
 *  `ts-reader-census.test.ts` holds every copy to one text. */
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

const ASSET_PAINT = /\breit\b|\bovdp8976\b|\bSERIES\b/;
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe('/payouts paints a payout type from its own tokens', () => {
  const payouts = stripTs(read('screens/Payouts.tsx'), 'screens/Payouts.tsx');

  it('reads no asset key', () => {
    expect(payouts).not.toMatch(ASSET_PAINT);
  });

  it('tags each row with its type’s key', () => {
    expect(payouts).toMatch(/'dividend_accrual'\s*\?\s*'payout-dividend'\s*:\s*'payout-coupon'/);
  });

  it('fills each legend square from its type', () => {
    expect(count(payouts, /\bbg-payout-dividend\b/g)).toBe(1);
    expect(count(payouts, /\bbg-payout-coupon\b/g)).toBe(1);
  });
});

describe('the payout bars fill from the payout chart aliases', () => {
  const bars = stripTs(
    read('components/charts/PayoutsBars.tsx'),
    'components/charts/PayoutsBars.tsx',
  );

  it('reads no asset key', () => {
    expect(bars).not.toMatch(ASSET_PAINT);
  });

  it('fills each bar from its type', () => {
    expect(count(bars, /fill=\{PAYOUT\.dividend\}/g)).toBe(1);
    expect(count(bars, /fill=\{PAYOUT\.coupon\}/g)).toBe(1);
  });

  it('gives `PAYOUT` the two chart aliases', () => {
    const colors = stripTs(
      read('../packages/core/src/colors.ts'),
      '../packages/core/src/colors.ts',
    );
    expect(colors).toMatch(/\bdividend:\s*'var\(--color-chart-payout-dividend\)'/);
    expect(colors).toMatch(/\bcoupon:\s*'var\(--color-chart-payout-coupon\)'/);
  });
});

describe('the payouts placeholder’s legend reads the payout tokens', () => {
  // Scoped to the one placeholder: the others in the file paint assets, which is right for them.
  const placeholder = (() => {
    const source = stripTs(read('screens/placeholders.tsx'), 'screens/placeholders.tsx');
    const at = source.indexOf('export function PayoutsPlaceholder(');
    expect(at, '`PayoutsPlaceholder` is no longer declared as it was').toBeGreaterThan(-1);
    const next = source.indexOf('export function ', at + 1);
    return source.slice(at, next === -1 ? undefined : next);
  })();

  it('reads no asset key', () => {
    expect(placeholder).not.toMatch(ASSET_PAINT);
  });

  it('fills each legend square from its type', () => {
    expect(count(placeholder, /\bbg-payout-dividend\b/g)).toBe(1);
    expect(count(placeholder, /\bbg-payout-coupon\b/g)).toBe(1);
  });
});

describe('`Tag` carries the payout variants', () => {
  it('maps each to its own family’s tint and tint text', () => {
    const tag = stripTs(read('components/ui/Tag.tsx'), 'components/ui/Tag.tsx');
    expect(tag).toContain(
      "'payout-dividend': 'bg-payout-dividend-tint text-payout-dividend-tint-text'",
    );
    expect(tag).toContain("'payout-coupon': 'bg-payout-coupon-tint text-payout-coupon-tint-text'");
  });
});
