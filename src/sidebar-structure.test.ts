import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE PANEL IS FOUR BANDS.
//
// WHICH RECIPE THE ROW PAINTS, where `sidebar-plane.test.ts` reads what the grounds MEASURE
// — neither catches the other, since the tokens can be perfect while the track is still one
// segment short or the thumb still travels half a track.
//
// Paths resolve from THIS file, not from `process.cwd()`.
const here = dirname(fileURLToPath(import.meta.url));

/** Not cosmetic — `Sidebar.tsx` argues the band in prose, so an unstripped read lets a comment
 *  answer for the markup.
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

const SIDEBAR = stripTs(readFileSync(join(here, 'app', 'Sidebar.tsx'), 'utf8'), 'Sidebar.tsx');

/** Each `<SegmentedControl />` here as its own props, `options` left out: they hold nested JSX,
 *  and an opening-tag regex stops at the first `=>` in a handler. */
function segmentedControls(): string[] {
  const sf = ts.createSourceFile(
    'Sidebar.tsx',
    SIDEBAR,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === 'SegmentedControl')
      found.push(
        node.attributes.properties
          .filter((a) => !(ts.isJsxAttribute(a) && a.name.getText(sf) === 'options'))
          .map((a) => a.getText(sf))
          .join(' '),
      );
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Every line carrying `re`, so a pin can say WHICH element wears a token and
 *  not merely that the file mentions it somewhere. */
const linesWith = (re: RegExp) => SIDEBAR.split('\n').filter((l) => re.test(l));

// ONE SURFACE: the floating panel is one glass card, so its foot is no band of its own
// (rail-and-account-foot.md § Signed, A2, and its renders; the owner's ruling on #719). A
// hairline says where the account begins, and another where «Ввід» ends.
describe('the panel is one surface, ruled by two hairlines', () => {
  it('paints no footer band and no capital strip', () => {
    expect(SIDEBAR, 'a footer band is still painted').not.toMatch(/\bbg-sb-footer-bg\b/);
    expect(SIDEBAR, 'a capital strip is still painted').not.toMatch(/\bbg-sb-field\b/);
  });

  // SPENT TWICE AND NO MORE: one rule between the two nav groups, one between Settings and the
  // account. `sb-divider` retires for `hairline` (rail-and-account-foot.md § Signed).
  it('spends `hairline` exactly twice, and `sb-divider` not at all', () => {
    expect(linesWith(/\bborder-hairline\b/).length, '`hairline` moved off its two sites').toBe(2);
    expect(SIDEBAR, '`sb-divider` is still drawn').not.toMatch(/\bborder-sb-divider\b/);
  });

  // Inside the account's fold, so it is held with the rows and closed with them on a host with
  // no auth environment, where a rule over nothing would end the panel.
  it("rules the account off from Settings, inside the account's fold", () => {
    const at = SIDEBAR.indexOf('function AccountRows');
    const rows = SIDEBAR.slice(at, SIDEBAR.indexOf('</AccountFold>', at));
    const rule = rows.search(/border-t border-hairline/);
    expect(rule, 'the account has no rule of its own').toBeGreaterThan(-1);
    expect(rule, 'the rule is not above both answers').toBeLessThan(
      rows.indexOf("rows === 'entry' ?"),
    );
  });

  // A rule, not a drawing: `mark.test.ts` reads this file RAW and asserts the mark's `d=`,
  // `stroke*=` and `fill=` attributes as whole-file ORDERED LISTS, so an SVG line here would
  // fail the mark's pin rather than this one.
  it('draws the rule as a border, leaving the mark the only inline SVG', () => {
    expect((SIDEBAR.match(/<svg\b/g) ?? []).length, 'a second inline SVG entered the file').toBe(1);
  });

  // THE ROW'S REGIONS MUST TILE WITH THE PILL'S BELOW THE BREAKPOINT, and this is the one
  // line that makes them: the drawn gap does not clear the two `TAP_44` overlays, so the
  // segment's region crossed into the pill's DRAWN box and won the tap at `z-10` — a thumb
  // aimed at the top of Settings flipped the currency. Above the breakpoint `TAP_44` does not
  // apply and the drawn gap stands, which is why the utility is `max-md:`. Settings is drawn 44,
  // so it brings no overlay of its own: the margin is the 22 px segments' 11 alone.
  //
  // ON THE ROW, NOT ON A TRACK: the two tracks sit side by side and the margin belongs to
  // what holds them. Asserted as "no track carries one" as well, or the pair drifts back to
  // a margin each and reads the same.
  it('clears the two tracks of the Settings pill below the breakpoint', () => {
    const tracks = segmentedControls();
    expect(tracks.length, 'the foot is not carrying two tracks').toBe(2);
    for (const track of tracks) {
      expect(track, 'a track took the row’s own bottom margin').not.toMatch(/\bmb-\d/);
    }
    const row = linesWith(/max-md:mb-\[11px\]/);
    expect(row.length, 'the clearance is not on one element').toBe(1);
    expect(row[0], 'the clearance left the row that holds the two tracks').toMatch(
      /\bflex\b[\s\S]*\bgap-2\b/,
    );
  });
});

// The row's two sets are the one segmented control at the sidebar's size (controls.md § Signed,
// D2), each at `flex:1`: theme's three glyphs, and for a user the currency's two symbols.
describe('the foot carries two segmented controls on one row', () => {
  const tracks = segmentedControls;

  it('draws both at the sidebar size, each a named radiogroup', () => {
    expect(tracks().length).toBe(2);
    for (const track of tracks()) {
      expect(track, 'a track is not at the sidebar size').toMatch(/\bsize="sm"/);
      expect(track, 'a track does not take half the row').toMatch(/className="flex-1"/);
    }
    const [theme, currency] = tracks();
    expect(theme, 'the theme track lost its name').toMatch(
      /aria-label=\{t\.settings\.theme\.ariaLabel\}/,
    );
    // No new copy: the currency is named by Settings' own row title.
    expect(currency, 'the currency track lost its name').toMatch(
      /aria-label=\{t\.settings\.currency\.title\}/,
    );
    // One order, the store's; `theme.test.ts` holds that half.
    expect(SIDEBAR, 'the segments are not mapped off the store’s order').toMatch(
      /THEME_ORDER\.map\(/,
    );
  });

  // The hand-rolled pair is gone: a radiogroup replaces the pressed pair, and the knob the chip.
  it('leaves no hand-rolled segment, pressed pair or accent chip', () => {
    expect(SIDEBAR, 'the currency is still a pressed pair').not.toMatch(/aria-pressed/);
    expect(SIDEBAR, 'a hand-rolled radio is left').not.toMatch(/role="radio/);
    // The solid chip, not the active row's `bg-accent-tint`.
    expect(SIDEBAR, 'the accent chip is still drawn').not.toMatch(/\bbg-accent(?![-\w])/);
    expect(SIDEBAR, 'a track still paints the route tint').not.toMatch(
      /rounded-\[8px\] bg-sb-item-active-bg/,
    );
    expect(SIDEBAR, 'a thumb of the sidebar’s own is left').not.toMatch(/data-owns-motion/);
  });

  // THE FIT, from the control's own numbers: in the drawer each segment is `44 − gap` wide (the
  // 44 overlays then tile), and the five with both wells' padding and gaps and the row's `gap-2`
  // must fit the 239 the band measures, or the row wraps where nothing narrows it.
  it('fits the five segments in the drawer band, and wraps rather than clipping below it', () => {
    const control = stripTs(
      readFileSync(join(here, 'components', 'ui', 'SegmentedControl.tsx'), 'utf8'),
      'SegmentedControl.tsx',
    );
    const sm = control.match(/sm:\s*\{[^}]*\bpad:\s*(\d+),\s*gap:\s*(\d+)/);
    expect(sm, 'the control has no sidebar size').not.toBeNull();
    const [pad, gap] = [+sm![1], +sm![2]];
    expect(control, 'a segment is not 44 − gap wide below the breakpoint').toContain(
      `max-md:min-w-[${44 - gap}px]`,
    );
    const well = (n: number) => 2 * pad + n * (44 - gap) + (n - 1) * gap;
    expect(well(3) + 8 + well(2), 'the drawer row no longer fits its band').toBeLessThanOrEqual(
      239,
    );
    // A left safe-area inset takes the band down in landscape, and the drawer's
    // `overflow-hidden` would clip an overflowing row; it wraps, with room between its lines.
    const row = linesWith(/max-md:mb-\[11px\]/)[0] ?? '';
    expect(row, 'the row cannot wrap, so a narrower band clips it').toMatch(/max-md:flex-wrap\b/);
    expect(row, 'a wrapped row has no clearance between its two lines').toMatch(
      /max-md:gap-y-\[22px\]/,
    );
  });
});

describe('Settings leaves the scrolling band, and its caption goes with it', () => {
  it('renders the Settings link after the `Scroller` closes', () => {
    const close = SIDEBAR.indexOf('</Scroller>');
    expect(close, 'the nav band no longer goes through `Scroller`').toBeGreaterThan(-1);
    const settings = SIDEBAR.indexOf('to="/settings"');
    expect(settings, 'the Settings link is gone').toBeGreaterThan(-1);
    expect(settings, 'Settings is still inside the scrolling band').toBeGreaterThan(close);
  });

  // Settings left the scrolling band and took its group header with it. The three are a user's two
  // and the super-admin's «Адміністрування», whose one item keeps a caption because the group names
  // the role's work and «Користувачі» joins it.
  it('leaves three nav groups, so three captions', () => {
    expect(linesWith(/<NavGroup\b/).length, 'the nav no longer has exactly three groups').toBe(3);
    expect(SIDEBAR, 'the Settings group caption survived its group').not.toMatch(/groupSettings/);
  });

  it('keeps the version in the foot, under Settings', () => {
    const settings = SIDEBAR.indexOf('to="/settings"');
    expect(SIDEBAR.indexOf('__APP_VERSION__'), 'the version left the foot').toBeGreaterThan(
      settings,
    );
  });
});

describe('the group caption is a section label', () => {
  // L3 (`type.md` § Signed): sidebar groups are caps +.12em at 500, the label role's recipe. Still
  // small text, so `sb-label`'s recorded shortfall stands and is not repaired here.
  it('sets the caption in the caps label recipe, in `muted`', () => {
    const header = linesWith(/\btext-label-caps\b/).filter((l) => /h-\[18px\]/.test(l));
    expect(header.length, 'the group caption row is gone').toBe(1);
    expect(header[0], 'the caption does not read in caps').toMatch(/\buppercase\b/);
    expect(header[0], 'the caption is not `muted`').toMatch(/\btext-muted\b/);
  });
});

// THE HEAD (shell.md § Signed, G1; brand.md § Signed): the 40 plate, «quirenote» at 17 / 600, an
// 11 px `muted` line with the capital and its change, and the collapse chevron 16 in a 28 box.
describe('the head is the lockup with the capital line, and the blob is gone', () => {
  /** One function's text, to its closing brace at column 0. Fails rather than widens: a bound
   *  that is not found would read to the end of the file. */
  const fn = (name: string) => {
    const at = SIDEBAR.indexOf(`function ${name}`);
    expect(at, `\`${name}\` is gone`).toBeGreaterThan(-1);
    const end = SIDEBAR.slice(at).search(/\n\}\r?\n/);
    expect(end, `\`${name}\` has no closing brace`).toBeGreaterThan(-1);
    return SIDEBAR.slice(at, at + end);
  };
  const head = () => fn('PanelHead');

  // The wordmark is centred against the plate with the line under it, so a line that arrives
  // with the role would lift it: the slot is held at the line's height until then.
  it('holds the capital line’s slot while the role is unknown', () => {
    expect(head(), 'the held slot is not the line’s 14').toMatch(
      /line === 'held' && <div aria-hidden className="h-\[14px\]" \/>/,
    );
    expect(SIDEBAR, 'the panel no longer holds the slot for an unknown role').toMatch(
      /line=\{!panel \|\| admin \? 'none' : role === 'user' \? 'capital' : 'held'\}/,
    );
  });

  // The drawer's foot is measured for the toast's offset, so it reaches through the drawer's
  // bottom padding to the screen's edge, or the toast stands short of it and covers the tracks.
  it("reaches the drawer's foot to the screen's edge", () => {
    const foot = linesWith(/ref=\{band\}/);
    expect(foot.length, 'the measured foot is not one element').toBe(1);
    const at = SIDEBAR.indexOf('ref={band}');
    const tag = SIDEBAR.slice(at, SIDEBAR.indexOf('>', at));
    expect(tag).toMatch(
      /panel \? '' : 'mb-\[calc\(-1\*max\(16px,env\(safe-area-inset-bottom\)\)\)\] pb-\[max\(16px,env\(safe-area-inset-bottom\)\)\]'/,
    );
  });

  it('draws the 40 plate beside the wordmark', () => {
    expect(head()).toMatch(/<Mark size=\{40\} \/>/);
    expect(head()).toMatch(/font-display text-h3 text-ink[^>]*>\s*quirenote/);
  });

  it('keeps the collapse control, a 16 chevron in a 28 box', () => {
    const at = head().indexOf('id={SIDEBAR_COLLAPSE_ID}');
    expect(at, 'the collapse control lost its id').toBeGreaterThan(-1);
    const button = head().slice(head().lastIndexOf('<button', at), head().indexOf('</button>', at));
    expect(button, 'the box is not 28').toMatch(/\bsize-7\b/);
    expect(button, 'the chevron is not 16').toMatch(/<ChevronLeft size=\{16\}/);
  });

  // The capital keeps a name a screen reader announces with no caption on screen
  // (shell.md, Перенесено).
  it('names the capital line for a screen reader, in 11 px `muted`', () => {
    const line = fn('CapitalLine');
    expect(line, 'the line is not 11 px `muted`').toMatch(/\btext-label text-muted\b/);
    expect(line, 'the line has no name').toMatch(
      /<span className="sr-only">\{t\.sidebar\.totalCapital\}/,
    );
    expect(line, 'the change is not coloured by sign').toMatch(/'text-neg'[\s\S]*'text-pos'/);
  });

  // super-admin.md § Signed: a 44 px role band at r12 on `ink` 5 %, the shield 18 in
  // `sb-icon-active`.
  it("draws the super-admin's role band", () => {
    const band = fn('RoleBand');
    expect(band).toMatch(/\bh-11\b[^"]*\brounded-\[12px\][^"]*\bbg-ink\/5\b/);
    expect(band).toMatch(/<Shield size=\{18\}[^>]*text-sb-icon-active/);
  });

  // The decor blob identified nothing against the wall and sat under the band anyway, so it
  // was deleted outright rather than redrawn — neither the component nor its two call sites
  // survive, and the shape invariant lost it as an exception.
  it('deletes `SidebarDecor` and both call sites', () => {
    expect(SIDEBAR, '`SidebarDecor` is still in the file').not.toMatch(/SidebarDecor/);
  });
});

// THE ACCOUNT IS THE FOOT'S LAST ROW
// (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md` § Signed): the
// owner ruled the sign-out last, a row in Settings' own recipe, with the address above it. The
// links line under it carries the privacy and terms links over the version.
describe("the account is the foot's last row", () => {
  it('draws the account rows after Settings and before the version', () => {
    const settings = SIDEBAR.indexOf('to="/settings"');
    const rows = SIDEBAR.indexOf('<AccountRows />');
    expect(rows, 'the band no longer draws the account').toBeGreaterThan(-1);
    expect(rows, 'the account moved above Settings').toBeGreaterThan(settings);
    expect(
      SIDEBAR.indexOf('__APP_VERSION__'),
      'the account moved under the version',
    ).toBeGreaterThan(rows);
  });

  // A PILL LIKE ITS NEIGHBOURS, and busy WITHOUT `disabled`: disabling drops the focus, and a
  // sign-out that fails leaves the pill as the retry.
  it("signs out from a pill in Settings' recipe that keeps its focus while busy", () => {
    const at = SIDEBAR.indexOf('function AccountRows');
    expect(at, '`AccountRows` is gone').toBeGreaterThan(-1);
    // Bounded by the markup's own close: a stripped JSX comment leaves a bare `}` at a line's
    // start, so the function's closing brace is not a bound that can be found.
    const end = SIDEBAR.indexOf('</AccountFold>', at);
    expect(end, '`AccountRows` no longer closes its fold').toBeGreaterThan(at);
    const rows = SIDEBAR.slice(at, end);
    // The button's own markup: the entry beside it is a pill in the same recipe, so a read of the
    // whole slot would pass on the entry's classes alone.
    const from = rows.search(/<button\b/);
    expect(from, 'the sign-out is not a button').toBeGreaterThan(-1);
    const button = rows.slice(from, rows.indexOf('</button>', from));
    expect(button, "the sign-out left the account's pill").toMatch(/\$\{ACCOUNT_PILL\}/);
    expect(SIDEBAR, "the account's pill left Settings' recipe").toMatch(
      /const ACCOUNT_PILL = `\$\{ACCOUNT_STEP\} \$\{ROW\(/,
    );
    expect(button, 'busy no longer announces itself').toMatch(/aria-disabled=/);
    expect(button, 'busy disables the pill and drops its focus').not.toMatch(/\sdisabled=/);
    expect(button, 'the sign-out lost its glyph').toMatch(/Icon=\{LogOut\}/);
  });

  // SIGNED OUT, THE SLOT KEEPS ITS SIGNED-IN SHAPE
  // (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md` § Signed): the
  // status where the address stands, then «Увійти» where «Вийти» stands. A LINK, because it goes
  // to a route; a plain `Link` and never a `NavLink`, because `/sign-in/x` falls into the shell,
  // where a `NavLink` would mark the entry current.
  it('offers a sign-in link in the same slot, after a status row', () => {
    const at = SIDEBAR.indexOf('function AccountRows');
    const end = SIDEBAR.indexOf('</AccountFold>', at);
    const rows = SIDEBAR.slice(at, end);
    expect(rows, 'the status row is gone').toMatch(/label=\{t\.auth\.notSignedIn\}/);
    const link = rows.search(/<Link\s+to="\/sign-in"/);
    expect(link, 'the entry is not a link to /sign-in').toBeGreaterThan(-1);
    expect(rows, 'the entry lost its glyph').toMatch(/Icon=\{LogIn\}/);
    expect(rows, 'the entry lost its label').toMatch(/label=\{t\.auth\.signInEntry\}/);
    // The entry's branch alone: the signed-in address is the profile's NavLink.
    const [from, to] = [rows.indexOf("rows === 'entry' ?"), rows.indexOf(') : (')];
    expect([from, to].every((i) => i > -1) && to > from, 'the entry has no branch of its own').toBe(
      true,
    );
    const entry = rows.slice(from, to);
    expect(entry, 'a NavLink would mark /sign-in/x current').not.toMatch(/<NavLink\b/);
    expect(
      rows.indexOf('t.auth.notSignedIn'),
      'the status row does not stand above the entry',
    ).toBeLessThan(link);
    expect(rows, 'the entry no longer answers the signed-out state').toMatch(/rows === 'entry' \?/);
  });

  // ONE GEOMETRY BY CONSTRUCTION: the held slot is the signed-in rows' height, so the signed-out
  // rows take the same row and the same pill, or Settings moves when the relay answers. The
  // address is the profile's link at the row's 36
  // (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md` § Signed): the
  // pill's states on a box whose 9 + the 18 glyph + 9 is the row's `h-[36px]`.
  it('draws both answers from one row and one pill', () => {
    const at = SIDEBAR.indexOf('function AccountRows');
    const rows = SIDEBAR.slice(at, SIDEBAR.indexOf('</AccountFold>', at));
    expect(rows.match(/className=\{ACCOUNT_ROW\}/g)?.length, 'a row left the shared row').toBe(1);
    expect(rows.match(/ACCOUNT_LINK\b/g)?.length, 'the address left the shared link').toBe(1);
    expect(SIDEBAR, "the address link left the row's height or the pill's states").toMatch(
      /const ACCOUNT_LINK = pillClass\('py-\[9px\]', 'rounded-\[9px\]', 'text-small'\);/,
    );
    expect(SIDEBAR, "the row's height moved").toMatch(/const ACCOUNT_ROW = `[^`]*\bh-\[36px\]/);
    expect(rows.match(/ACCOUNT_PILL\b/g)?.length, 'a pill left the shared pill').toBe(2);
    // Exactly the shared pill, so a class added on one answer cannot move Settings on the other.
    expect(rows, 'the entry added to the pill').toMatch(
      /<Link to="\/sign-in" className=\{ACCOUNT_PILL\}>/,
    );
    expect(rows, 'the sign-out added geometry to the pill').toMatch(
      /className=\{`\$\{ACCOUNT_PILL\} aria-disabled:opacity-70`\}/,
    );
    expect(SIDEBAR, 'the account pill is drawn active').toMatch(
      /const ACCOUNT_PILL = `[^`]*\(\{ isActive: false \}\)\}`;/,
    );
    expect(SIDEBAR, "the row left the pill's step").toMatch(
      /const ACCOUNT_ROW = `\$\{ACCOUNT_STEP\} /,
    );
  });

  // An address set on one line is an unbreakable run, and an implicit `auto` column grows to
  // it, so a long address would widen the whole band.
  it("spells out the panel's column, so a long address cannot widen it", () => {
    expect(SIDEBAR, "the panel's grid lost its explicit column").toMatch(
      /grid h-full grid-cols-\[minmax\(0,1fr\)\]/,
    );
    // The account's fold is a grid too, and grew the rows past the band the same way.
    expect(SIDEBAR, "the account's fold lost its explicit column").toMatch(
      /grid grid-cols-\[minmax\(0,1fr\)\] \$\{rows === 'closed'/,
    );
  });
});
