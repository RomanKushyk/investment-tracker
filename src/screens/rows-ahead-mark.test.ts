import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CHIP_EXIT_MS } from '../hooks/useRowsAhead';

// The panel's wiring to `useRowsAhead`, read from source: jsdom loads no CSS and cannot say which
// of the two placements of `design/extensions/rows-ahead-mark.dc.html` shows.
const here = dirname(fileURLToPath(import.meta.url));

/** Comments stripped before matching, since the prose beside the row names the classes it argues
 *  for; copied rather than imported, as every guard's reader is. */
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
const PANEL = stripTs(
  readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8'),
  'TransactionPanel.tsx',
);

/** Every class of a class string, so the Tailwind plugin's ordering cannot fail a check. */
const classes = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

function chipComponent(): string {
  // To the brace that closes the body: the props type's own `}: {` also starts a line.
  const found = PANEL.match(/function AheadChip\([\s\S]*?\r?\n\}(?=\r?\n|$)/);
  expect(found, 'the chip is no longer one component in the panel').not.toBeNull();
  return found![0];
}

describe('the rows-ahead mark on the ledger', () => {
  it('reads the clock once for the whole ledger, and decides each row by its own date', () => {
    expect(PANEL.match(/useRowsAhead\(\)/g)).toHaveLength(1);
    expect(PANEL).toMatch(/const ahead = rowAhead\(tx\.date, rows\.mark, rows\.today\);/);
  });

  it('paints the quote row’s micro-chip in info, with no motion of its own on mount', () => {
    const chip = chipComponent();
    const paint = chip.match(/className=\{`([^`]*)`\}/);
    expect(paint, 'the chip lost its class string').not.toBeNull();
    const cls = classes(paint![1]);
    for (const c of [
      'rounded-[5px]',
      'px-2',
      'py-[2px]',
      'text-[10px]',
      'font-bold',
      'tracking-[.08em]',
      'uppercase',
      // A larger text size would otherwise wrap the words onto a second, clipped line.
      'whitespace-nowrap',
      'bg-info-tint',
      'text-info-tint-text',
      'transition-[opacity,visibility]',
      // The fade ends when the unmount timer fires, neither earlier nor later.
      `duration-${CHIP_EXIT_MS}`,
      'ease-soft',
    ]) {
      expect(cls, c).toContain(c);
    }
    // «Ні» brings line 1 back with the chip on it, and the chip has no entrance of its own.
    expect(chip).not.toMatch(/animate-in|zoom-in|fade-in/);
    // Fading out, it leaves the accessibility tree with its opacity, as SignedOutNote's words do.
    expect(chip).toMatch(/state === 'out' \? 'invisible opacity-0' : ''/);
    expect(chip).toContain('{t.transaction.ahead}');
    expect(chip).toContain('title={t.transaction.aheadTitle(f.date(date))}');
  });

  it('puts the chip right after the label’s text from xl, and on its own line below', () => {
    const chips = PANEL.match(/<AheadChip[^>]*\/>/g) ?? [];
    expect(chips).toHaveLength(2);

    const wide = chips.find((c) => c.includes('state={ahead.wide}'));
    expect(wide, 'no chip follows the label').toBeDefined();
    const wideClass = wide!.match(/className="([^"]*)"/);
    expect(wideClass).not.toBeNull();
    for (const c of ['hidden', 'flex-none', 'xl:block'])
      expect(classes(wideClass![1])).toContain(c);
    expect(PANEL).toMatch(/\{ahead\.wide && \(?\s*<AheadChip/);

    // Label and chip share the flexible box; the label shrinks and keeps its ellipsis.
    const box = PANEL.indexOf('<span className="flex min-w-0 flex-1 items-center gap-2.5">');
    expect(box, 'the label box is gone').toBeGreaterThan(0);
    const label = PANEL.indexOf('<span className="min-w-0 truncate">', box);
    const wideAt = PANEL.indexOf(wide!, box);
    expect(label).toBeGreaterThan(box);
    expect(wideAt).toBeGreaterThan(label);
    expect(wideAt).toBeLessThan(PANEL.indexOf('movesPosition(tx.type) &&', box));

    const narrow = chips.find((c) => c.includes('state={ahead.narrow}'));
    expect(narrow, 'no chip has a line of its own').toBeDefined();
    expect(PANEL).toMatch(/\{ahead\.narrow && <AheadChip/);
  });

  it('folds the narrow line as the sidebar folds, held at its height and inert while shut', () => {
    const foldAt = PANEL.indexOf('transition-[grid-template-rows]');
    expect(foldAt, 'the chip line no longer folds').toBeGreaterThan(0);
    const gate = PANEL.lastIndexOf('{!asking && (', foldAt);
    expect(foldAt - gate, 'the chip line is not gated on the row not asking').toBeLessThan(120);
    const fold = PANEL.slice(gate, PANEL.indexOf('state={ahead.narrow}', foldAt));

    const outer = fold.match(/className=\{`([^`]*)`\}/);
    expect(outer).not.toBeNull();
    for (const c of ['grid', 'transition-[grid-template-rows]', 'ease-soft', 'xl:hidden']) {
      expect(classes(outer![1]), c).toContain(c);
    }
    const rows = fold.match(/ahead\.open\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/);
    expect(rows, 'the fold no longer turns on the row’s line').not.toBeNull();
    for (const c of ['grid-rows-[1fr]', 'duration-300']) expect(classes(rows![1])).toContain(c);
    for (const c of ['grid-rows-[0fr]', `duration-${CHIP_EXIT_MS}`]) {
      expect(classes(rows![2])).toContain(c);
    }

    expect(fold).toMatch(/inert=\{!ahead\.open \|\| undefined\}/);
    // A padding on the clipping box would leak into every row's height while the line is shut.
    const clip = fold.match(/className="([^"]*\bmin-h-0\b[^"]*)"/);
    expect(clip).not.toBeNull();
    expect(classes(clip![1])).toContain('overflow-hidden');
    expect(clip![1]).not.toMatch(/(^|\s)p[trblxy]?-/);
    // A held line keeps its height once its chip has gone, so no row rises under the pointer; a
    // minimum, so a larger text size grows the line rather than clipping the chip.
    const line = fold.match(/className="([^"]*min-h-\[21px\][^"]*)"/);
    expect(line).not.toBeNull();
    for (const c of ['flex', 'min-h-[21px]', 'pt-0.5']) expect(classes(line![1])).toContain(c);
  });

  it('sets the chip line before the withholding and the note', () => {
    const foldAt = PANEL.indexOf('transition-[grid-template-rows]');
    expect(foldAt).toBeGreaterThan(0);
    expect(foldAt).toBeLessThan(PANEL.indexOf('tx.taxWithheld !== undefined && ('));
    expect(foldAt).toBeLessThan(PANEL.indexOf('tx.note !== undefined && ('));
  });

  it('sets the amount at normal weight while the row is ahead, by the cue each width shows', () => {
    const strong = PANEL.match(/<strong\s+className=\{`[^`]*`\}\s*>/);
    expect(strong, 'the amount no longer turns on the row').not.toBeNull();
    expect(strong![0]).toContain('whitespace-nowrap');
    expect(strong![0]).toMatch(/ahead\.narrow === 'in' \? 'max-xl:font-normal' : ''/);
    expect(strong![0]).toMatch(/ahead\.wide === 'in' \? 'xl:font-normal' : ''/);
  });

  it('tells the clock where the pointer is, on the whole ledger card', () => {
    const card = PANEL.match(/<Card\s+ref=\{ledgerRef\}[^>]*>/);
    expect(card).not.toBeNull();
    expect(card![0]).toContain('onPointerEnter={rows.enter}');
    // A pointer resting on the card when it mounts fires no enter until it moves.
    expect(card![0]).toContain('onPointerMove={rows.enter}');
    expect(card![0]).toContain('onPointerLeave={rows.leave}');
  });
});
