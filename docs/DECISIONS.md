# Decisions

Current state only, one topic per section: what is decided, why, and what stays rejected. Rewritten in place when a decision changes — the history is `git log -p` on this file. Code cites a topic by its heading; the table at the end resolves the old `D<n>` numbers still found in comments.

## Core is pure
**Decision.** The domain layer is `packages/core`, declared in `pnpm-workspace.yaml` as
`@quirenote/core` and imported by the SPA and by `infra/` alike — no React, no Dexie, no store, no
UI, and no climbing back out into `src/` or `infra/`; `src/lib/` holds persistence. The reference
seed is domain and travels with it. IT IS CONSUMED FROM SOURCE: its `exports` point at `.ts`, there
is no build step and it carries no `tsconfig.json`, so the SPA's compiler options and the backend's
each compile the same files and a browser-only type fails one of them. `infra/` is a workspace
member, so ONE INSTALL covers both trees and the backend's handlers bundle the package rather than
externalising it. The zone is enforced by lint KEYED TO THE PACKAGE PATH, and because a selector
that stops matching still parses green, a test lints text at a path inside the package rather than
reading the config back. Pure modules return keys and tokens, never assembled prose. EVERY SCREEN
TAKES ITS FIGURES FROM ONE COMPOSER in `view/`, a function of the ledger and of whichever of the
period option, the caller's `today` and the Inzhur feed that screen reads; the component formats,
tweens and converts what it returns, and a source test holds each screen to one call. `buildView`
runs them all, the windowed ones once per period option and the rest once, and its type is
`/view`'s payload. The clock is an input: nothing in the package reads it for a figure. New code calls
`repository.ts`, never `db.ts`. A dependency is a decision, and it is recorded under the topic it
serves rather than in a register of its own. The seam test against `infra/schema/user.ts` sits in
`infra/src/`, so the edge between them runs one way.
**Why.** The domain layer is the part a move to a server does not touch, and the repository is the
seam it replaces. A `package.json` is a boundary and relative imports were crossing it, which is
what a package removes; it was taken while the shared surface was small rather than after server
derivation widened it. Two programs compiling one source is the property worth paying for — it is
what catches a browser-only type before a backend build does, and it is the reason no compiled
artifact sits between them. A figure a screen composes for itself is one the server does not have,
so `/view` would have to rebuild it — a second implementation, which is what serving the import
rules out.
**Rejected.** A component reaching for `db.ts`: it bypasses the one surface the migration swaps. ·
A composer only the server calls: the screens' inline copies would stay a second implementation with
nothing checking that the two agree. · Every screen in every period block: the Balances chart is one
point per snapshot, six times over. ·
English returned from the package: the language is a parameter, never a default. · Project
references and `composite`: a referenced project may not set `noEmit`, and references check against
emitted `.d.ts` — the dual-source check above, given up. · `--packages=external` on the handler
bundle: esbuild externalises anything shaped like a package path, and a package name is not one of
its two exceptions, so the import would survive as a bare require Lambda cannot resolve. ·
`injectWorkspacePackages`: `dedupeInjectedDeps` defaults true, so it symlinks anyway. · A
`projects` key in the vitest config: one root pattern already collects every tree, and naming
projects is how the backend's tests get lost.

## Persistence today
**Decision.** Dexie on IndexedDB behind `repository.ts`, the only writer; two databases — demo,
seeded, and live, never auto-seeded — bound once at boot. Every persisted setting joins `partialize`
in the commit that adds it. The JSON backup envelope refuses a newer, an older and an unreadable
version, A `__proto__` KEY in any object the schemas read — the envelope, settings, a row, its
`inzhur`, a snapshot's quotes — and AN ASSET ID THAT IS ANY OWN PROPERTY NAME OF `Object.prototype`
(`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty` and the rest), both by place
and before the row schemas;
import validates fully, shows a diff, then replaces in one transaction — a key the file omits is
REMOVED — after a safety backup that cannot be cancelled. CSV is export-only, and A TEXT CELL NEVER
STARTS A FORMULA: one beginning with a character OWASP's CSV Injection page lists — `=`,
`+`, `-`, `@`, tab, CR, LF, or the full-width `＝＋－＠` — is written after an apostrophe. A number
is never guarded, so a negative amount stays a number; the JSON backup writes every note as typed,
since it is restored into the store rather than opened in a spreadsheet. THE BACKUP WRITES
THE MODEL'S SHAPE, NOT THE STORE'S: `buildBackup` projects every row onto its schema's keys, so a key
the model retired, still sitting in IndexedDB, never reaches the file and needs no migration. A
VALUE the reader refuses — a moving row with no count, the retired `tax` type, an asset id such as
`constructor` an older build imported — has nothing to project and still fails the envelope; that
store cannot back itself up, and its exit is the CSV export, which validates nothing, then
Settings → Danger zone, erase on live and reseed on demo.
**Why.** Replace-never-merge is why the diff exists: yesterday's backup silently dropping today's
work is what the dialog must state before the press. The envelope's version tracks what a build
ACCEPTS, not how long ago it shipped, so two live builds cannot share a number and disagree about
fields — which is why a projecting writer bumps nothing. A strict reader needs a strict writer:
spread, the store's leftovers rode into the file and the file's own parser refused it, shutting
the download, both destructive dialogs' backup and the import's safety backup at once. The export
is terminal, the store the only truth and the file there to be restored into it, so nothing
downstream waits for a field this build has never heard of. zod drops a `__proto__` key before any
schema sees it, in the record and the strict object alike, and an assignment to that key on a plain
quote map stores nothing, so a file carrying it would lose a quote, a key or an asset's prices in
silence — against the rule that nothing partial passes; `secure-json-parse` and `bourne` refuse the
key by default too. A plain quote map with no own key for an asset id such as `constructor` answers
`quotes[id]` with the inherited member, so a quote the file never carried reads as present and the
day as complete; `qs` drops any key `Object.prototype` owns by default, and the import refuses the
file instead of dropping the asset, by the same rule. The import is the only door for an arbitrary
asset id — the form stamps a UUID and the seed's ids are fixed — so from this build on no store gains
such an id, and one check there covers every map keyed by an asset id, the ones built later
included; a store an older build filled keeps its id and takes the exit above. OWASP lists those
characters as ones a
spreadsheet can read as starting a formula, and names exfiltrating the sheet's contents among the
attacks; a note and an asset's name are free text. The guard goes by the value's run-time type, as
`csv-stringify`'s `escape_formulas` does: only a number is exempt here, and in an unvalidated store
every other value is text, a column added later included. Every other reader pays for it: a
program reading the file gets the apostrophe as part of the cell, and the JSON backup stays the
lossless copy. It holds while the file is as exported — OWASP warns Excel may drop it on a save
and re-open.
**Rejected.** A library's own dump format: the envelope has to be app-owned, human-readable and
domain-validated. · Preserving unknown keys through the round trip, as a relay does: it becomes
right the day the backup carries data between two builds as a sync or merge channel, where a
projecting writer would destroy the other build's fields. · Passing a formula cell through as
typed: quoting does not stop a spreadsheet evaluating it. · Quoting every cell, OWASP's other
sanitisation step: for a comma reader RFC 4180 already quotes a cell a comma, a quote or a line
break would split, and read at `;` any cell but a line's first opens its quote after a comma,
mid-field, so wrapping does not reach the residual below. · OWASP's tab prefix, offered as
Excel-resistant: the cell would then begin with a tab, which the same page lists among the
characters no cell should begin with, and neither `csv-stringify` nor Papa Parse uses it. ·
Guarding by content, a numeric-looking text exempt: the note `-5` is text and would reach the sheet
as a number. · Guarding past the first character: OWASP warns a separator inside a cell starts a
new one — read with `;` as its separator, uk-UA's list separator, the comma file splits at a
note's `;`, and `x;=…` opens as a formula. Neither library guards past the first character, and
whether such a guard is complete turns on spreadsheet parsing no test here reaches, so that
residual is accepted. · A hardened JSON parser in place of `JSON.parse`: it throws one `SyntaxError`
for the whole text, where the report addresses every issue by table, row and field. · Quote maps as
`Map` or null-prototype objects, OWASP's remedy: a `Map` turns every read into `.get` and needs
converting at both ends of the JSON backup, which cannot hold one; a null-prototype object does not
survive the store or the backup, since `structuredClone` and a JSON round trip both return an
ordinary object, so that route is an `Object.hasOwn` read at every site that reads a map by an asset id, plus a guard
to keep them that way. One refusal at the only door for such an id covers every file imported from
now on.

## Derived figures and the seed
**Decision.** Every portfolio figure is derived from stored data and none is hard-coded; value at a
date is `units(a, D) × price(a, D)`, the price being the latest observation at or before D from
either source, the user's or the archive's, the newer winning and the user's on a same-day tie, so
nothing is prefilled because nothing is written. The app still stores and reads ₴ snapshots
(*Persistence today*). Core can rebuild that series from the ledger and both sources' per-unit
prices instead, and nothing reads the rebuild yet: one snapshot per grid day from the first that values anything —
every day a held asset is observed on, every transaction day, and the day before each period opens,
resolved by the window composer — each asset at that day's units × price, rounded once to the
kopeck as the figure is made, and no save time. The latest grid day closes every window, so a
transaction dated after the last observation closes them at carried prices, a full exit at none;
no grid day falls after the caller's day, so a transaction or a price dated later adds none. A
position the ledger holds none of that day has no quote, as the quotes form asks for none, and every figure that
values it reads 0 from the ledger; one the ledger cannot count, or a held one no source has observed at or
before the day, is absent, never 0. Each quote names the
observation that priced it, its date and its source, so a carried price can be told from one
observed that day; how it renders is #64's. A bond's price carried across a coupon's payment date
is the price before it, cum that coupon, beside the coupon already in cash until the next
observation; the flag is what tells it. Every golden ledger whose quotes a per-unit price can
express, the seed among them, rebuilds to a series holding every quote it stored, and every
composer's output over every period is pinned to the stored series' but for the figures a carried
price predicts — a day quoting some held positions and not others, which the rest complete at their
carried price — listed per ledger, exactly in each snapshot's own quote order and to float noise in
the store's order, since the composers sum in key order; on a ledger with archive rows every figure
that moves is listed under the rule that moves it. Automation stays suggest-only wherever the app
still decides: the user's Save is the sole write path. A hand-entered value is MARKED; an archive
one is not.
**Why.** The seed exists so the first run reproduces the reference, and it reconciles by
construction rather than through exclusion rules — which is why its pinned figures MAY move when the
ledger model requires it. The identity was proven before the archive joined, so each figure the
join and its carried prices move is listed, not absorbed. Every mature tool reads a price at a date
as the latest at or before it — Beancount bisects its price list, hledger reads the price "on or
before the valuation date", DuckDB's AsOf join and GnuCash's nearest-before lookup do the same, and
Portfolio Performance's daily index values each security that way on every calendar day — where
carrying the ₴ value valued a late buy at nothing until its day was quoted, the seam
`headlineTotalAsOf` describes. The newer observation wins whatever its source because an OVDP price
drops ex-coupon on the payment date (*Metric families and windows*), and a carried pre-coupon user
price beside the coupon already recorded counts it twice; the user's wins a tie as hledger's P
directive and GnuCash's price-editor source do. A carried price is flagged, not capped: regulators
ask for stale-price monitoring, not a cutoff (SEC Rule 2a-5, GIPS 2020 2.A.21), and Ghostfolio
stores its carried prices distinguished by `isCarriedForward`. The window bounds sit on the grid
because the opening position is read the day before the window opens and the close on its last
day, and a point there values that day's units where the last stored value before it valued another
day's; transaction days because units and cash move then; an observation of an asset held none of
makes no day, since the archive captures a fund sold out or not yet bought every night, and each
such night would add a point at the held positions' carried prices. No grid day falls after the
caller's day because one would close every window in the future, at a carried price or at one
observed ahead of the day. Ghostfolio ends every range but a calendar year at `endOfDay(new Date())`
when no end is given, and Portfolio Performance's last-X, since-X, month-to-date and year-to-date periods
end on the day they are relative to; unlike both, the caller's day is a grid day only when
something is observed or transacted on it, so a window closes on the latest grid day at or before
it. A ₴ figure is kopeck-grained, as Portfolio Performance rounds a position's value
to the currency's minor unit once, at valuation; unrounded, a value divided into a price and
multiplied back carries float noise into every figure built on it. A non-zero quote of a position
the ledger holds none of has no per-unit price that reproduces it, so a ledger carrying one is not
expressible. The lookup is silent, so without the mark an observed value and a carried one read
identically.
**Rejected.** A minimal purpose-built fixture: checkpoints that move with the fixture cannot catch a
regression · A 0 for a held asset no source has priced yet: the corruption `quotesAsOf` refuses · A
quote without its observation: a carried price could not be told from an observed one, and the mark
would have nothing to read · Valuing every calendar day, as Portfolio Performance does: the grid is
where the data and the readers are, and a linked portfolio gets a day per archive capture anyway ·
The user's price first wherever it is, as a `coalesce` reads: a carried user price outranking a
newer archive one is Ghostfolio's #7775 · A cutoff on how far a price carries: the flag is the
reader's to act on · Valuing a position before its first price at that first price, as Portfolio
Performance does: a price from after the day is no observation of it · A 0 quote for a position held
none of, before its first unit or after its last: Balances would show it on every such day as a
saved quote of a position not held, marked, and Portfolio Performance's snapshot holds no position
of 0 shares.

## Metric families and windows
**Decision.** Two metric families, both permanent and never conflated: capital gain and total
return. The annualized column divides every row by ONE span, the selected window's, and a row whose
holding falls well short of it renders muted; per-asset XIRR is the money-weighted column, and its
annualization mark tests the WINDOW's length, not the asset's. A window's opening position is valued
the day BEFORE it opens; on the rebuilt series that day, when it values anything, and the closing
day are grid days, carried where nothing was observed on them, so the opening position is read off
a point rather than off the last value before it. Where the rule below leaves a position ABSENT on that day, `/yield` leaves
its basis, its row and its line absent over the window. Units are `Σ quantity deltas` over the
ledger, never a stored total, each
quantity counted as a whole number of 1e-8 units; a position's value counts at a date only while
the ledger holds units of it then, on its last quote's own day, and on the
last valuation day, so a sold-out one counts its proceeds alone and one whose units the ledger
cannot count on those days keeps its last quote; Balances and `/yield`'s curve read each snapshot by that rule on
its own day, and a Balances cell shows a quote the rule leaves out, marked, the mark meaning only
that; a day asks for an asset's quote only while the ledger holds units of it, or, where it cannot
count them, from its first purchase on, and Balances' complete row, the quote-missing reminder and
`/`'s progress pill ask by that one rule, which `/`'s pending-change block counts by too; a coupon
or a redemption is owed only while the ledger
holds units at the end of the day before its date, or cannot count them, and the coupon and
maturity reminders, `/`'s coupon card, `/attributes`' next coupon, the next payouts on Overview and
Payouts, and Seasonality's expected coupons and coupon-season card pass one it held none of; a
position held, or uncounted, that no snapshot values, never quoted, or bought after its
last quote's day or the last valuation day held none of it, has its own value, share and capital gain
ABSENT and the rebalance plan proposes nothing for it, while one the ledger holds none of, or that
no row moves and no snapshot quotes, is worth 0; the close of Overview's capital gain and of
`/yield`'s table counts units to the ledger's last row, where their flows end too, though its
quotes stop at the window's end; free
cash AT A DATE is the ledger's signed sum up to it, a payout contributing
`amount − coalesce(tax_withheld, 0)`; a coupon derives from its RATE. A withholding is a FIELD on
the payout it was taken from, never a row of its own. Nothing bounds free cash, so a share is taken
only of a USABLE total, positive and finite, only while free cash is at or above zero, and only of a
value at or above zero; otherwise it is ABSENT and renders «—» with the accessible name "cannot be computed", and the rebalance plan
proposes nothing. Free cash below zero or unreadable carries a warn-tint warning on every screen
that shows a share. Every display formatter renders a non-finite figure as «—», whatever produced
it; a field's own value stays the field boundary's. A bond's price ON the payment date of a coupon
before maturity is EX that coupon: the DCF re-derivation (`futureFlows`) discounts only flows
strictly after the pricing date, and a quote suggested for that date already deducts the coupon.
**Why.** The day before is the only boundary at which each transaction counts exactly once, and it
makes the full history collapse onto its unwindowed twin. Capital gain is realized plus unrealized,
and the unrealized half is measured only on what is still held; `quotesAsOf` merges snapshots, so a
last quote outlives its sale and would count it twice. A snapshot dated after the sale can still
quote the position, the same double count one day at a time; the cell shows it because nothing
stored is hidden, and the mark says the total left it out. A snapshot stores a value, not a price
per unit: a quote taken on a day the ledger held none values none of the units bought later,
wherever the latest snapshot falls, and a last valuation day that held none values the position at
nothing, so units bought after it wait for their own quote; the rebuilt series carries prices, not
values, so on it a late buy is valued from its own day, and these rules say what a stored ₴
snapshot can say. A reader that asked for a quote of a
position no longer held would nag every day after a sell-out or a maturity, for a quote the total
then leaves out; Portfolio Performance's held-securities price update asks only for the positions in
that day's snapshot, which holds none with 0 shares. The NBU depository pays a coupon or a
redemption to the holders it fixes at the end of the operational day before the payment date
(`reference/OVDP-COUPON-STRUCTURE.md`), so a holder who sold by then is owed nothing, and a
reminder would ask for a payout that never comes; the calendar day before differs from it only
across a non-working day, when the depository settles nothing. Fractional quantities summed as floats
can miss 0 after a full sale: a residue above it reads as held, and the feed reads one below it as
more sold than bought; whole 1e-8 units sum exactly, and 1e-8 is Portfolio Performance's share
precision. A stored coupon amount goes stale on the
next purchase where a rate does not; tax runs the other way, rates changing, so a computed
withholding eventually lies where a recorded one cannot. The withholding is READ off the payout
rather than skipped, which is two columns of one row and not an exclusion returning by another
door; without it free cash overstates by every hryvnia ever withheld, and per-asset XIRR silently
turns from net to gross. A share off a negative total reads in the hundreds of percent, a top-up
off one is a negative buy, and `Intl` prints `NaN` as a word — each keeps rendering and keeps being
wrong, where an absent figure says it cannot be computed. Negative cash that leaves the total
positive still shrinks it: the shares sum past 100 %, a deep enough shortfall puts one past it
alone, and the plan trims off the shortfall. The «—» alone is silent about the cause; the ledger is
the cause nothing else can see, so a short ledger is named. An unvalued position read as 0 is a
total loss and a buy of its whole target, from its first buy until its day is quoted; one the
ledger holds none of is a known 0, which is how a new asset's first buy is proposed. Ex on the
payment date is the provider's own convention, OBSERVED across a coupon boundary in the archive
rather than inferred: each row there fits its own date, and the step lands on the payment date
itself, the one date where ex and cum disagree, which confirms `futureFlows`' same-day rule.
**Rejected.** Per-asset annualization: a fixed-coupon bond would beat its own contract, and XIRR is
already the per-asset answer. · A stored balance beside the derived one: no screen ever let anyone
enter the observation, so the second source of truth could only ever carry the previous figure
forward, and a chip comparing the two reported a gap neither of them could close. · Dropping the
closing quote of any asset sold in a window: it zeroed a part-sold position. · Counting a flow
due on the pricing date: on such a payment date the provider's quote misses that reading by the
whole coupon. · Valuing an unquoted position at cost: it changes total capital on every screen and
rewrites the documented seam, where a buy lowers it until its day is quoted. · A decimal library
for units: a runtime dependency in the pure package the app and the server both bundle. · A
tolerance in each closed-position test: the residue would still reach every figure that multiplies
units. · Testing the last quote's own day in place of the last valuation day: the quote of a
sold-out holding would value a different one bought back after a day that held none.

## Coupon cadence
**Decision.** Where no published dates are passed, a semiannual fixed coupon steps
`OVDP_COUPON_PERIOD_DAYS` from the stored date: in the walk, the gap a suggested quote subtracts
and the confirm's roll on `/`. A step past the maturity, or one falling short of it by no more than
twice the payout dedupe window, lands on the maturity, so the final period absorbs a short stub.
The schedule's months name each occurrence by the month of its place in the first year's cycle,
and the final coupon, paid with the principal, by its own. Behind the stored date the gap counts
back in the same steps; only when the stored date is the maturity, folded or clamped onto, is the
coupon before it the latest one recorded in the ledger, where one is, dated by its first entry. A monthly or
quarterly coupon keeps the month grid, whose roll clamps to a shorter month's last day and onto the
maturity.
**Why.** Resolution No. 80 sets an OVDP coupon as a fixed amount per period, the number of periods a
year being the issuer's ([80-2001-п](https://zakon.rada.gov.ua/laws/show/80-2001-%D0%BF)), and an
issue's published dates are spaced by one fixed period, which the feed-fixture test in
`accrual.test.ts` measures. A month grid misses most of the provider's dates, and clamping a 31st
to a shorter month moves every later date for good. A period counted in days has no month end:
QuantLib applies its end-of-month rule only to tenors in months or years
([schedule.cpp](https://github.com/lballabio/QuantLib/blob/master/ql/time/schedule.cpp)). A fixed
step can land just short of a maturity off its grid; Strata's `SMART_FINAL` combines a final stub
of less than 7 days with the period before it and keeps one of 7 days or more
([StubConvention.java](https://github.com/OpenGamma/Strata/blob/main/modules/basics/src/main/java/com/opengamma/strata/basics/schedule/StubConvention.java)).
The fold here is wider because a recorded payout settles every occurrence within the dedupe window
of it: a final period up to twice that could be settled at both ends by one payout, and its coupon
and principal never offered. Seasonality adds a whole coupon for each month the schedule names, and
fixed-day steps cross month ends over the years, so naming each occurrence's own month would count
a semiannual coupon three or four times a year. Behind a stored date on the grid, the grid's date is
the coupon's, whatever day a payout was entered on. A fold or a clamp leaves no step back from the
maturity, and the confirm records each payout on its occurrence's date before it rolls.
**Rejected.** The stored date as a fixed anchor for the grid: it overloads the "Next coupon" field,
and an edit silently rewrites the rule. · A month grid keeping the first date's day: it changes
none of the misses. · A stored roll convention for the month-based schedules now: it reaches the
asset row, the backup format, the CSV and the cluster's schema, so it waits for the cutover. · A
schedule's months bounded to its first year: a month the position pays in again after a sale and
a buy-back drops out. · Reading every coupon behind the stored date off the ledger: a payout
entered days late moves the coupon onto its own date, and an earlier stray entry stands in for it.

## Language, numbers, fonts
**Decision.** Ukrainian is the default language, English the second, and the number grammar
separates completely per language: Ukrainian groups on whitespace and reads both `,` and `.` as the
decimal, English keeps the comma as grouping, and when both marks appear the last one is the
decimal. A currency token beside the number is dropped before the grammar reads it; a token alone or
any other letter is not, so `12abc` stays refused. The ₴/$ toggle converts the DISPLAY of headline
KPIs and the sidebar capital only; tables stay in ₴, and dates are `dd.MM.yyyy`. Faces: Manrope for
headings, buttons and KPI numbers, JetBrains Mono for body and tables, and `body` sets
`font-variant-numeric: tabular-nums`. Google's button alone takes Google Sans Medium, the face
Google's guidelines fix for it; its Cyrillic subset carries the Ukrainian label (*Auth model*). A field holding an unsaved number STORES A LANGUAGE-FREE
SPELLING and derives what it shows. A mark the typist PRESSES is read as this language's own; a mark
that ARRIVES BY PASTE is read by the grammar, the only way to keep refusing a European `1234,567`
under English.
**Why.** A face without Cyrillic drops the app into a system fallback the moment the default
language applies. Manrope's figures are proportional and it ships `tnum`, so the one rule on `body`
is what buys the aligned KPI column, and `src/ui-face.test.ts` fails if the face and the rule are
ever separated.
**Rejected.** One locale-blind parser: what a field SHOWS must be what its parser READS. · Judging a
pasted mark the way a typed one is judged: it turns a refusal into a silent thousandfold.

## Shape system
**Decision.** Nothing in the app is a capsule. A standalone control takes `round(min(w, h) × 0.26)`
off its SHORT side; a box nested against a parent's corner takes `outer = inner + gap`, the gap
being padding plus any border. A segmented control is both at once — segment proportional, track
concentric. A full-bleed bar takes square corners. Only asset avatars and colour dots stay round.
The mark is drawn geometry, its loop and pills strokes rather than radii. Measure the RENDERED
height: `text-[11px]` sets a font size, not a height.
**Why.** Proportional describes an object and concentric describes containment, so reaching for the
wrong one gives an answer that looks derived while being arbitrary.
**Rejected.** A track given its own proportional value: the two curves then diverge at every corner.

## Scrolling
**Decision.** Nothing scrolls with the platform's bar — every constrained box goes through
`Scroller`. The rail is 12 across (`2+2+4+2+2`), thumb r1 and rail r5, with a margin of 8 equal on
all four sides and a reserved gutter of `2m + 12`; `max(8, ceil(R × (1 − 1/√2)))` guards a corner
rounder than any the app has. The gutter is the ScrollArea ROOT's padding, both inline sides, fixed.
One column is too narrow to hold it and passes `overlay`, which floats the bar at the edge on a 2px
margin instead.
**Why.** A square-cornered platform track cuts a rounded panel's corner, and takes layout width on
one OS and none on another, so a screen reflows differently per platform. Padding on the scrolling
element is INSIDE the scroll box: away from the ends of the range, content slides under the rail.
**Rejected.** Gating the gutter on whether a rail is showing: the panel then flips between symmetric
and lopsided as its content grows, which `overlay` does not, being fixed by one caller's width.

## Two shells, one breakpoint
**Decision.** Two layouts and one switch — `md`, 768px, WRITTEN TWICE, in the markup and in
`useIsDesktop`, and the two must stay one number. Below it the sidebar is an off-canvas drawer, a
Radix `Dialog`, so the focus trap, Escape, scroll lock and focus return are the library's; at and
above it the sidebar is a panel in flow or an icon rail, and the choice persists. Collapsed, the
header carries the figure and the dataset caution, the two things a 56px shell cannot hold. 44 × 44
is HIT AREA, never geometry: a transparent centred overlay grows the pressable region and leaves
every radius where the shape system put it. Exactly one branch mounts per shell. A page with no
portfolio behind it — signed out, a refused caller, the first sign-in, the app that failed — mounts
NEITHER: a top bar with the mark and the language control over one top-anchored card, `md` still its
only breakpoint.
SIGNED IN, THE ACCOUNT IS EVERY FOOTER BAND'S LAST CONTROL: in the panel and the drawer the address,
then a sign-out pill in Settings' recipe, above the version; in the rail a sign-out item, the rail's
foot reading in the panel's order — currency, Settings, sign-out. Their slot is HELD until the relay
answers, after a load it never answered too; a host with no relay is answered at once.
**Why.** Growing controls to 44 would rewrite five radii and a concentric chain as a side effect of
an accessibility fix. A control with no drawn box gets real padding instead, an overlay reaching
past its own control handing the tap to the neighbour. Both shells carry a portfolio — the capital,
the dataset, the reminders — that such a caller does not have, and the card is top-anchored
because a centred one moves its button under the pointer whenever its height changes. A sign-out
must be visible and reachable from every page that has a session (OWASP's *Logout Button*, ASVS
7.4.4), and the owner ruled it last; a footer band is anchored to the bottom and grows upward, so
rows appearing on the session's answer would move every target above them — held, they fade into
their slot, and only a signed-out load sees the band close once.
**Rejected.** A theme control in the rail: one glyph cannot show the two states it is not in, where
currency's box shows the state you are in. · An account menu: a second press for one item, where
the menus it copies switch accounts. · An avatar: only asset avatars and colour dots are round. ·
A sign-out offered to every visitor regardless of session: a way out for someone never in.

## Not found and failures
**Decision.** The router's own fallback is never shown: three boundaries replace it. THE ROOT ROUTE
CARRIES THE APP-FAILURE PAGE, for a throw in `Root`, in `Layout` or on a signed-out page, and
`main.tsx` renders the same page when the database cannot open at boot. It stands in the signed-out
frame, having no shell left to keep, and owns `<html lang>` and the theme while `Root` is not
mounted. A PATHLESS ROUTE BETWEEN `Layout` AND THE SCREENS carries the failed-screen state, so a
screen that throws keeps the sidebar and reaching any route clears it. A `*` among the screens
catches every other path, `/sign-in/x` too, inside the shell. Each state is an answer's block — a
muted glyph, the title, the lead, one button — and in the shell its card sits where the signed-out
card does. The two failures share their words and one reload; not found sends to `/`. NO STATE SHOWS
THE ERROR, a status code or a stack: the router and React log what a boundary catches, and the boot
logs its own.
**Why.** GOV.UK asks for the same page for all unexpected problems, and for no jargon like 404, no
"oops" and no red. OWASP logs the details and returns none to the user, and the console is this
app's log. React Router renders a boundary in place of its own route's element, so where a boundary
sits decides what survives the throw.
**Rejected.** A loading state, `HydrateFallback` or `Suspense`: no route loads and nothing suspends.
· A real 404 status: the host rewrites every app path to the SPA with a 200. · A "Try again" that
re-renders in place: with no loaders to revalidate, a location change is the only reset this app's
router has, a render that threw usually throws again on the same data, and a reload also drops the
in-memory caches a re-render keeps. · Reporting errors to a service.

## Brand
**Decision.** The product is Quirenote and the domain is `quirenote.com`. The logo is the 5h mark,
all stroke and no fill, and it SHIPS IN THREE FILES and is DRAWN IN FOUR: `src/app/Sidebar.tsx`,
`public/favicon.svg`, `public/apple-touch-icon.png`, and `scripts/build-touch-icon.mjs`, which
generates the raster. Edit the mark and all four move. Its three parts take PER-THEME tokens, so the
mark inverts with the app; the two that hold the mark as literals, the favicon and the script, copy
those values, neither having a token to read, and the favicon's light trio is its default branch
because Safari ignores the colour-scheme query.
**Why.** The box is the design sheet's own and is not cropped to the ink: a box measured off the
geometry rather than the paint clips the mark's caps, a bbox ignoring stroke.
**Rejected.** A hosted DNS zone: a standing monthly charge for records any registrar serves free.

## The price archive
**Decision.** A daily job archives prices into Aurora DSQL; the app does not read it yet, and the
one way into it from a user stack is `archive_reader`, read-only (*Cloud target*). It buys
the provider's DEALER QUOTE, which exists nowhere else, and the funds' NAV series, both captured
nightly from the provider's offer page (*External sources*); a night the page is not read is a
dealer quote the archive will never hold. NBU
fair value is a different basis, archived from each bond's issuance, and the two are NEVER merged.
The observation key is `(as_of, instrument_ref, basis, source)` and immutable: a wrong key is a
DROP/CREATE of a live archive. `as_of` is per source, the observer writes every day, an imported
file is not archived but its rows are, and the provider's FX rate is stored nowhere at all. Where an
imported history stops short of a source's first capture in this archive, the days between are a
SEAM: prices that existed and that the archive does not hold. It closes only if the provider
publishes further, and the funds' seam is not expected to, the provider having moved that history
into its app. Until then the seam is ABSENT in the archive: no other source, basis or derivation
stands in for its NAV. A reader meets it as a real gap — between `listed_from` and `last_seen_on`
the fund existed, so a day there with no row is unobserved, never delisted — and `diagnose` counts a
seam's days and lists the latest of them by date.
**Why.** Writing every day keeps a zero delta distinct from an unknown one — a row missing on a
quiet day is byte-identical to a capture that never ran. Premises are kept forever, conclusions
never. A NAV the archive never received can only be concluded, not observed: statistical exchange
flags such a fill as a receiver's imputation (SDMX observation status I), apart from data that
existed and was not collected (L).
**Rejected.** Alarming on a price that did not move: maintenance, a weekend and a holiday all trip
it, so every capture check is structural and none reads a price. · Archiving the price file beside
its rows: the rows are the premise, the packaging is not. · Filling the seam's NAV from the owner's
position values: value over units is the dealer's `sell`, and reaching `nav` takes the spread as
well — an imputation from three figures, none of them a NAV. · Watching for a new cut of the price
file: with the history moved into the provider's app, the watch would wait on a file with no sign of
coming; a file published after all is imported manually, and the import writes only the days the
archive lacks.

## External sources
**Decision.** The list is closed: the provider's asset feed, which the app fetches only on the
user's click, its bond offer page, which the capture reads, its price files and the CMS document
list that names them, and the National Bank — daily fair-value files and the official rate. The
offer page carries the dealer quote: the catalogue in the page's serialized state, decoded with
`devalue`, the site's own serializer, and the bonds' schedules in one island's props, the state
carrying them empty. The page names a fund by its core id alone, so a fund is keyed through the
id/slug pairs the asset feed published, and an id outside them is skipped by name. The price files
are listed in the provider's CMS, `api.inzhur.reit/cms`, one document category per fund, which each
fund's offer page requests to render its documents. The import sends the page's own request for a
category id it holds fixed, so an id the CMS no longer answers throws rather than yielding a guessed
link; each upload's URL carries a random suffix, so the link is re-read from that list on every run
and no file URL is polled. SMIDA's open-data API is alive and is never fetched by our code,
categorically; `stockmarket.gov.ua` is dead. Every request the capture makes to a source, each
redirect hop included, is first checked against its host's `robots.txt` — a file RFC 9309 always
allows, read per that RFC under the product token `quirenote-price-capture`. A disallowed hop fails
the fetch without being requested and is not retried: the refusal settles its day, as a day NBU
publishes no file does, so no later firing asks again. The capture refuses the asset feed on that
rule: it redirects into `/dashboard/`, which the provider's crawl rules disallow. The official rate
is the user stack's fetch, not the capture's: each user cluster keeps one row per Kyiv day, stored
ahead by a schedule once NBU has set tomorrow's rate, in a transaction holding that insert alone.
`infra/src/official-rate.ts` also holds the read `/view` is to make, which no route calls yet:
today's row, else a fetch stored the same way, else the latest earlier rate under its own date. A
failed fetch is stored nowhere, and the same reader does not ask again inside RFC 2308's ceiling
on caching a failure. The fetch is no crawl and checks no
`robots.txt`.
**Why.** A blanket `Disallow` is final even where a statute licenses the use: any exception is a
rule every future source inherits with no bright line. And a false "this source is dead" does not
fail loudly, it stops anyone looking again. RFC 9309 binds the URI requested and exempts none
reached by a redirect; Scrapy, Nutch and Heritrix each check the target before requesting it. The
offer page serves every price, rate and schedule the feed served for the instruments it listed,
and reshaped into the feed's entries it is read by the feed's own parser, so the archive keeps one
basis across the switch. NBU Board Resolution 148 sets a date's official rate on the working day
before it takes effect, and weekends and holidays keep the last one, so every date answers and a
stored row is final. A Lambda's module scope cannot hold the day's rate, each concurrent request
running in an environment of its own, so it is a row. Serving the last good rate on a failure is
RFC 5861's stale-if-error, labelled with its date as the client's fallback labels it. RFC 9309
scopes robots rules to crawlers, and bank.gov.ua's robots file disallows nothing.
**Rejected.** Crawling a disallowed path while claiming to respect the site's rules: self-refuting.
· Checking the first URL only: a redirect would then carry a fetch past the rules unseen. · Any
other path on the provider's API host: it publishes no robots.txt, but none of the conventional
OpenAPI or versioned paths answers, and guessing at an undocumented API is not a source anyone
published — the document list is read because the provider's own page sends that request. · A
hand-written decoder for the page's state: the site's serializer reads it exactly. · The rate in
the archive: a user stack cannot write it, and the archive keeps the provider's conversion out on
purpose. · A rate fetched live per request and cached in memory: the next concurrent request runs
where that memory is not.

## Alerting
**Decision.** No SNS topic, and the alarms carry no `AlarmActions` at all: CloudWatch publishes
every state change to EventBridge regardless of actions, so delivery is EventBridge → AWS User
Notifications → the Console Mobile App, and an alarm with no action still alerts. The channel
measures itself: the capture emits its channel count on every run, healthy or not, readable with no
delivery at all. Backup freshness, the free tier on monthly actives and the age of the official
rate served take the same shape, each watched by the stack that owns it. A count that could not be read THROWS rather than publishing
zero, which on a `GreaterThan` alarm is the healthy side. The set overshoots the always-free tier
knowingly; THE COUNT GROWS AT TWO PER PUBLISHER PLUS ONE PER WATCHED VALUE — a check's silence and
its errors, then one alarm for each published number a threshold can be right for — and `DlqAlarm`
sits outside that rule, its depth published by SQS rather than by any check here.
`infra/src/stack-split.test.ts` holds the names and the overshoot as a subtraction, after a
thirteenth alarm passed every gate.
**Why.** An alarm that cannot deliver is worse than none: it turns an unmonitored system into one
everybody believes is monitored. A liveness signal cannot arrive through the channel it is checking,
so its primary form is a value someone can look at.
**Rejected.** An SNS topic with an email subscription: three subscriptions across two topics died
within seconds of confirmation, invisibly — do not add the topic back. · AWS Backup's own
`NumberOfRecoveryPointsCompleted` in place of a per-cluster check: it is dimensioned by VAULT, so
one cluster's nightly job keeps the number up while another has silently left the selection.

## Cloud target
**Decision.** Aurora DSQL with Lambda, IAM auth and EventBridge, and no VPC. At the migration the
DERIVATION MOVES TO THE SERVER: the API Lambda imports the same `@quirenote/core` modules the app uses —
an import, never a port — while raw rows stay on the export/import path. The environment split stops
at USER data, and it is THREE STACKS: the archive and its capture, deployed from `dev` alone because
one archive serves every environment, and one DSQL cluster of user data per environment, deployed
from the branch that owns it. The migration runner follows the schema it applies rather than the
stack it started in, so each user cluster has a runner that can reach no other cluster at all. Any
statement over the archive is bounded by a SQL date window, and completeness names both bounds, the
row limit first. A USER STACK READS THE ARCHIVE AS `archive_reader` ALONE: `SELECT` on every table
in the archive's `public` schema, those the capture creates later included. Each time the grant
runs it checks the reader's effective privileges over every object type PostgreSQL keeps
privileges on, and what it owns, and fails the deploy when the reader can do more than read: write
a table, column, sequence or large object it was given, create in a schema, database or tablespace,
pass a read or a schema's use on, run a function as its owner, use a foreign server, alter a system
setting, own anything, hold a role attribute beyond LOGIN or a membership, or be given by a default,
its own or PUBLIC's, a write, a CREATE or a grant option. It repairs nothing it did not grant, and
fails closed: the reader is left with no mapping until an admin removes the privilege.
The role is mapped to `quirenote-backend-archive-reader`, a fixed-name role the ARCHIVE stack owns
with `dsql:DbConnect` on that cluster and nothing else, whose trust admits a user stack's view
function by a pattern on `aws:PrincipalArn`; nothing assumes it until that function exists. The
archive's identifier reaches a user stack as a deploy parameter the workflow reads off the archive's
outputs. The mapping is granted by a custom resource in the archive stack, admin's second holder
there beside the capture, which revokes every mapping and grants the current one on its creation and
whenever one of its properties changes: the role's ARN, the cluster, the hash of its own code or
its timeout.
**Why.** One implementation cannot be a second source of truth, which is the objection to server
derivation and the reason importing answers it. The archive is public reference data, so a second
copy would be a second history to keep honest and worthless anyway, its value being its
accumulation; user data is the opposite on both counts. AWS's guidance for DSQL keeps the admin role
out of everyday connections. A DSQL mapping binds the role behind an ARN, not the ARN: a role
replaced under its own name is refused while the mapping still lists it, and only a revoke and a
grant re-bind it (`infra/docs/dsql-constraints.md`). So the mapping names a role whose stack re-runs
the grant, and the trust names a pattern, because IAM stores a `Principal` ARN as the role's unique
id and a condition key's ARN as written. The grant runs at deploy and the capture creates its tables
at run time, so the reader's tables come from default privileges, which DSQL applies to a table
`admin` creates afterwards; the archive holds public reference data only, so no table in it is one
the reader should not see, and a test lists the tables and views the infra modules create so that
a new one is reviewed before the reader can read it. A privilege can come from a name, a column,
`PUBLIC`, a membership or a default set for one schema or for all of them, so the check reads what
the reader can do rather than where a grant came from.
**Rejected.** A service worker: the most browser-divergent layer in the plan, bought for an offline
the plan had already given up. · A mapping naming a user stack's function role: the archive deploys
from `dev` alone, so a role `main` replaced could not be granted again. · A `Principal` naming those
roles by ARN: it goes stale when SAM replaces one. · `Fn::ImportValue` for the identifier: an
imported output pins the stack exporting it, and the user stack deploys first. · A grant by a
fixed list of table names: it ran before the capture had created a fresh archive's tables, or a
newly added one, and failed the deploy. · Revoking each extra privilege by its source: a source the
sweep does not name survives it, and there is always another to name.

## Auth model
**Decision.** Cognito Essentials behind a JWT authorizer, and ONE POOL PER
ENVIRONMENT — a shared one would spend a production monthly active user on every dev sign-in and put
dev identities in the table a real portfolio is keyed by. The passkey relying party is the
environment's own APEX: an RP ID cannot change afterwards without stranding every credential
registered against it, and `reference/COGNITO-POOL-PARAMS.md` carries its cost. SIGN-IN GOES THROUGH
A RELAY ON A CONFIDENTIAL CLIENT — RFC 10017's token-mediating backend, `/auth/*` on the API — which
holds the only copy of the client secret, so no sign-in skips it. WHERE EACH TOKEN LIVES: the
refresh token in a `__Host-Http-` cookie on the API host, HttpOnly, Secure and SameSite=Strict,
which the relay alone sets and reads; the ID token, which the authorizer checks, comes back in the
relay's body and is held in the app's memory. THE ACCESS TOKEN STAYS WITH THE RELAY: it registers a
passkey, and it also authorizes `DeleteUser` and an address change the pool asks no verification
for, and RFC 10017 §6.2.2.3 says a backend whose token "features a superset of the scopes requested
by the frontend" "SHOULD NOT return it to the frontend". It is sealed into one more `__Host-Http-`
cookie, because §6.1.3.2 says a BFF whose cookies hold access tokens "SHOULD encrypt its cookie
contents": AES-256-GCM under a key HKDF draws from the client secret, as Auth.js draws its own from
`AUTH_SECRET`, so there is no second secret to store. The cookie lives as long as the token and is
cleared wherever the refresh cookie is, and revoking a refresh token revokes every access token it
issued (AWS, *Ending user sessions with token revocation*).
SIGN-IN IS THE APP'S OWN SCREEN, not managed login: a deviation from RFC 10017 §7.3, which says a
browser app on OAuth or OpenID Connect "MUST use a redirect-based flow", ruled by the owner knowing
it. It is IDENTIFIER-FIRST because the pool is — Cognito issues no passkey challenge without a
username — so the address goes first with `WEB_AUTHN` preferred, an account with a passkey gets the
OS sheet at once, and every other answer leads to the password, proved over SRP so it never leaves
the page. The password step starts afresh rather than answering the address step's session, which
lives three minutes and, once expired, is refused like a wrong password. THE FIRST SIGN-IN SETS THE
ACCOUNT'S OWN PASSWORD: the invitation's temporary one answers `NEW_PASSWORD_REQUIRED`, each submit
proves the temporary password afresh for the same reason, and the pool's rule is on screen before
any refusal. The new password travels in the body, as that challenge takes it — Cognito has no SRP
form for setting one. THE TEMPORARY PASSWORD NEVER BECOMES THE ACCOUNT'S OWN: it sits in an
invitation mail, and OWASP ASVS 5.0 6.4.1 says initial secrets "must not be permitted to become the
long term password". So the pool keeps a password history of 1, which refuses it at the first
sign-in. One is the current password alone: Microsoft Entra's rule on a change ("The last password
can't be used again") and the least that meets 6.4.1, and nothing cited asks for more. The relay
answers that refusal apart from a weak password, and the app says it in a sentence of its own that
names the temporary password, since under a history of 1 it can be no other. THEN A PASSKEY IS
OFFERED, and again after every password sign-in while
`ListWebAuthnCredentials` lists none; an answer Cognito cannot give offers nothing, and no «not now»
is remembered. REGISTRATION AND THAT LIST GO THROUGH THE RELAY, `/auth/passkey/list`, `/start` and
`/complete`, which makes each call with the token it sealed: token-authorized operations, which take
no secret and no IAM grant. No passkey call writes a cookie, so none takes the lock below, and Start
stays the one fetch before the OS dialog, the most Safari before 17.4 waits through. EACH CALL NAMES
THE ACCOUNT ITS TAB SHOWS, the ID token's `sub`, and the relay acts only when the sealed token is that
account's: the cookie is the browser's, and another tab's sign-in replaces it. The sealed token lives
as long as the ID token set beside it. The list and Start each first ask for the account, which
refreshes both when under a minute is left; Complete, after the OS dialog, names the account Start
was given. A GOOGLE SIGN-IN'S TOKEN MAKES NO PASSKEY CALL: those calls require
`aws.cognito.signin.user.admin`, which every API sign-in's token carries and a Google sign-in's lacks,
the client allowing only `openid email profile`. So no offer follows a Google sign-in, and a tab whose
cookie another tab's Google sign-in replaced lists and registers none until it signs in with its
password again.
COGNITO'S LOCKOUT ANSWERS
429, told from a wrong password by its message alone. OWASP's Authentication Cheat Sheet lists a
locked account among the cases one generic error should cover. What that guards against, a
difference that shows whether an account exists (CWE-204), the lockout does not add: an address
with no account is locked out after as many failures and answered alike, and a locked-out account
with a passkey is still offered it (`reference/COGNITO-POOL-PARAMS.md`). THE RELAY ANSWERS
`PasswordResetRequiredException` AS A WRONG PASSWORD, 401, the app offering no reset: AWS documents
that answer in its place for an imported user while user existence errors are prevented (*Managing
user existence error responses*), and some addresses with no account meet it at every start, so a
401 there does not show that the address holds one. The address step, having asked for no
password, shows it as a sign-in that couldn't finish. The SRP maths is Amplify
JS's, ported onto `BigInt` and WebCrypto; the WebAuthn JSON is `@simplewebauthn/browser`, because
the native `parseRequestOptionsFromJSON` arrives in Safari 18.4 and the build targets Safari 16 —
though sign-in starts at 16.4, the first to send the `Sec-Fetch-Site` the relay admits a caller by. ONE
WEB LOCK ACROSS TABS covers every relay call that writes the cookies — refresh, the sign-in's
respond, sign-out — held until the answer lands: two refreshes with one token fork the family and
the jar keeps whichever answer lands last, and a refresh answering after another tab's sign-in
writes an ended family's token over the new cookie. The relay and the pool are looked up by the
page's host, which is what the relay admits a caller by. THE PORTFOLIO SHELL ASKS FOR THE SESSION ON
EVERY LOAD, in either dataset — the session is the browser's, not the demo's, and the demo withholds
market data, not this — and once the relay has answered, a page asks no more; so a sign-out
is offered only once the relay says someone is signed in. The account's address is the ID token's
`email`, READ AND NEVER VERIFIED, a label only: the ID token is the client's to read, and the API
verifies every token it is sent.
The relay reads the secret from Cognito with `DescribeUserPoolClient` and caches it per execution
environment, so there is no second copy to drift and no store to pay for; its routes refuse a
request without the custom header or from another site before anything else. THE REFRESH TOKEN IS
BOUNDED AND ROTATES, which answers the three refresh requirements the browser BCP singles out and no
more: that section incorporates RFC 9700, whose replay rule Cognito meets only in part — past the
grace window it refuses a rotated-out token and revokes nothing, and inside the window a replay
succeeds and forks the family, so the app refreshes once at a time across tabs. THE RELAY KEEPS THE
FAMILY'S ORIGINAL, to revoke on a replay that arrives with it: only the live token or the sign-in's
own ends every branch when revoked, and the relay cannot know which branch is live. A second
`__Host-Http-` cookie holds it, set at sign-in and never re-set; a replay revokes the original sent
beside it. SIGN-OUT AND A COMPLETED SIGN-IN REVOKE BOTH REFRESH COOKIES' TOKENS, a token both hold
once:
the two can belong to two families — a refresh answering after a new sign-in overwrites one —
Cognito revokes a family and never the browser, and a token forgotten unrevoked refreshes until its
family's lifetime ends, while revoking a dead one costs a call (RFC 7009 §2.2). A sign-out that
cannot revoke one keeps every cookie for its retry; a sign-in completes regardless, the old family
capped by its own lifetime. Cognito has no inactivity expiry, so the idle timeout is the refresh
cookie's `Max-Age`, re-set on every refresh — a UX bound and not a security boundary. The original's cookie
lives as long as the family can instead — each rotated token is valid "for the remaining
duration of the original refresh token" it replaced, AWS says — so a live family whose session
idled out still has its original in the browser, and the next sign-in there revokes it.
GOOGLE IS THE ONE SIGN-IN THAT LEAVES THE PAGE, and still not for managed login: `/auth/google/begin`
answers an authorize URL naming `identity_provider=Google`, which Cognito says "silently redirects
your user to the sign-in page for that identity provider", and Cognito's code comes back to
`/auth/callback`, which hands it to `/auth/google/complete` under the one lock. The relay redeems it
at the token endpoint with the secret in Basic, and sets the cookies as any sign-in does. THE FLOW IS
BOUND TO THE BROWSER THAT BEGAN IT — PKCE "securely bound to the client and the user agent", RFC 9700
§2.1.1 — a fresh state and S256 verifier per redirect in one more `__Host-Http-` cookie, for the
fifteen minutes Auth.js keeps its own pair; a code arriving with no verifier or another flow's state
is refused before it is redeemed and leaves any flow in progress alone, and a code the token
endpoint refuses spends its own. THE APP LEARNS WHETHER GOOGLE IS ON FROM THE REFRESH ANSWER every
load already asks for, so knowing costs no call of its own — Supabase publishes the same flag on
`GET /settings`. The relay reads it from the client's providers, again once five minutes old, since
a deploy that turns Google on or off changes the client and not the relay. Until the answer lands the
card holds the pair and the link beneath it, which the pair arriving later would push under a
pointer; after a load the relay never answered the link shows, and a pair arriving later fades in. BEGIN SENDS `prompt=select_account`, which Cognito forwards to Google, so
after a sign-out the next Google sign-in asks which account rather than signing the last one straight
back in. EVERY SIGN-OUT WHILE GOOGLE IS ON LEAVES THROUGH COGNITO'S LOGOUT, the only way its session
cookie is cleared — `GlobalSignOut` "doesn't clear the managed login session cookie" — so the relay
names the endpoint and the app goes there, to land on `/sign-in` or `/apply`, the two sign-out URLs
the client lists; a tokenless sign-out too, since nothing the relay holds says whether the browser
has a session there. The button is Google's: its colours per theme and its
face, Google Sans Medium, as the branding guidelines fix them for "the app verification process", and
the bundle's own G cropped to its box.
Registration is an APPLICATION,
not an open door — threat protection is a paid tier, so a public door has only quotas: sign-up
writes the row that carries status and role, and approval mints the identity — so approve is a
Cognito write and a row REPLACEMENT, a DSQL primary key being immutable. AN IDENTITY IS DELETED BY
HAND OR NOT AT ALL: no handler holds `AdminDeleteUser`, and `DeleteUser` takes an access token no
page holds. Cognito fires no trigger on a deletion, so whoever deletes an identity clears its
`app_user` row, as Auth0, Okta and Entra keep deletion on the backend, and nothing watches for one.
Until the app offers a deletion of its own, the operator erases an account on request. THE
APPLICATION IS THE APP'S
OWN FORM, `/apply`, one address posted with no cookie, since its route reads none; the endpoint
answers every address with one constant, so the form can say only that it was recorded. A CALLER THE
API REFUSES on a route every user may call — pending, rejected, no application, forbidden — sees that
answer IN PLACE of the route that asked, held in memory, and every way out it offers is a sign-out; an
admin route also answers `forbidden` to an active user who is not a super-admin, so its `forbidden` is
not read that way. A SIGN-OUT THAT LANDS ON `/sign-in` SAYS SO THERE, ONCE: the fact rides the navigation
as router state, and the page replaces its own history entry the moment it arrives, a status line
above the title that submit empties and holds. Through Cognito's logout the page arrives by a load
from another origin, which router state cannot cross, so this tab's session storage carries the fact
and the page forgets it once read.
**Why.** Nothing decided at token-issue time can revoke anything, at any lifetime, so authorization
belongs to the API, read from that row on every request. A refresh token script can read outlives
the page that stole it; one in an HttpOnly cookie, exchangeable only with a secret the browser never
holds, leaves injected script the ID token and nothing longer-lived. The access token is kept off the
page because nothing in Cognito narrows what its holder may do: `DeleteUser` evaluates no IAM, an
API sign-in's token carries `aws.cognito.signin.user.admin` and no other scope, and the pool offers
no trigger on a deletion. `DeleteUser` refuses the ID token (`reference/COGNITO-POOL-PARAMS.md`).
A finished sign-out should land on a page that "clearly indicates" the user is no longer signed in
(web.dev, *sign-out best practices*), announced as a status without taking focus (WCAG 4.1.3); the
browser keeps `history.state` across a reload and Back/Forward, so a fact read and left in place
would be said again on every one of them.
The offer is Google's passkey journey — "authenticating the user as usual, let them know they can
create a passkey, trigger the OS dialog for passkey creation, and then let them know that the
passkey was successfully created" — and Amplify UI's Authenticator, which lists the credentials
after a sign-in and prompts only on an empty list. It prompts when the list errors too; here that
would invite the `InvalidStateError` of a passkey that already exists, of which web.dev says "The
site shouldn't treat this as an error."
**Rejected.** As the relying party, a Cognito prefix domain — a later move to the custom one strips
the passkeys registered against it — or the auth host, which would scope every credential to managed
login alone. · A post-confirmation trigger creating the row: AWS does not invoke it for an
admin-created or a federated user, the two routes into the pool that matter. ·
Cognito groups as the role: status and role are application state, decided and stored by the
approval this system performs, so a group is a second place for them to live and the two can
disagree; freshness is the lesser argument, a group riding on tokens that last an hour. · Letting an
open-registration sign-in approve its own earlier application: convenience, and a way to overturn a
rejection by signing up again. · A public client, the app signing in with Cognito itself: `InitiateAuth` hands
the refresh token to whoever calls it, and injected script could run a sign-in of its own. · The full
BFF, every data call proxied through a function holding the session: each call would spend the
account's shared Lambda concurrency, and a refusal that must land before any Lambda is invoked could
only land inside one. · The secret in an SSM SecureString, which CloudFormation cannot create, so a
hand copy per environment; in Secrets Manager under a key of its own, a fixed monthly charge on the
standing "no" list; or in an environment variable, where AWS points to Secrets Manager instead. ·
Managed login as the sign-in surface, the redirect RFC 10017 §7.3 asks for: the owner ruled for the
in-app screen. · Amplify JS: it never computes a `SECRET_HASH`, so it cannot talk to a confidential
client. · `cognito-srp-helper`: one maintainer, a bundle far past the port, no `sideEffects: false`, and
`@types/node` at run time. · Passkey autofill (conditional UI): it needs a challenge before anyone
types, and this pool gives none without a username. · Build-time settings for the relay and the
pool: a build can disagree with the host serving it, and the host cannot. · A who-am-I route to learn
the four answers: every authenticated route reads the same row and answers them, so the first read
the app makes serves, and a route of its own would cost an invocation on every sign-in. · Asking for
the session in the live dataset only: demo is the default a sign-in lands on, and it would offer that
user no way out. · The signed-out confirmation as a toast: it leaves on a timer, and a toast here
reports on the page the user stays on. · Deciding the offer from the address step's answer, a
`SELECT_CHALLENGE` without `WEB_AUTHN`: it depends on which way the user reached the password, and no
source documents it as a signal. · The access token in the page, where the relay handed it: any
script there could delete the account or change its address. · WAF on the pool, which does block
`DeleteUser`: a fixed monthly charge per web ACL and per rule, on the standing "no" list. ·
Suppressing that scope in a pre-token-generation trigger: the three passkey calls require it, so it
ends passkeys. · The access token in a plain HttpOnly cookie: RFC 10017 §6.1.3.2 asks for it
encrypted, and malware reading the cookie store would hold a token that calls `DeleteUser`, which the
refresh token cannot do without the secret. · A refresh per passkey call, keeping no access token:
each call rotates the family, so each would take the cross-tab lock, and Start would wait on it
before its fetch — a wait after which Safari before 17.4 opens no dialog. · Passkey calls for
whichever account the cookie holds: a tab another tab's sign-in replaced would bind a passkey to an
account it does not show. · A standing watch for a
deleted identity: an EventBridge rule on `DeleteUser` needs a CloudTrail trail, which this account
has none of, and is delivered best effort; a daily reconciliation would add alarms under
*Alerting*. With the token off the page, nobody deletes an identity unseen. · Beginning Google as
the sign-in page loads,
Ory's flow-first shape: an invocation and a flow cookie for every visit, and a flow gone stale by
the time of a late click. · A Google flag in the host table: a deploy that drops the credentials
would leave the button standing. · Leaving through Cognito's logout only after a Google sign-in: one
more cookie to remember one, and the relay guessing at a session only Cognito can see. ·
`prompt` left out, or `login`: without it a live Google session signs the last account straight
back in; `login` asks for Google's password every time. · The flow's pair encrypted, as Auth.js
keeps its own: HttpOnly and `__Host-` already keep it from script and other hosts, and neither half
is a token — the verifier redeems nothing without the code Cognito sends to this browser, which
lives five minutes. · A reset-required account answered apart, as Amplify JS makes it a
`RESET_PASSWORD` step: the app has no reset to lead it to.

## User schema and deletes
**Decision.** DSQL's DDL is create-time-only and a later constraint is `NOT VALID` for life;
`infra/docs/dsql-constraints.md` carries the measured matrix. The generated DDL is APPLIED BY A
RUNNER, and the deploy that ships it is what starts it: the runner rewrites each statement on the
way out to what DSQL accepts and records each in a ledger keyed by its content hash, so a file may
be re-run after it grows statements and only the new ones execute. `deploy-backend.yml` plans
against the stack it has just updated and, where anything is pending, rehearses on that cluster and
applies — in a job of its own, with no human in front of it and a failure that opens an issue. A
hand dispatch is the repair path and the only way to bootstrap. EVERY RUN REPORTS ITS OWN WALL TIME,
per file and for the run, because a rehearsal replays the whole history — its ledger lives inside
the throwaway schema, so nothing is ever skipped — and that cost grows with every file added. The
runner holds back enough of its invocation to drop that schema and REFUSES TO SEND A STATEMENT WITH
THAT RESERVE ALREADY SPENT, naming it and what each file it ran cost, rather than being killed
at a ceiling already set to the service maximum. That bounds when a statement STARTS and not how
long it runs: one wait that overruns alone is still a kill, and a rehearsal killed that way is not
applied, the overrun being possibly the SQL's own. A REFUSED REHEARSAL IS REPAIRED BY AN APPLY:
the statement it refused was never judged, and replaying the whole history it can never get
further, while an apply resumes off the ledger. THE CODE IS LIVE BEFORE THE SCHEMA, the SQL riding
in the deployed bundle, so every migration MUST BE WRITTEN expand/contract-compatible with the code
already running — the ordering imposes that on each migration's author, and nothing in the pipeline
can check it.
Foreign keys are `ON DELETE RESTRICT`, never cascading, and deleting an asset is an APPLICATION
cascade, children before the parent, in batches, every predicate scoped by `user_id`. A user and
their one account are written in the SAME transaction by the gate's open-registration insert, by
approval's rekey and by the bootstrap mode — each idempotent, so a re-run leaves one account. The
gate's and the bootstrap's retry on a serialization failure; approval's does not, a retry there
re-running an insert whichever concurrent approval won has already made. A PENDING application is
written by neither and provisions nothing: approval DELETES that row to rekey it onto the minted
`sub`, and a key restricted on delete would refuse that. The demo identity is written by a
migration, so its account is too, in a file of its own.
**Why.** Generated DDL carries no `IF NOT EXISTS` and DSQL has no cross-statement rollback, so a
file that fails partway cannot be retried — the retry dies on the first statement, which already
exists. The mutated-row ceiling is per transaction and one asset's saved prices can exceed it, so
batching is the only shape that works; a cascading key would not remove it, cascaded rows counting
against the same ceiling. `transaction.account_id` is NOT NULL against a composite key, so a user
without an account is not an empty state any screen can render — every write is refused — and both
rows living in one database makes one transaction the whole answer to a partial failure. `ON
CONFLICT DO NOTHING` prevents a duplicate row and not the commit-time conflict optimistic
concurrency reports, which is why the retry is not that clause's job.
**Rejected.** Tombstones: a `deleted_at` puts a filter in every read that the first forgotten one
turns into deleted data rendered as live. · A migration started by the capture function: the
schedule and the DLQ behind it would each become a starter, and what may start one is the deploy
that ships it, plus an operator watching. · A required reviewer in front of the apply, built and
removed: the rule gates a whole ENVIRONMENT, so it needed a `migrate-prod` of its own — `prod` also
admits the frontend deploy — and the click it bought carried no evidence, being spent before the
rehearsal ran, on a statement count, by the person who had just fast-forwarded `main`. A failure
that reaches the task list is the stronger half of what it was for. · Provisioning the account
lazily, on first write: the get-or-create race, moved into the one path that cannot absorb one. ·
An outbox or a saga around the two writes: both buy atomicity from outside a database that already
gives it. · A CHECK enumerating `provider`:
no constraint here names a specific holding, and a CHECK added after the fact is `NOT VALID` for
life, so a widened vocabulary would be a rule the rows already there were never held to. · A `since`
bound on the rehearsal, replaying only what the plan reported pending: the ledger a rehearsal reads
is the empty one inside its own throwaway schema, so the files a bound would skip are the ones the
rest resolve against. · A raised runner `Timeout`: it already sits at the service maximum, so there
is no headroom to buy.

## Git model
**Decision.** `dev` integrates and deploys to dev.quirenote.com; `main` is production and moves only
by fast-forward, when a version is cut or on demand. Every change reaches `dev` on a
`<type>/<kebab-title>` branch and arrives by squash-merge, no diff too small — `dependabot/…` is the
one naming exception. No merge commits; rulesets hold both branches to linear history with no bypass
actors. Every `gh` call runs under the pinned `GH_CONFIG_DIR` and `gh auth switch` is FORBIDDEN. No
git artifact carries AI attribution.
**Why.** "Small enough to skip the branch" drifts one commit at a time, and only in one direction.
Two accounts share the machine's keyring, so switching the global default yanks another repository's
session — `origin` is an SSH alias, so `git push` is unaffected.
**Rejected.** Promotion on a calendar: a fence around the judgement a version bump already makes.

## Work tracking and documentation
**Decision.** GitHub Issues and the Project's `Status` field are the only task list; nothing in the
repository says what to do next. An issue is worked only from `Ready` — criteria a test or a browser
check can verify — one issue, one branch, closed by `Closes #N`. Milestones are releases, and every
open issue, once triaged, sits in the version milestone it is planned for, none below the next
release; work is picked from the lowest open one, so milestone order is work order, except that an
`observation` is picked once the date in its title has come, whatever its milestone, and never
before. Inside that milestone the order of its cards on the Project board is the pick order when
the owner names no issue, a `bug` first; the `order-milestone` skill rewrites it after a triage, a
planned epic and a version cut. Delete, never archive; a figure lives in a test or not at all;
`CLAUDE.md` is rules.
**Why.** A task list in two places disagrees with itself. An issue with no milestone has no place in
that order, and the sort decays one triage at a time; an observation waits for its day, not its
turn. A figure written into prose goes stale in silence and passes every gate; a test fails.
**Rejected.** Jira or ticket keys: one person, no board. · A `Backlog` milestone: it holds exactly
the issues nobody has ordered. · A pick-order file in the repository: a closed issue stays in it
until the next triage, where a closed card leaves its column by itself. · Documentation ratchets: a
guard bumped on every routine edit is a rehearsal for bumping it unread.

## Review, gates, tests
**Decision.** `/code-review` runs on the whole branch diff before every squash-merge, documentation
included; findings are fixed, or declined in the squash commit body with the reason. One round is
the norm and three is the cap; a fourth means the branch is wrong, so a root-cause comment on the
issue comes first. The gates are lint, typecheck, test and `format:check`, which skips Markdown on
purpose, plus `tsc --noEmit -p infra` when `infra/` or the domain package changes. A site that
DISPATCHES on a transaction type answers for every type or it does not compile, and a suite iterates
a `Record<TxType, …>` rather than a literal array; `unnamedType` returns its fallback rather than
throwing, that arm being reachable by a row an unmigrated store still holds. A CloudFormation
assertion that depends on an intrinsic reads the tag off the PARSED document, never a regex over the
template text, and a guard over how a query's names resolve reads each statement through
PostgreSQL's own parser, `libpg-query`, never a pattern over the query text. A suite that needs
Postgres takes the worker's one PGlite from `freshDb`, emptied for each test, and only that helper
may build one — a lint zone, not a test reading source. Isolation is per schema: a test that adds,
grants or sets anything outside one fails the next call, and a built-in edited in place is shared.
The suite runs `vitest run`'s default worker count, one fewer than the cores, capped at four, and
watch mode takes the same.
**Why.** These documents carry figures, contracts and instructions no type checker reads, and a gate
whose verdict moves with whether an agent happens to be running is not a gate. `toJS()` discards an
unknown tag and keeps the scalar, so a `!GetAtt` and a literal spelt the same way are one value to a
parsed template. A pattern over SQL re-derives a grammar it never finishes: each construct it learns
to skip, a nested query or a quoted name, is one more it can misread. A PGlite keeps the memory it
booted with after `close()`, so a cluster per test grew every worker until a full run left the
machine none to spare; per-test isolation stops at the database or schema in the tools this follows,
and cluster-level state is shared there too. A worker's memory does not shrink as the cores grow,
so a count that scales with them spends memory a loaded machine may not have; the one fewer is kept
for the main thread, whose single Vite server serves every worker.
**Rejected.** Exempting a one-line docs branch: "too small to review" drifts to the size of whatever
the author is holding. · Asking the planner (`EXPLAIN` in PGlite) which sort keys are expressions:
`SELECT DISTINCT` and `count(DISTINCT …)` sort on expressions by design, so every query would need
an approved plan to compare against. · A cluster, or a `clone()`, per test: each keeps its memory. ·
Refusing a built-in edited in place by hashing every catalogue row: it would first need the columns
PostgreSQL rewrites on its own, to guard against what no suite does. · `'50%'` workers: it rounds
against every core, so a four-core runner would drop to two. · A budget over total memory: it cannot
see what the machine's other apps hold. · Sizing from free memory: the worker count, and so the
gate, would move with the machine's load. · `vmMemoryLimit`: it recycles only the vm pools' workers.

## Dependabot
**Decision.** Security only, and deliberately no `.github/dependabot.yml`, the file that turns the
dependency tree into routine version PRs. The ALERT is the unit, not the PR: draining the PR list is
not draining the advisories. `reference/DEPENDABOT.md` carries the two ecosystems, their fixes and
where overrides live.
**Why.** Every merge here costs a review, so version churn taxes the gate that protects the app and
buys no security. GitHub's squash preserves the PR author, so the button would land a bot-authored
commit on a branch that forbids the force-push it would take to undo.
**Rejected.** Routine version-update PRs: one person, one review per merge, no advisory closed.

## Deployment
**Decision.** Amplify Hosting as a manual-deploy app, fed by a GitHub Actions workflow that builds,
deploys and polls the job to completion, taking its environment from the ref. ONE WORKFLOW, TWO
ARTIFACTS: a SECOND Vite build appends the API reference page to the same `dist/` on every branch
but `main`, so it sits behind the dev site's basic auth and is absent from production. The GitHub
OIDC deploy roles deliberately cannot change the app: the SPA 200 rewrite and the cache headers stay
console-managed. ONE DEPLOY ROLE PER ENVIRONMENT, frontend and backend alike, each trusting that
environment's `sub` and its branch's `ref` and reaching only what that environment deploys, the
shared archive being `dev`'s. CloudFormation's execution role creates or changes no role without the
permissions boundary, which allows exactly the actions the stack roles are granted. Both
environments share that execution role, so a template deployed to `dev` can reach production
through the role's own grants and through the roles it creates; only an execution role, or an
account, per environment would close that.
ONE DERIVATION IDENTIFIER FOR BOTH BUILDS: the git tree hash of `HEAD:packages/core/src`, which
`scripts/derivation-id.ts` computes and the SPA build, the Lambda bundle step and the test config
each define as `__DERIVATION_ID__`. A change to the derivation code moves it with no change to
data. A commit touching only a test or a fixture there moves it too; a dependency bump does not,
the lockfile lying outside the tree.
NO STEP GATES THE BACKEND DEPLOY ON WHAT THE PUSH CHANGED: every run the path filter admits
deploys, once its checks pass, the stacks its branch owns.
Cloudflare sits in front: the apex, `www` and `dev` are proxied; the
certificate-validation CNAME and the mail records never are. A PUBLIC RUN CARRIES NO EMAIL ADDRESS:
the repository is public, so a run's log and artifacts are readable by anyone while they are kept.
`migrate.yml` masks the address its bootstrap is given in the job's first step, reading it from the
event payload because a step prints its `env:` block before its script runs, and the migration
runner neither returns nor logs one. A bootstrap must never run with debug logging, and a run that
did has its logs deleted: the runner's diagnostic log carries the job's inputs from before any step.
**Why.** A git-connected Amplify app has no build-status badge, and an Actions badge is real
deployment status when the workflow performs the deploy. Proxying keeps repeat traffic off origin
egress, the one cost line a flood can move — and a record left grey publishes the address its
proxied neighbour hides. The reference page is a build step rather than a flag because a flag is how
this pattern fails: a disable switch that turns out to be dead code and ships the page anyway. A
step that does not run cannot. OWASP's Logging Cheat Sheet counts an email address among the data
to remove, mask or hash before it is logged. GitHub's secure-use guidance masks a sensitive value
that is not a secret with `::add-mask::` and calls redaction not guaranteed; a mask rewrites log
lines and never an uploaded file, so it guards the log alone, and the report drops the address
outright. The Actions runner writes the whole job message to its diagnostic log before the first step
runs, and GitHub adds that log to the run's archive when anyone who can run the workflow re-runs it
with debug logging, or when `ACTIONS_RUNNER_DEBUG` is set to `true`. Any step of a job holding
`id-token: write` can mint its OIDC token, a dependency under test included. GitHub creates an
environment a workflow names but nobody made, with no protection rules. IAM reads a GitHub token's
`ref` and `environment` claims as condition keys, "to implement environment-based access
controls, such as separate permissions for development, staging, and production environments". AWS's
least-privilege guidance for CloudFormation: "An IAM principal with permissions to create a role and
attach any policy can escalate their own permissions". CDK's bootstrap example boundary likewise
refuses a role created without it. The identifier is that tree because every change under it,
or to the script that hashes it, runs both deploy workflows, which a test holds against both
path filters. The two sides still disagree while either deploys, and for as long as one fails
or is cancelled, so a reader of the identifier takes a mismatch as normal. And it is read from
the commit, never the working tree, so the Windows checkout's CRLF and the runner's LF name one
object. Rails includes the current action's template digest in its ETag by default for
the same need: "When our views change, they should … bust browser caches." A deploy gated on
the push's own diff is correct only against a watermark of the last commit deployed successfully:
Nx's `nx-set-shas`, which computes that base, states the case — a few failed deployments in a row
accumulate changes that are not getting deployed, so a retry must include "every commit since the
last time we deployed successfully" — and reads that commit from the last successful run. A gate
would have to keep that watermark, and a skipped deploy is worse than a wasted one.
**Rejected.** A proxied validation record: the answer becomes the edge's own address and the
certificate stops renewing. · An environment secret for the bootstrap's address: masked from the
job's start, but an operator's input would become standing configuration in each environment. ·
One deploy role trusting `environment:*`: it trusts any environment a workflow names. · One role
for both environments with the workflow choosing the target: a `dev` job holds production's stack and
its runner, whose `bootstrap` mode mints a super-admin. · A deploy id as the derivation
identifier: the two builds' always differ. · A commit SHA: the two builds' differ whenever one
side last deployed without the other. · A hash of each bundle: a Vite output and an esbuild
output never agree. · A `changed` step gating the backend deploy on the push's diff: correct only
against a watermark of the last successful deploy.

## Design pipeline
**Decision.** The reference is `design/Investment Tracker.dc.html`, whose styles are inline in the
markup — read it for any exact size or spacing, and ignore `support.js` and `_ds/`, which are
prototype runtime. COLOUR IS THE ONE THING IT NO LONGER OWNS:
`design/extensions/parchment-5h.dc.html` is the colour reference for BOTH themes and supersedes
every colour in every merged drawing, geometry and copy in none of them. A merged drawing is
immutable; a new surface gets its own file under `design/extensions/`. The pipeline is brief → a
design session that turns it into an extension → the UI task, which may not start before its
extension merges; a merged drawing wins a layout dispute, the brief wins copy and behaviour, and
colours come only from theme tokens. 3 : 1 (WCAG 1.4.11) binds any boundary that identifies a
component or its state, in both themes, and anything under it carries its reason where the value is
declared.
**Why.** The drawing owns the RESULT and the code owns the mechanism: a static sheet has no
intermediate widths, no viewport height and no second language, so where it is silent the code
decides — and says where it decided.
**Rejected.** Editing a merged drawing to match a later ruling: it destroys the only record of what
changed.

## Measurement
**Decision.** Geometry and colour are read through the chrome-devtools MCP, never Playwright's
headless Chromium, where lengths are honest and border and outline THICKNESSES are not. Drop a
calibration probe before recording any figure, disable transitions before reading anything
animatable, check `document.visibilityState` before believing a motion reading, and RELOAD rather
than flip `data-theme`. Read the rendered box, never the class list. The dev server's port is pinned
with `strictPort`, but that only says where THIS checkout binds, so confirm the `Quirenote` title
before trusting whatever answers there.
**Why.** A wrong instrument puts wrong figures through review with full confidence, and the reviewer
has nothing to check them against but the arithmetic of the classes. A background tab freezes
transitions and never fires `animationend`, which reads as "the animation is broken".
**Rejected.** Sampling a property mid-transition: a focus ring answers differently depending on when
the sample lands.

## Interaction rules
**Decision.** Every interaction animates, soft and fluid; every pressable takes a small active
scale, and `prefers-reduced-motion: reduce` is a global kill-switch. A click target never moves
under a hovering pointer. Reminders derive their ids and write nothing, so a dismissal expires when
its occurrence stops being produced. The theme is ONE list of values redefined per theme, and BOTH
controls that write it write that one field, so neither has a value of its own to fall out of step.
The sidebar's ACTIVE ROUTE is a tint plus a 2px inset left indicator, never a fill, so a state is
never colour alone. COLOUR IS RATIONED 60 / 30 / 10: the canvas and its surfaces are the sixty, text
and borders and the chart series the thirty, the accent the ten, so a second action beside a filled
one takes an outline or a ghost. Gain and loss belong to DELTAS: an informational chip reads `info`,
a text selection reads `selection`, and neither borrows `pos`.
**Why.** A dismissal on `animationend` never lands in a throttled tab, so it commits on a timer.
WCAG 1.4.1 does not accept a state said in colour alone, so the indicator is the half that survives
a colour-blind reading. A green highlight on a reminder or a run of selected text says "up" about
something that has no direction.
**Rejected.** A motion library: the theme tokens and the utilities already in the tree carry it.

## Forms and layout
**Decision.** `/` and `/transactions` are composed the way `/payouts` is — a `1.6fr 1fr` grid, one
column when it collapses, `/transactions` mirrored so the ledger leads. Inside a grid track the
track is the bound, so a card carries no width cap; the form's cap survives only in the stacked
column. The asset form derives more than it asks, and a deposit is a portfolio-level row that names
no asset. A transaction names no source of funds and nothing replaced it — the type and the asset
carry that fact in every row. The ОВДП code takes four letters or digits, suggested from the ref or
the name until the user types. Naming a bond from the provider list fills its maturity, next coupon,
cadence and rate: facts about the instrument, so overwriting them is right where overwriting a typed
code is not. A payout also asks what was WITHHELD from it, READ BACK on the two surfaces that owe
it: a line on the ledger row, and a withheld and a net-of-tax column on the payout log. Both draw
NOTHING where a payout carries none — no dash, no zero, no empty line, the net cell included, a
row's net being its amount already. Every type asks for a NOTE, absent rather than empty and refused
by a sentence rather than capped by the control.
**Why.** A figure that is written, stored and derived from but shown nowhere cannot be checked: a
wrong withholding understates the tax, overstates the net and lifts that asset's XIRR in silence.
The note's cap is a DRAWN number rather than a stored one, counted in characters and not lines
because `transaction_note_ck` must enforce the same bound and SQL cannot check a line count.
**Rejected.** A `textarea` for the note: a hundred characters is a line, not a paragraph, and A
CONTROL AT ANY HEIGHT BUT 36 IS INVISIBLE TO THE STRUCTURAL WALK that holds every field edge.

## Where the old numbers went

Code comments still cite `D<n>`. This table says which topic above now holds each number; a number in the last row has no "why" left outside code and tests. New code cites a topic heading, never a number.

| Topic | Numbers |
|---|---|
| Core is pure | D8 |
| Persistence today | D2 D9 D11 D12 D16 D24 D29 D113 D122 D125 D126 D127 D128 D129 |
| Derived figures and the seed | D5 D33 D34 D75 D133 |
| Metric families and windows | D13 D35 D18 D21 D23 D78 D79 D80 D81 D85 D112 D119 D120 D121 |
| Language, numbers, fonts | D54 D55 D58 D87 |
| Shape system | D56 |
| Scrolling | D65 |
| Two shells, one breakpoint | D66 |
| Brand | D40 D42 D131 |
| The price archive | D19 D20 D26 D27 D28 D70 D30 D69 D31 D43 D50 D51 D52 D64 D71 D74 D111 D132 |
| External sources | D72 D83 D82 D86 |
| Alerting | D44 D45 D47 |
| Cloud target | D37 D46 D48 D91 D97 D49 D63 D89 D90 D92 D135 D136 |
| Auth model | D32 D36 D38 D39 D62 |
| User schema and deletes | D99 D100 D101 D137 D138 |
| Git model | D6 D59 D67 D60 D73 D107 |
| Work tracking and documentation | D3 D95 D96 D98 D102 D103 D105 D106 D108 D130 |
| Review, gates, tests | D4 D10 D53 D76 D84 D109 |
| Dependabot | D104 D110 |
| Deployment | D15 D61 |
| Design pipeline | D14 D77 |
| Measurement | D115 |
| Interaction rules | D7 D17 D22 D25 D57 D114 D68 |
| Forms and layout | D88 D93 D94 D116 D118 D123 D117 D124 D134 |
| Retired | D1 D41 |
