import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `/transactions` and `/` are composed like `/payouts` — the owner's instruction
// of 2026-08-25, which superseded both the flex row A35 shipped and the centred
// 944 the screen-density sheet drew for `/`. His reason outranks a drawing: the
// two screens read as a different product from the rest of the app.
//
// SO THIS FILE'S JOB CHANGED. It used to pin an arithmetic identity — the flex
// bases plus the gap had to equal the container query, or a wrapped form was
// stranded beside 590 px of nothing. There is no arithmetic left to pin: an `fr`
// track has no basis and the collapse is a media query. What has to be pinned
// instead is that the three screens use ONE expression rather than three that
// merely look alike, because "like the other pages" is now the requirement and a
// second idiom is the defect it exists to remove.
//
// Read from `/payouts` rather than restated here, so the day someone retunes it
// there, this fails instead of drifting.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
/**
 * COMMENTS STRIPPED BEFORE MATCHING, and the review that asked for it was right:
 * the first cut banned the strings `@container` and `@min-[Npx]` from the RAW
 * text of three files, so writing D88's own rationale into any of them — the
 * natural place for it — would have turned this suite red with no behaviour
 * change. `ledger-delete.test.ts` learned the same lesson from A47.
 */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');
const PAYOUTS = strip(read('Payouts.tsx'));
const TRANSACTIONS = strip(read('Transactions.tsx'));
const QUOTES = strip(read('DailyQuotes.tsx'));
const PANEL = strip(read('TransactionPanel.tsx'));

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

/** The form card's own class string, anchored by `<Card>` AND its `bg-panel`
 *  surface. The token must stand alone — `hover:bg-panel`, `bg-panel/50` or
 *  `bg-panel-muted` must not retarget the anchor.
 *
 *  `<Card` IS PART OF THE ANCHOR, and it was added after a standalone
 *  `bg-panel` on a plain `<div>` earlier in the file — the price-mode segment
 *  of #31, which takes the segmented-control surface every such control in this
 *  app has taken — captured the match and reported the segment's classes as
 *  the card's.
 *  Anchoring on the element, the way `ledgerCard` anchors on its ref, is what
 *  makes this specific; matching a bare class string means any later element
 *  that legitimately shares the surface silently becomes the subject. */
function formCard(): string {
  const m = PANEL.match(/<Card\b[^>]*className="([^"]*(?<![-:/\w])bg-panel(?![-/\w])[^"]*)"/);
  if (m === null) throw new Error('no form Card (bg-panel) in TransactionPanel');
  return m[1];
}

/** The collapse variant, read from `/payouts`' own row (`max-lg`) — the file's
 *  charter applied to the breakpoint too: if the collapse is ever retuned, the
 *  width and height pins below fail instead of drifting. */
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
    // A leftover basis or container query does not error — it silently stops
    // applying, which is how the ledger's tall scroll box was found sitting at
    // the phone's 420 on a desktop after this change.
    for (const source of [TRANSACTIONS, QUOTES, PANEL]) {
      expect(source).not.toMatch(/flex-\[1_1_\d+px\]/);
      expect(source).not.toMatch(/@min-\[\d+px\]/);
      expect(source).not.toMatch(/@container/);
    }
  });

  it('floors both `fr` children, which `/payouts` does not have to', () => {
    // An `fr` track floors at its content, and every child here carries an input
    // or a scroll box with a width of its own — unlike a chart, which shrinks.
    // Anchored to the two cards themselves: the old prefix count
    // (`className="min-w-0` >= 2) was satisfied by two truncating spans inside
    // ledger rows and never matched EITHER card, so removing the class from a
    // card kept the suite green while the fr track floored at its content.
    expect(ledgerCard()).toContain('min-w-0');
    expect(formCard()).toContain('min-w-0');
  });

  it('renders the form FIRST and places the ledger left, so both orders agree', () => {
    // Collapsed, the column IS the sequence, so the DOM owes it the form — the
    // first cut had the ledger first with `max-lg:order-first` on the form, which
    // sent a keyboard through 18 ledger rows and 18 delete buttons before the
    // field the user could see at the top (WCAG 2.4.3, 1.3.2).
    const formAt = PANEL.indexOf('bg-panel');
    const ledgerAt = PANEL.indexOf('ref={ledgerRef}');
    expect(formAt).toBeGreaterThan(-1);
    expect(ledgerAt).toBeGreaterThan(formAt);
    // Beside each other the visual order is still ledger-left, placed rather than
    // ordered — `order` on a grid item moves it without moving its track.
    expect(PANEL).toMatch(/ref=\{ledgerRef\}[\s\S]*?lg:col-start-1/);
    expect(PANEL).toMatch(/bg-panel[^"]*lg:col-start-2/);
    expect(PANEL).not.toContain('order-first');
  });

  it('keeps the ledger uncapped (D93) and the form cap stacked-only (D94)', () => {
    // D93 took the ledger's `max-w-[884px]` off: inside D88's `1.6fr` track the
    // TRACK is the bound, and a cap narrower than it opened a dead strip between
    // the columns — the wide-monitor row stretch is priced there. D94 made the
    // same call for the form: the 560 guards only the stacked column.
    //
    // A width token is anything that keeps a card from filling its track — a
    // cap, a fixed `w-[…]`, a `basis-[…]`, under any variant; `min-w-*` floors
    // stay legal (a floor cannot un-fill a track). Token-list equality, so a
    // failure prints exactly which tokens appeared; scoped to each card's OWN
    // class string, so a future row-level content max-width inside a card (the
    // fix D93 itself sanctions) cannot false-fail it.
    const widthTokens = (card: string) =>
      card.split(/\s+/).filter((c) => /(^|:)(max-w|w|basis)-\[/.test(c));
    expect(widthTokens(ledgerCard())).toEqual([]);
    expect(widthTokens(formCard())).toEqual([`${collapsePrefix()}:max-w-[560px]`]);
  });

  it('leaves no trailing margin on a grid that is the last element', () => {
    // `/payouts` needs its `mb-3.5` — its log table follows. On both of these the
    // grid is last, and on `/transactions` those 14 px are not in the ledger's
    // height formula, so the page scrolled at a full ledger.
    for (const source of [TRANSACTIONS, QUOTES]) {
      expect(source).not.toMatch(/mb-3\.5 grid grid-cols-/);
    }
    expect(PAYOUTS).toMatch(/mb-3\.5 grid grid-cols-/);
  });

  it('floors the ledger height so a short viewport cannot collapse it to zero', () => {
    // A `max-height` calc that resolves negative is clamped to 0, not ignored.
    // Keyed to the collapse breakpoint (read from `/payouts`, not restated):
    // the container query it used to ask has no container.
    const above = collapsePrefix().replace(/^max-/, '');
    expect(PANEL).toMatch(
      new RegExp(`(?<![-\\w])${above}:max-h-\\[max\\(200px,calc\\(100dvh-var\\(--ledger-top`),
    );
  });
});
