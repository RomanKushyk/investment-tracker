import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// `/transactions` and `/` are composed like `/payouts`, on the owner's instruction: the two
// screens read as a different product from the rest of the app.
//
// WHAT IS PINNED IS THAT THE THREE SCREENS USE ONE EXPRESSION rather than three that merely
// look alike — "like the other pages" is the requirement, and a second idiom is the defect
// this exists to remove. There is no arithmetic left to pin: an `fr` track has no basis and
// the collapse is a media query.
//
// Read from `/payouts` rather than restated here, so the day someone retunes it there, this
// fails instead of drifting.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
/**
 * COMMENTS STRIPPED BEFORE MATCHING: this bans the strings `@container` and `@min-[Npx]`
 * from three files, so writing the layout's own rationale into any of them — the natural
 * place for it — would turn the suite red with no behaviour change.
 *
 * Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 * alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
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
const PAYOUTS = stripTs(read('Payouts.tsx'), 'Payouts.tsx');
const TRANSACTIONS = stripTs(read('Transactions.tsx'), 'Transactions.tsx');
const QUOTES = stripTs(read('DailyQuotes.tsx'), 'DailyQuotes.tsx');
const PANEL = stripTs(read('TransactionPanel.tsx'), 'TransactionPanel.tsx');

/** The grid row's own class string, whichever file it is in. */
function gridRow(source: string): string {
  const m = source.match(/className="[^"]*\bgrid grid-cols-\[[^"]*"/);
  if (m === null) throw new Error('no `grid grid-cols-[…]` row in this screen');
  return m[0];
}

/** The ledger card's own class string, anchored by its ref. */
function ledgerCard(): string {
  const m = PANEL.match(/ref=\{ledgerRef\}[^>]*className="([^"]*)"/);
  if (m === null) throw new Error('no ledger Card (ref={ledgerRef}) in TransactionPanel');
  return m[1];
}

/** Anchored by `<Card>` AND its `bg-panel` surface, with the token standing alone so
 *  `hover:bg-panel` or `bg-panel/50` cannot retarget it.
 *
 *  `<Card` IS PART OF THE ANCHOR because a standalone `bg-panel` on a plain `<div>` earlier
 *  in the file once captured the match and reported that element's classes as the card's.
 *  Nothing collides today, and the anchor STAYS: what it pins is that the subject is the
 *  CARD rather than whatever else shares a surface token, and the next control to reach for
 *  `bg-panel` would recreate it. */
function formCard(): string {
  const m = PANEL.match(/<Card\b[^>]*className="([^"]*(?<![-:/\w])bg-panel(?![-/\w])[^"]*)"/);
  if (m === null) throw new Error('no form Card (bg-panel) in TransactionPanel');
  return m[1];
}

/** Read from `/payouts`' own row, the file's charter applied to the breakpoint too: if the
 *  collapse is retuned there, the pins below fail instead of drifting. */
function collapsePrefix(): string {
  const m = gridRow(PAYOUTS).match(/(max-[a-z0-9]+):grid-cols-1/);
  if (m === null) throw new Error('no collapse variant on `/payouts`’ grid row');
  return m[1];
}

describe('the three screens are composed by one expression', () => {
  it('takes `/payouts`’ own row, tracks, gap and collapse', () => {
    const reference = gridRow(PAYOUTS);
    // The reference itself, stated once so a reader sees what is being matched.
    expect(reference).toContain('grid-cols-[1.6fr_1fr]');
    expect(reference).toContain('items-start');
    expect(reference).toContain('gap-3.5');
    expect(reference).toContain('max-lg:grid-cols-1');

    for (const [name, source] of [
      ['/transactions', TRANSACTIONS],
      ['/', QUOTES],
    ] as const) {
      const row = gridRow(source);
      for (const part of [
        'grid-cols-[1.6fr_1fr]',
        'items-start',
        'gap-3.5',
        'max-lg:grid-cols-1',
      ]) {
        expect(row, `${name} lost \`${part}\``).toContain(part);
      }
    }
  });

  it('leaves nothing of the flex row behind on either screen', () => {
    // A leftover basis or container query DOES NOT ERROR, it silently stops applying — which
    // is how the ledger's tall scroll box was found at its phone height on a desktop.
    for (const source of [TRANSACTIONS, QUOTES, PANEL]) {
      expect(
        source,
        'a flex basis is left on a grid child, where it is inert rather than wrong',
      ).not.toMatch(/flex-\[1_1_\d+px\]/);
      expect(
        source,
        'a container query is left behind, and it has no container to resolve against',
      ).not.toMatch(/@min-\[\d+px\]/);
      expect(
        source,
        'the containment CONTEXT is left declared for a query that is gone',
      ).not.toMatch(/@container/);
    }
  });

  it('floors both `fr` children, which `/payouts` does not have to', () => {
    // An `fr` track FLOORS AT ITS CONTENT, and every child here carries an input or a scroll
    // box with a width of its own — unlike a chart, which shrinks. Anchored to the two cards
    // themselves: a prefix count was satisfied by truncating spans inside ledger rows and
    // never matched EITHER card.
    expect(
      ledgerCard(),
      'the ledger lost `min-w-0`, so the `fr` track floors at its scroll box',
    ).toContain('min-w-0');
    expect(formCard(), 'the form lost `min-w-0`, so the `fr` track floors at its inputs').toContain(
      'min-w-0',
    );
  });

  it('renders the form FIRST and places the ledger left, so both orders agree', () => {
    // Collapsed, THE COLUMN IS THE SEQUENCE, so the DOM owes it the form: ordering the form
    // visually while leaving the ledger first sends a keyboard through every row and delete
    // button before the field the user can see at the top (WCAG 2.4.3, 1.3.2).
    //
    // ANCHORED THROUGH `formCard()`, never `indexOf('bg-panel')` — the bare index is the
    // idiom that docblock calls out, and it resolved to a different element entirely, so this
    // assertion passed for years without ever looking at the form.
    const formAt = PANEL.indexOf(formCard());
    const ledgerAt = PANEL.indexOf('ref={ledgerRef}');
    expect(formAt, 'the form card is gone from the panel').toBeGreaterThan(-1);
    expect(
      ledgerAt,
      'the ledger comes first in the DOM, so collapsed a keyboard walks every row and ' +
        'delete button before the field the user can see at the top',
    ).toBeGreaterThan(formAt);
    // Beside each other the visual order is still ledger-left, PLACED rather than ORDERED:
    // `order` on a grid item moves it without moving its track.
    expect(PANEL).toMatch(/ref=\{ledgerRef\}[\s\S]*?lg:col-start-1/);
    expect(formCard()).toContain('lg:col-start-2');
    expect(PANEL).not.toContain('order-first');
  });

  it('keeps the ledger uncapped, and the form cap stacked-only', () => {
    // INSIDE AN `fr` TRACK THE TRACK IS THE BOUND, so a cap narrower than it opens a dead
    // strip between the columns — the wide-monitor row stretch is priced there. A width token
    // is anything keeping a card from filling its track: a cap, a fixed `w-[…]`, a
    // `basis-[…]`, under any variant. `min-w-*` floors stay legal, a floor being unable to
    // un-fill a track. Scoped to each card's OWN class string, so a future row-level content
    // max-width inside a card cannot false-fail it. *Forms and layout*
    const widthTokens = (card: string) =>
      card.split(/\s+/).filter((c) => /(^|:)(max-w|w|basis)-\[/.test(c));
    expect(
      widthTokens(ledgerCard()),
      'the ledger takes a width token, which opens a dead strip between the columns',
    ).toEqual([]);
    expect(
      widthTokens(formCard()),
      'the form cap is no longer stacked-only, so it bounds the card inside its own track too',
    ).toEqual([`${collapsePrefix()}:max-w-[560px]`]);
  });

  it('leaves no trailing margin on a grid that is the last element', () => {
    // `/payouts` needs its bottom margin because its log table follows. On both of these the
    // grid is LAST, and on `/transactions` that margin is not in the ledger's height formula,
    // so the page scrolled at a full ledger.
    for (const source of [TRANSACTIONS, QUOTES]) {
      expect(source).not.toMatch(/mb-3\.5 grid grid-cols-/);
    }
    expect(PAYOUTS).toMatch(/mb-3\.5 grid grid-cols-/);
  });

  it('floors the ledger height so a short viewport cannot collapse it to zero', () => {
    // A `max-height` calc that resolves negative is CLAMPED TO 0, not ignored. Keyed to the
    // collapse breakpoint, because the container query it used to ask has no container.
    const above = collapsePrefix().replace(/^max-/, '');
    expect(PANEL).toMatch(
      new RegExp(`(?<![-\\w])${above}:max-h-\\[max\\(200px,calc\\(100dvh-var\\(--ledger-top`),
    );
  });
});
