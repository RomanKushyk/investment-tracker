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
runs them all, the windowed ones once per period option and the rest once, and its type is the
`view` member of `/view`'s payload, which `viewBody` completes with the rows the editors read. The
clock is an input: nothing in the package reads it for a figure. New code calls
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
in the commit that adds it. A STORED VALUE IS SCOPED BY WHAT IT NAMES, and there are three kinds.
One the platform answers each time it is asked — reduced motion, the colour the OS resolves, the
viewport's side of the breakpoint — is DERIVED and stored nowhere. One naming a thing only this
device holds, or offering to defer to what this device's platform answers, is PER-DEVICE and stays
with that device: a provider payload's cache under a `meta` key; the store's `dataset`, which binds
a database until it retires; and THE THEME, whose `system` defers to the OS's colour scheme. The
rest but `usdRate` are a person's choices, and AT THE MIGRATION THEY FOLLOW THE ACCOUNT: the default
currency, the language, the period, both suggestion switches, the reminder switch and its lead, the
dismissed reminders with the skipped coupons among them, the collapsed nav groups and the rail. At
the migration two fields retire: `dataset`, with nothing left to select once the demo is an identity
of its own (*User schema and deletes*), and `usdRate`, the rate being the server's row (*External
sources*). `currency` is the tab's and persists nowhere. THE THEME IS THE PREFERENCE
`system | light | dark`, `system` by default, and the resolved colour is never stored. From the
migration THE DEVICE'S STORE HOLDS ITS OWN THEME AND A COPY of the account's settings, which the
account's answer overwrites on every load, because a paint comes before that answer: the shell's
first render reads the rail, and a signed-out page has no account at all, so there the copy is what
applies and the signed-out bar's language control writes it. THE ACCOUNT'S SETTINGS ARE ONE NULLABLE
TEXT COLUMN ON `app_user`, its fields as JSON and NULL reading as their defaults; A WRITE MERGES THE
FIELDS IT NAMES onto those stored and leaves the rest as they are, `PATCH /settings` being that
write and `/view` the read (*Cloud target*); and the sanitiser of those fields, `migrateSettings`'
rule for each, is core's (`settings.ts`), so both sides run it: the server on a write and on the
read `/view` serves, and the app's `migrateSettings` for the account's ten. The backup's `settings` member carries no per-device field: today a restore the person opts into
sets the device's default currency and rate, and from the migration it sets the account's default
currency.
The JSON backup envelope refuses a newer, an older and an unreadable
version, A `__proto__` KEY in any object the schemas read — the envelope, settings, a row, its
`inzhur` — and AN ASSET ID THAT IS ANY OWN PROPERTY NAME OF `Object.prototype`
(`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty` and the rest), both by place
and before the row schemas. THE FILE CARRIES PER-UNIT PRICES, NOT THE STORE'S ₴ SNAPSHOTS, as the
rows `GET /state` answers (*Cloud target*): the export divides each quote by the units held that
day, dropping one no price reproduces — of a position held none of, of an asset no row has moved,
or valued at nothing — and a day left with none, and the import rebuilds each day's snapshot from
the prices, each quote in kopecks as `/view` rounds it and `savedAt` the day's latest witness time. It refuses a price naming no asset, a second price for one asset and day, and one not above
zero;
import validates fully, shows a diff, then replaces the dataset — in one transaction on the device,
and on the server in staged parts one pointer move commits (*Cloud target*) — a key the file omits
is REMOVED — after a safety backup that cannot be cancelled. CSV is export-only, and A TEXT CELL
NEVER
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
downstream waits for a field this build has never heard of. One file for both stores lets a backup
taken here restore into the server, and the quote the conversion drops is one the server cannot
store either. zod drops a `__proto__` key before any
schema sees it, and an assignment to that key on a plain quote map stores nothing, so a file
carrying it would lose a key or an asset's prices in silence — against the rule that nothing partial passes; `secure-json-parse` and `bourne` refuse the
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
and re-open. A setting that names a local database is wrong on the next device however it feels, and
feeling UI-ish is no rule: VS Code's sync takes every user setting except those of `machine` or
`machine-overridable` scope and those a user excludes, and syncs the display language, view layout
and visibility and the "do not show again" choices. The theme stays with the device because the
colour scheme it can defer to or override is the device's own, and a phone and a desk can want
different ones: Slack keeps its dark mode per device, and Discourse's selector writes a cookie that
overrides the account's preference. Under `prefers-color-scheme`, `light` also means no preference
expressed, so a stored resolved colour cannot say "follow the system", and an OS that switches by
the hour would stay at whichever colour was resolved last. The language offers no `system`, an OS
guess rewriting every figure's grammar (*Language, numbers, fonts*), so the app never defers it to
the device and by the rule it is the person's; W3C's i18n guidance is not to decide a locale from
`Accept-Language` alone and to store the choice for later visits. A Skip passes a coupon occurrence
in the walk (*Coupon cadence*), so a browser cannot own it. The copy covers every account setting,
not only what a signed-out page shows, because the first render reads the store synchronously, and a
rail read from the network would open as the panel and then close. A write of the whole object, from
a device that loaded before another's change or from an older build that does not know a newer
field, would put back what it holds; a JSON merge patch (RFC 7396) changes the members it names and
leaves the rest untouched. The gate reads `app_user` on every authorized request, so the settings
are one more column on a row already read. A column added later on DSQL arrives plain and nullable,
and a default or a `NOT VALID` CHECK follows as a statement of its own, never a NOT NULL
(`infra/docs/dsql-constraints.md`), so a typed column per setting makes every new setting a
migration where a text column makes it none — persist doctrine's third rule, kept on the server.
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
now on. · Storing the resolved colour: it cannot represent "follow the system". · A `system`
language: an OS guess would rewrite every figure on screen (*Language, numbers, fonts*). · The theme
on the account, as Mastodon and Grafana keep the colour scheme, GitLab its colour mode on the user's
row and VS Code its colour theme among the user settings it syncs: it can defer to an answer each
device's platform gives for itself, the owner ruled it the device's, and with `system` the default a
person who never picks one sees each device's own. · A copy of the language alone: the rail and the
nav groups also paint before the account answers. · Filling an empty account from the device's copy:
the copy outlives a sign-out, so a new account on that device would inherit the last one's choices
and, in its skipped coupons, that account's asset ids. · A settings table of typed columns, GitLab's
and Discourse's shape: each new setting becomes a migration, its default and its CHECK each a
further statement and the CHECK only `NOT VALID`, to hold what the sanitiser already holds on every
read. · `jsonb` for the column: supported with no index, nothing queries inside the settings, and a
column's type is an alteration DSQL cannot make later — the reason `bond_terms` holds its schedule
as text. · A stored reduced-motion switch, as Mastodon keeps one: the OS already holds the answer,
and this app obeys it everywhere (*Interaction rules*).

## Derived figures and the seed
**Decision.** Every portfolio figure is derived from stored data and none is hard-coded; value at a
date is `units(a, D) × price(a, D)`, the price being the latest observation at or before D from
either source, the user's or the archive's, the newer winning and the user's on a same-day tie, so
nothing is prefilled because nothing is written. The app still stores and reads ₴ snapshots
(*Persistence today*). Core can rebuild that series from the ledger and both sources' per-unit
prices instead, and `GET /view` serves the rebuild, which the app does not call yet: one snapshot per grid day from the first that values anything —
every day a held asset is observed on, every transaction day, and the day before each period opens,
resolved by the window composer — each asset at that day's units × price, rounded once to the
kopeck as the figure is made, and no save time. The latest grid day closes every window, so a
transaction dated after the last observation closes them at carried prices, a full exit at none;
no grid day falls after the caller's day, so a transaction or a price dated later adds none, and
`buildView` reads the ledger to that day (`ledgerAsOf`), and the app's screens that call a
composer, the capital card and `/`'s yield card read it to theirs through `useLedgerAsOfToday` (*Metric families and windows*), so a
transaction or a quote snapshot dated after it counts in none of their figures until its day, the
next payouts' projection included, so a sale entered ahead of a coupon's date leaves that coupon
projected until the sale's day; an asset whose only buy is dated ahead composes as one with no
transaction yet; the readers that keep every row are named under *Metric families and windows*. A
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
it. The ledger is cut before the composers run, at `buildView`'s entry and in the app's
`useLedgerAsOfToday`, so every composer keeps its signature and the
golden master, which runs the composers directly, pins what each did; a row ahead is absent rather
than counted as of its date because it is entered ahead on purpose — a coupon known to be coming, a
planned deposit — and Ghostfolio tags such an activity a draft and leaves drafts out of every
portfolio read, hledger-ui hides future-dated transactions by default, and Portfolio Performance counts
only the transactions inside the reporting period. A ₴ figure is kopeck-grained, as Portfolio Performance rounds a position's value
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
of 0 shares · Refusing a date ahead at entry, or a hint in the forms: rows are entered ahead on
purpose · A cut inside each composer: every composer would make it, and one that did not would be
#358's disagreement again, where a cut made before the composers run is one no composer can miss.

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
its own day, and a Balances cell shows a stored quote the rule leaves out, marked, the mark meaning only
that, while on the series rebuilt from per-unit prices a position held none of has no quote and its
cell reads «—», unmarked; a day asks for an asset's quote only while the ledger holds units of it, or, where it cannot
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
`/yield`'s table counts units to the ledger's last row, where their flows end too, and the ledger
`buildView` hands them ends on the caller's day (*Derived figures and the seed*), though its
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
The app's screens that call a composer, the capital card and `/`'s yield card take the ledger from
one hook, `useLedgerAsOfToday`,
which cuts it at `useToday()`, one clock every reader shares, as `buildView` cuts it at the caller's
day, so Balances lists the
snapshots and the Payouts log the payouts dated on or before today; the reminders, the coupon due
cards, both forms, the ledger on `/transactions`, the delete counts, the export and the import
preview read every row.
**Why.** The day before is the only boundary at which each transaction counts exactly once, and it
makes the full history collapse onto its unwindowed twin. Capital gain is realized plus unrealized,
and the unrealized half is measured only on what is still held; `quotesAsOf` merges snapshots, so a
last quote outlives its sale and would count it twice. A snapshot dated after the sale can still
quote the position, the same double count one day at a time; the cell shows it because a listed
day's cells hide nothing stored, and the mark says the total left it out. A per-unit price stored on
a day a later sale emptied values the units held, none, so the rebuilt series has no quote there to
show; its price stays in the store, since a `snapshot.patch` on that day leaves every price it does
not name, until a patch names it `null` or a `snapshot.delete` or `.move` on that day, and
*Cloud target* says how `GET /state` carries it. A snapshot stores a value, not a price
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
sold-out holding would value a different one bought back after a day that held none. · A cut in
each screen: every screen would make it, and one that did not would disagree with the rest about
the same figure; `src/one-composer.test.ts` holds each of those readers to the hook.

## Coupon cadence
**Decision.** Where a linked bond's published payment dates are passed, a roll lands on the first of
them past the payout dedupe window of the date it steps off. When the date stepped off is not within
the window of a published one, the first stands only up to half a period past the period's step, or
the roll steps instead; a schedule with no period has no step to bound it. Where the dates are
passed, the walk starts on the published date the stored coupon date stands for: the nearest within
half a period, the earlier at an equal distance, and the maturity in place of one past it. With none
that near, or a schedule with no period, the stored date stands and the roll bridges from it. A
semiannual roll handed the dates steps off the published date the date it is handed stands for, by
the same rule, and reports the bond matured where that is the maturity. So for a semiannual bond the
confirm on `/`, which rolls off the date its card offered, does not move `nextCoupon` onto the
published date a hand edit's payout records, and the payout keeps the offered date. A monthly or
quarterly roll steps off the date as handed, so a hand edit more than the dedupe window off a
published date still rolls onto it: the bridge measures half a period off the date before, and month
lengths differ, so that half can be shorter than the half the start reaches from the date after, and
a mapped step could pass a date the walk bridged short of. The maturity a walk falls back to with no
coupon date stored is not mapped. A payout recorded within the
dedupe window of the stored date settles the occurrence the stored date stands for, unless another
published date within the window of the payout, owed and with no other payout beside it, claims the
payout. The walk matches a skipped date as it matches a payout's, by the same dedupe window, until a
payout names its coupon; a Skip never counts as the other payout that pays a claimant. A Skip passes
every occurrence within the window of the skipped date; the reminders and `/`'s coupon card read the
walk that way, with the dismissals and no dates. Where the walk is handed both the dismissals and
the dates, which no reader is yet, a Skip within the window of the stored date settles the
occurrence the stored date stands for, unless another published date would claim a payout on the
skipped date.
Nothing writes the start back: it is derived at every read. `/view`'s build passes
the archive's dates to the walk behind the next payouts on Overview and Payouts, `/attributes`' next
coupon, and Seasonality's expected coupons and coupon-season card; the confirm's roll on `/` and the
gap a suggested quote subtracts pass the feed's. The reminders, the occurrence `/`'s coupon card
asks about and the composers as the screens call them pass none until the app reads `/view`. Where
no published date is taken, a semiannual fixed coupon steps `OVDP_COUPON_PERIOD_DAYS` from the
stored date: in the walk, the gap a suggested quote subtracts, save the fold onto the maturity
below, and the confirm's roll on `/`. For a
semiannual coupon with the dates passed, the gap counts forward from the start through the same roll,
the step that bridges to the first date served included, and a date inside the dedupe window of the
last date it took is that payment. Behind the start it steps back as the roll steps forward: onto the
latest published date before the dedupe window of the date it steps from, which off the published
dates stands only up to half a period before the step back, else the step back. Before the first
date served the step back is the period, as without the dates, so a coupon paid where an issue's
period departs from the step, or one a roll bridged to, is placed off its day; the ledger read below
for a start on the maturity is the one exception. From a stored date no calendar has, a start
clamped onto a maturity no calendar has, or a schedule other than semiannual, the gap counts the
published dates as given. A step past the maturity, or one falling short of it by no more than twice
the payout dedupe window, lands on the maturity, so the final period absorbs a short stub. Without
the dates, a semiannual stored date inside the dedupe window before the maturity and the maturity are one
coupon: the gap starts on the maturity, as once the confirm rolls onto it, so it counts the coupon
there, sized on its record date, and the coupon before as for a start on the maturity. The walk, the
reminders and `/`'s coupon card still offer the stored date, and the confirm records it and rolls
from it onto the maturity. A Skip of it, as a payout on it, settles the maturity's coupon too, so the
reminders and `/`'s coupon card then offer no coupon.
The schedule's months name each occurrence by the month of its place in the first year's cycle,
and the final coupon, paid with the principal, by its own. Without the dates the gap counts back
from its start in the same steps. Where the start is the maturity, folded or clamped onto, and
no published date answers the first step back, the coupon before it is the latest one recorded in the
ledger, where one is, dated by its first entry. A monthly or
quarterly coupon keeps the month grid, whose roll clamps to a shorter month's last day and onto the
maturity. Without the dates, from a stored date not past the maturity, the grid's gap stops at the
maturity. On a maturity the calendar has, it counts the final coupon there, and takes a grid date
inside the dedupe window before the maturity and the maturity as one coupon, counted on the maturity
and sized on its record date. On and past a maturity no calendar has it counts nothing, as the walk
owes nothing there. The gap's grid keeps the stored date's day of the month, clamped only in a
shorter month, while the roll steps on from the day it clamped to. After such a clamp the walk can
offer an earlier day outside the window where the grid date is inside it, and name two payments
where the gap counts one. Otherwise the walk, the reminders and `/`'s coupon card offer that grid
date, and the confirm records it and rolls from it onto the maturity. From a stored date on the
maturity, the grid behind it is dated by a payout the ledger records within a period before the
maturity, each payout dated by its first entry. That is the latest before the maturity's dedupe
window. Where none is there, or it lies no more than the window after a period before the latest
inside the window, it is the latest inside the window. The grid steps back whole periods from it, and
where it sits inside the window it is the final coupon, counted on the maturity. With none recorded,
the grid steps back from the maturity. A stored date past the
maturity is not folded onto it: the grid counts it once and nothing after it, as the semiannual gap
does, while the grid behind it counts as before, a grid date between the maturity and it included.
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
and principal never offered. Without the dates, no semiannual step lands inside the window before
the maturity, so only a stored date can sit there, and the walk takes a payout on it for the
maturity's too and names one payment. Starting the gap on the maturity counts it before the confirm
as after it. A grid date can land inside that window, and a payout on it settles the maturity too,
so the grid's gap counts the two as one payment, as the walk does where it offers the same date. From
a date on or past the maturity the roll reports the bond matured, so the walk offers a stored date
past it alone and nothing after it, as nothing steps on from a date past a schedule's end: QuantLib's
`Schedule` refuses a first date past the termination date
([schedule.cpp](https://github.com/lballabio/QuantLib/blob/966a4cc101049ca36a888b2ce223aa96d3f3b22d/ql/time/schedule.cpp#L124-L130)).
Behind such a date the gap still counts the grid, a date past the maturity included, as the
semiannual step back does. An
OVDP pays its final coupon with the principal on the maturity date: every bond in the feed captures
makes its last payment on its maturity, which the feed-fixture test in
`accrual.test.ts` measures. The price drops on the day the coupon is paid, so the gap places the one
coupon there. Seasonality adds a whole coupon for each month the schedule names, and
fixed-day steps cross month ends over the years, so naming each occurrence's own month would count
a semiannual coupon three or four times a year. Behind a stored date on the grid, the grid's date is
the coupon's, whatever day a payout was entered on. A fold or a clamp leaves no step back from the
maturity, and the confirm records each payout on its occurrence's date before it rolls. On a month
grid the roll onto the maturity also loses the day the grid pays on, and the schedule standards keep
the date a final stub starts from as a datum of its own: QuantLib's
backward schedule steps whole tenors back from a given next-to-last date, and from the termination
date without one
([schedule.cpp](https://github.com/lballabio/QuantLib/blob/966a4cc101049ca36a888b2ce223aa96d3f3b22d/ql/time/schedule.cpp#L195-L205));
Strata's `lastRegularEndDate` is the start of the final stub, the end date in its absence
([PeriodicSchedule.java](https://github.com/OpenGamma/Strata/blob/main/modules/basics/src/main/java/com/opengamma/strata/basics/schedule/PeriodicSchedule.java));
FpML's `lastRegularPeriodEndDate` is given only where a final stub exists
([CalculationPeriodDates](https://www.fpml.org/spec/fpml-5-6-1-wd-1/html/confirmation/schemaDocumentation/schemas/fpml-ird-5-6_xsd/complexTypes/CalculationPeriodDates/lastRegularPeriodEndDate.html)).
The app stores none, and the ledger holds it: the payout the confirm recorded on the grid date. The
confirm rolls onto the maturity from a grid date a period or less before it, so the read reaches no
further back. A payout inside the maturity's window settles the maturity itself, so the semiannual
read leaves it out. A month grid's last date can sit inside that window, and then the payouts within
the period cannot always tell its payout from a final coupon entered early: a late hand entry of the
coupon before it, which the walk takes for that coupon within the dedupe window, can write the same
dates. Read that way, the payout inside the window is the last grid date's, the owner's choice over
the early final coupon. A later entry, which the walk does not take for its coupon, can write the
same dates too, and is read as the early final coupon. The fixed
step still misses where an issue's period departs from it, as one listed bond's does
(`reference/OVDP-COUPON-STRUCTURE.md`), and the record date moves with it, so a trade dated between
the two record dates is judged on the wrong one. With the dates, a semiannual gap counts forward of
the start the dates the walk given them steps through, one per dedupe window, as a payout settles
every occurrence within the window of it; behind the start, down to the first date served, its steps
mirror the roll's. The feed captures still list each payment made in the days before them, so a gap
ending beside a recent payment finds it published. A schedule
other than semiannual keeps the published dates as given: the bonds the feed serves are spaced by
the semiannual period, which the feed-fixture test measures. A published date inside the
dedupe window of the date stepped off is that same occurrence, as `couponRecorded` takes a payout inside it for it, so a
roll off a date beside a published one, short of the last, passes that occurrence. The provider
drops a bond's older payments, so the dates served can start a period or more after the stored date,
or after the paid date a confirm on `/` rolls off. A next date more than half a period past the step
leaves at least one payment out between, so the step bridges to it; a nearer one is the step's own
occurrence. From a date still listed none between can have been dropped, so nothing bounds the roll.
QuantLib's `Schedule` takes any list of dates beside its rule-based form, as the roll takes the
published dates beside its step
([schedule.hpp](https://github.com/lballabio/QuantLib/blob/master/ql/time/schedule.hpp)).
The stored date is an estimate of a payment, not a reference instant: the form fills it from the
feed, a confirm made without the feed steps the period and lands beside a published date where the
issue's period departs from the step, and a hand edit can land further. A changed date is the same
payment — every message about one interest event carries the same event reference (SMPG Corporate
Actions Global Market Practice Part 1, §3.6.2,
[docx](https://www.smpg.info/sites/smpg/files/files/2026-03/1_SMPG_CA_GMP_Part_1_SR2026_ISO20022_v1.0_0.docx))
— and the information the issuer CSD provides is the golden source, which investor CSDs and
custodians must not change (ECB AMI-SeCo SCoRE Corporate Actions rulebook, Standard 3,
[pdf](https://www.ecb.europa.eu/press/intro/publications/pdf/ecb.amiseco202512_scorecarulebook.en.pdf)).
The stored date's period overlaps most the published period ending nearest it, and by at least half
only within half a period, so that is the date it names. Half a period is measured as the bridge
measures it, on the step from the stored date, which a month-end clamp shortens. A tie has to be
named — pandas' `merge_asof` breaks one to the earlier key and polars' `join_asof` to the later
([join.pyx](https://github.com/pandas-dev/pandas/blob/v3.0.6/pandas/_libs/join.pyx),
[asof/mod.rs](https://github.com/pola-rs/polars/blob/py-2.0.0/crates/polars-ops/src/frame/join/asof/mod.rs))
— and the earlier date shows a payment rather than hiding one, as an unpaid income event stays
pending. The stored date's alias gives a payout to one payment, as Actual Budget's import matcher
claims each candidate once
([sync.ts](https://unpkg.com/@actual-app/core@26.10.0/src/server/accounts/sync.ts)): a payout
beside the stored date goes to the start unless another owed and unpaid published date beside it
claims it. The walk's own match of a payout to an occurrence is still the dedupe window alone, so a
payout beside the start and another published date settles both. The
cost is accepted: a hand edit up to half a period past an unrecorded published date reopens that
date in the walk, and a payout recorded beside it, or beside the stored date and claimed by no other
date, settles it. A published date past the maturity yields the maturity, as the roll's own clamp
does.
**Rejected.** Storing a linked bond's dates on the asset: a copy that would not follow the archive's
later terms. · Counting the units within a tolerance window around a stepped date instead of taking
the published one: the record date would still be a guess. · The stored date as a fixed anchor for
the grid: it overloads the "Next coupon" field, and an edit silently rewrites the rule. · A month
grid keeping the first date's day: it changes none of the misses. · A stored roll convention for the
month-based schedules now: it reaches the asset row, the backup format, the CSV and the cluster's
schema, so it waits for the cutover. · A schedule's months bounded to its first year: a month the
position pays in again after a sale and a buy-back drops out. · Reading every coupon behind the
stored date off the ledger: a payout entered days late moves the coupon onto its own date, and an
earlier stray entry stands in for it. · Starting on the first published date on or after the stored
one: that is how a schedule finds the next coupon after a settlement date, a reference instant
(QuantLib's `Schedule::nextDate` is a lower bound), and it skips the date a confirm's step landed a
day past. · The payout dedupe window alone as the start's reach: a posting-lag tolerance for matching
cash to an event, and outside it a changed date becomes a second payment. · A stored identity, the
published date the pointer stands for, kept through hand edits (RFC 5545's `RECURRENCE-ID`, MT564's
`CORP`): a field on the asset row, the backup format, the CSV and the cluster's schema, which waits
for the cutover, and a confirm made without the feed would still need the nearest date as its
fallback. · Giving a payout beside the stored date to the published date nearest the payout, or to
none when another is beside it: a late payout for the start goes to a date already paid or not owed.
· Counting behind the start the published dates, then stepping back only from the earliest of them:
a start past the last date served loses the steps the roll took to reach it. · The confirm recording
the payout on the published date instead of the offered one: the card shows the offered date and says
history is never rewritten, so the row would carry a date the user did not confirm. · `/` offering
the published date: its walk passing the dates waits for the app reading `/view`, as above. · Without
the dates, counting the one coupon on the stored date inside the window before the maturity: it is
the date the walk offers and the confirm records, and the merge with the dates keeps its first date,
but it sits up to the window before the day the price drops.

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
`infra/src/official-rate.ts` also holds the read `GET /view` makes:
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
sits outside that rule, its depth published by SQS rather than by any check here. A REQUEST PATH IS
NO CHECK: no traffic is its normal state and a failure it catches is answered as a 500, so it adds
the watched value alone — the view function's archive refusals, alarmed on a second in an hour, since
the grant's revoke and re-grant refuses a connection landing between the two.
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
function by a pattern on `aws:PrincipalArn`, the one role that assumes it. The
archive's identifier reaches a user stack as a deploy parameter the workflow reads off the archive's
outputs. The mapping is granted by a custom resource in the archive stack, admin's second holder
there beside the capture, which revokes every mapping and grants the current one on its creation and
whenever one of its properties changes: the role's ARN, the cluster, the hash of its own code or
its timeout.
THE DERIVED READ IS `GET /view`: `buildView` for all six periods over the series rebuilt from the
caller's prices and the archive's, the official rate and its day beside it, and the rows the editors
read, which a figure is cut from and a form is not: every asset and every transaction, uncut and in
the order the composers read them, a row dated after the caller's day included; the quotes the user
RECORDED on the caller's day, each asset's latest recorded one before it with the day it was
recorded, and the latest witness time of any price the user recorded; each asset's delete
counts; and the account's settings, the ten fields with NULL read as their defaults, from the row
the gate has read. A quote is recorded when a `user_price` row of the user gives it, priced as a stored day is,
so a carried grid day and an archive price are none and a price on a day its position holds none
gives none. The delete counts are what `asset.delete` removes: the asset's transactions and every
price row of it, a day its position held none included. One core function composes the quotes for
any day, and only the caller's day rides `/view`, every recorded day growing with the history:
another day is a read of its own. The
rules from core's types to the body live in core (`view/serve.ts`), so the derivation identifier
covers them; the
mapping of rows into those types stays in `infra/`, outside it: `infra/src/ledger.ts` reads the
rows of the caller's live dataset and `app_user.data_version` in one read-only transaction, and
`infra/src/sell-observations.ts` reads the archive's sell rows and, for each linked ref, the
payment dates of its latest `bond_terms` row, each date once, and digests each. Core hands the
dates to the build under the assets linked to that ref as a bond. The
archive is read for the linked refs from a week before the first transaction on or before the
caller's day, so the first held day finds the observation before it. TWO VALIDATORS, NEVER ONE:
the read's tag is WEAK and composed from seven inputs — the caller, `data_version`, a digest of the
sell rows read, a digest of the payment dates served, the rate served with its day, the Kyiv day and
the derivation identifier — and `/view`'s adds the caller's settings as served, the one body that
carries them, while a write's precondition is `data_version` alone. `If-None-Match` compares weakly and `*` matches;
`If-Match` on the read compares strongly, so the read's own tag answers 412. The answer is
`private, no-cache`, and its 304 carries the tag and that policy and nothing else. STALENESS IS A
HEADER: the 200 names its derivation in `derivation-id`, which CORS exposes beside `etag`. The body
ships uncompressed until a first-paint measurement says otherwise.
THE TWO WIDE FIGURES ARE READS OF THEIR OWN: one value per asset per date is too wide to send for six
periods or for every row, so `GET /view/series?period` answers the yield curve of one period and
`GET /view/balances?page` one page of the Balances table, each through `/view`'s gate and read, its
tag the read's seven inputs and its route and parameter, and each cut at the caller's day as
`buildView` cuts. Once the gate admits the caller and before the ledger is read, a `period` off
core's list, or none, is refused by name with a 400 `invalid_query`, never read as another; no
`page` is the first, and a
page is digits with no sign or leading zero. Pages count from 0, newest first in a TOTAL order — the
date, then the quotes the row shows — by one size core names for the server and the screen alike. A
page past the last is empty, every page names the `next` one or null, and the page names its assets
in the order of its cells.
A PAST DAY IS A READ OF ITS OWN: `GET /view/day?date` answers the facts `/view` carries for the
caller's day, for the day it names, composed by the same core function and cut at no day, as a form
reads every row. A day with nothing recorded, before the first row, after the last or between two,
answers with no quote and the last recorded before it, if any. It goes through `/view`'s gate and
read with `/view`'s cache policy, 304 and `derivation-id`, its tag the read's seven inputs and its
route and date, so it reads the archive and the rate its body does not use. Once the gate admits the
caller and before the ledger is read, a `date` that is no calendar date in yyyy-MM-dd, by the door a
snapshot's day is written through, or none, is refused by name with a 400 `invalid_query`.
THE WRITE IS `POST /mutations` AND THE EXPORT `GET /state`, one function behind the same gate. A
write is a list of ops — `asset.add`, `.patch`, `.delete`, `.prune`, `transaction.add`, `.patch`,
`.delete`, `snapshot.patch`, `.delete`, `.move` and `dataset.clear`, and no `account.*` — applied in
order in ONE TRANSACTION, each op seeing those before it and two allowed on one entity; it lands
whole or not at all, and a refusal names the index of the op that failed. AN UPDATE IS A PATCH, NEVER
A REPLACEMENT: an asset's or a transaction's is a JSON merge patch of its row, `null` removing a
member, and the merged row is validated whole by core's row schemas; a day's merges its quotes the
same way, `null` removing an asset's price that day, and its `savedAt` is the witness time of the
prices it writes. A body
past its byte bound is 413 and more ops than its op bound 400; more mutated rows than its row bound,
which sits under DSQL's per-transaction ceiling, is 409 `too_many_rows` with the count, as is the
cluster's own `54000`; each refusal names its bound. The write's precondition is the STRONG tag
`"<data_version>"`: no `If-Match`, or `*`, is 428, a stale one 412, and the 200 carries the new tag in
its `etag` header and in its body. `/view`'s body carries the current one as `etag`, beside its own
weak validator. `GET /state` answers the live dataset under that tag, `private, no-store`. A
SNAPSHOT IS STORED AS PER-UNIT PRICES: `snapshot.patch` sets the price of each asset it quotes,
dividing the quote by the units held that day and dropping, naming it, one whose units or value is
not above zero, which leaves that asset's stored price; a `null` removes the asset's price that day,
and an asset the patch does not name keeps its own; and
`snapshot.move` revalues each price at the old day's units and divides it by the new day's, onto a day
with nothing stored. THE EXPORT AND THE IMPORT CARRY THOSE PRICES, NOT ₴ QUOTES: one row per stored
price, with its asset, day and witness time, a price on a day its position holds none included. The
server stores no ₴ quote, and `/view` derives one on read. `GET /state` answers them by day, then
asset, a witness time absent where the store recorded none. THE IMPORT IS STAGED, shaped as S3's
multipart upload. `POST /imports` opens it with a manifest — each table's row count and the digest
of its parts — and answers 201 with its id, any staging open before becoming garbage. `PUT
/imports/{id}/parts/{part}` stages one part, bounded in rows and bytes and numbered as S3 numbers
parts, under a `Content-Digest` SHA-256 of its body that a mismatch refuses 400; the same body under
its number again is a no-op and another body 409. Each row passes core's door, and every rule the
whole dataset owes is a key, so a part carrying a duplicate id, a row naming no asset or a second
price for one asset and day is refused 422 naming the rule and stages nothing: assets go in before
the parts that name them. `POST /imports/{id}/commit`, under the strong `If-Match` as a write is,
checks that the parts run from 1 with no gap, that the SHA-256 of their digests in order is the
manifest's, and that each table holds the rows promised, refusing 409 with what differs, then moves
the live pointer, closes the staging and bumps `data_version` in one row update; sent again after it
landed it answers the current tag. `DELETE /imports/{id}` closes the staging, 204. An import idle
past its limit is gone. A price row is written as it stands, a witness time the file leaves out left
out again.
THE ACCOUNT'S SETTINGS ARE WRITTEN BY `PATCH /settings`, on the write's function and behind the same
gate, and READ FROM `/view`: there is no `GET /settings`. The body is a JSON merge patch
(RFC 7396) of the ten fields *Persistence today* names, sent as `application/merge-patch+json`: a
field it names takes its value, `null` resets it to its default, and one it leaves out stays as
stored (a value its rule refuses among them, which a read serves as the default, or as its strings
when it is a list holding a non-string), as does a member of the stored object that no field of
this build is for, written back after the fields;
a list is replaced whole, "it is not possible to patch part of a target that is not an object,
such as to replace just some of the values in an array" (RFC 7396 §2), so of two lists sent
the later one stands. Once the gate admits the caller, a medium other than that is 415 naming it in
`Accept-Patch`, a body past the byte bound 413, and one that is not JSON or not an object 400. Then
EACH FIELD THE SANITISER REFUSES IS 422 `invalid_settings` and named with a code, `unknown-key` for
a name that is no account setting — the theme and every per-device field among them, even to reset
it — and `invalid` for a value its field does not accept, a list holding anything but strings
included. A patch is applied whole or refused whole, and the 200 answers the settings in full. The
write is made from the text the row holds and lands only where the row still holds that text, and is
made again from what the row holds when it does not, or when the cluster reports a serialization
failure, so two writers naming different fields keep both; one that changes nothing writes nothing;
and the stored text may not pass the request's byte bound, 413. A SETTINGS WRITE MOVES NO
`data_version` and takes no `Idempotency-Key`: a period change costs no `/view` read, no tab's
`If-Match` goes stale, and a patch applied twice leaves one state. The text lives on the row
`data_version` lives on, so a settings write and a mutation touching the row at once conflict at
commit, and the one that loses is retried.
THE CLIENT BUILDS THE OPS in `src/lib/writes.ts`, which no screen calls yet. A repository write is a
list of ops sent as one request under the strong tag `/view` or the last write gave. An update is a
patch, so a member its caller left `undefined`, which a Dexie update removed, goes out as `null`. A
day's save sends a `null` for each quote the stored day holds and the drafts no longer do, and no
`savedAt`, the server stamping the witness time. An asset goes out without `inzhur.units`, which
its door refuses, and with `createdAt` cut at the second, as the backup cuts it. A transaction that
creates its asset sends `asset.add` before `transaction.add` in its one request: the transaction
names the asset, and the request lands both or neither. The targets of the assets a save changes are
one list of `asset.patch` ops, within a request's bound of ops. A delete past the row
bound is the one write that is several requests: the 409 `too_many_rows` is answered with
`asset.prune`, each step a request of its own under the tag the last gave, until one answers no row
remaining, and then `asset.delete` is sent again. It stops at a reply that is not a write and at a
count that is missing or does not fall. The `dropped` that `snapshot.patch` and `snapshot.move`
answer is returned to the caller beside each op's answer.
**Why.** One implementation cannot be a second source of truth, which is the objection to server
derivation and the reason importing core answers it. The archive is public reference data, so a second
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
the reader can do rather than where a grant came from. RFC 9110 §8.8.3 marks a tag weak when it
cannot meet the strong validator's characteristics, which a wall-clock day defeats, and §13.1.1
requires strong comparison for `If-Match`, so one tag serving both would fail every precondition.
Composing beats hashing the body: §8.8.1 blesses a digest only where it need not be recalculated
for each validation request, and under `no-cache` each request is one. The caller is an input
because every `data_version` starts at 0 and RFC 9111 §4.3.1 lets a cache validate a response it
cannot choose. `must-revalidate` binds only a stale response and lets a shared cache reuse one sent
with `Authorization` (RFC 9111 §5.2.2.2). None of AIP-185, Azure's, Zalando's or GitHub's API
guidelines puts a version in a response body, which can neither route nor cheaply reject; Next.js
sends its deployment id as a header. A header takes no `X-` (RFC 6648). The dates' digest leaves out the day of their row, which
every nightly capture moves without changing the dates. The lookback only bounds
the SQL window, wider than any gap between two of the archive's observations of one ref, since a
cutoff on carrying a price is rejected (*Derived figures and the seed*). API Gateway's HTTP APIs do
not compress. A cache keys a stored response by at least its method and target URI (RFC 9111 §2),
but a client keeping one tag per route would be answered 304 for a period or a page it never
stored, so the route and its parameter join the tag. The editors' rows ride the boot read because a
form waiting for a read of its own would cost a request per screen: Microsoft's Chatty I/O
antipattern says "Reduce the number of I/O requests by packaging the data into larger, fewer
requests", and TanStack Query advises restructuring the API "so you can fetch both of these in a
single query". The quotes come from the user's own rows because the rebuilt series quotes a carried
grid day and an archive price too, and a screen prefilling from it would save them back as
observations.
AIP-158 answers an offset it cannot fulfil "200 OK with an empty result set" and no next token, an
empty token being "the only way to communicate 'end-of-collection'", and Azure's guidelines omit
`nextLink` on the last page: an end read off a short page is wrong whenever the last page is full.
PostgreSQL warns that different LIMIT/OFFSET values "will give inconsistent results unless you
enforce a predictable result ordering", and a snapshot has no key but its date, so rows of one date
fall back to what they show. Payload 2.0 joins a query parameter sent twice with commas, so a
repeated one fails the list rather than picking a value. AIP-211 has a service "check authorization
before validating any request", so a caller the gate refuses hears that whatever the query says. RFC 9110 §8.8 has a successful state-changing request's validator describe the new
state, so writes chain without a read between them; `If-Match` compares strongly, and `*` is refused
before that comparison, which counts it a match, because RFC 6585 §3's 428 is for a request that
names no state. A request is one transaction because its effect and its stored response must commit
together (*User schema and deletes*), and applying ops in order defines what two on one entity mean,
as JSON:API's atomic extension, Spanner and Datastore do. The tag names no caller and every user's
first is `"0"`, so a browser that kept one user's export could revalidate it for the next: no cache
keeps it. The quotes screen saves a quote for a position held none of on purpose, and no per-unit
price reproduces one, so it is dropped rather than refused. A replacement deletes whatever its
sender did not send: AIP-134's example of a `PUT` that "unintentionally wiped out data because the
previous version did not know about it" is why Google APIs "generally use the `PATCH` HTTP verb
only". RFC 7396 has null values "indicate the removal of existing values in the target", and a
member a merge patch leaves out stays as it is. A price is a fact about an asset on a
day, not about a position, and every tracker read for the ruling keeps it so: Portfolio Performance
holds `prices` on the `Security` and its CSV export walks that list; Ghostfolio keys `MarketData` by
data source, symbol and date with no relation to a user, and exports every stored price of the
user's own custom asset profiles that its activities name, with no filter on holdings; and in
Beancount, Ledger, GnuCash and Wealthfolio a price names a commodity and a date, and no holding. A ₴
quote cannot carry three such prices: one on a day its position holds none, one whose held value
rounds below a kopeck, and one whose day now holds other units than it was stored at, which a quote
rounded to kopecks at those units can give back as a different price. `/view` carries each on to
later held days, so a file of quotes loses or shifts a price a restore must keep. A dataset outgrows
one transaction's row ceiling, and practice stages parts unseen until a commit: S3 "constructs the
object from the uploaded parts" on completion, and Azure's block "doesn't become part of a blob
until it's committed". The commit's checks are S3's composite checksum, whose part numbers "must be
consecutive and begin with 1", and a digest the client sends and the server verifies, as S3, Azure,
GCS and tus do and RFC 9530 names. DSQL defers a foreign key only to the end of its own transaction
— "the DEFERRABLE option applies to foreign key constraints only" — so a rule the keys hold is met
at the part that breaks it, as Salesforce loads "parent objects before their master-detail children"
and Spanner "must always load the parent before the children"; the client checks the whole file
first, as Ghostfolio validates "before any data is persisted". A part is "a few hundred rows rather
than thousands", AWS's loading guidance. A commit sent again answers 200 as AIP-155 answers a
duplicate, with the tag the next write needs, and an abort is 204 as S3's and tus's are.
A settings write is a route of its own because it is the one write that must not move
`data_version`: a `/mutations` op bumps it, and every other tab's `If-Match` would go stale at each
change of period. Its read rides `/view` as Grafana's page boots with a `window.grafanaBootData`
whose `user` carries the signed-in user's theme, and as Mastodon's `InitialStateSerializer` lists
`:settings`; Grafana changes preferences by `PATCH /api/user/preferences`, "Update one or more
preferences without modifying the others." RFC 5789 §2 says "The server MUST apply the entire set of
changes atomically" and, where it cannot, "MUST NOT apply any of the changes"; §2.2 answers a
malformed patch document 400, one in a format the resource does not take 415 with an `Accept-Patch`
header, and a patch the server understands and cannot process 422. AIP-134's update "should include
the fully-populated resource", so the 200 answers the ten fields with their defaults filled. DSQL
reports two transactions that "attempted to modify the same row" as a serialization failure at
commit, OC000, so a merge made from a read is guarded by the write's own condition on the text it
read, as the version bump is by the version it read. The column's ceiling is DSQL's "Maximum size of
a column that's not part of an index", 1 MiB, which is also the most a request carries: the stored
text is held to it, so a write that would outgrow it is refused by name and not by the cluster.
A merge patch keeps what it leaves out and `JSON.stringify` leaves out a member whose value is
`undefined`, so a removal sent as `undefined` would keep the stored value: RFC 7396 spells a removal
`null`. A save of N targets as N requests spends N of the route's burst of five and its two requests
a second, where one list lands whole as a request does and is, in Microsoft's Chatty I/O
antipattern, "packaging the data into larger, fewer requests". Emptying an asset is the client's to
drive (*User schema and deletes*). A loop driven by a count the server answers ends only if the
count falls, so one that does not is returned rather than asked again.
**Rejected.** A service worker: the most browser-divergent layer in the plan, bought for an offline
the plan had already given up. · A mapping naming a user stack's function role: the archive deploys
from `dev` alone, so a role `main` replaced could not be granted again. · A `Principal` naming those
roles by ARN: it goes stale when SAM replaces one. · `Fn::ImportValue` for the identifier: an
imported output pins the stack exporting it, and the user stack deploys first. · A grant by a
fixed list of table names: it ran before the capture had created a fresh archive's tables, or a
newly added one, and failed the deploy. · Revoking each extra privilege by its source: a source the
sweep does not name survives it, and there is always another to name. · One validator for the read
and the write: a weak tag never satisfies `If-Match`. · A hash of the body as the read's tag: it
rebuilds the body to answer a 304. · `must-revalidate`. · A deployment version in the body: AIP-185
versions an API, and the data tag `/view`'s body carries is a precondition a client sends back, not
the version of anything deployed. · Copying the model route's exact `If-None-Match` comparison: a
tag sent without its `W/` must still match. · Clamping a page past the last to the last: one URL
would answer another page as the rows grow, and a client's miscounted page would read as data. · A
default period: a stale tab's retired one would be answered as another. · Refusing two ops on one entity, as DynamoDB and Azure
do: neither gives a reason, and in-order application already defines the result. · Retrying a 412:
it is the precondition doing its work. · Exporting snapshots rebuilt from the prices, a day a later
edit left valuing nothing quoting nothing: the file holds no price for that day, so no restore can
write it back. · Hiding such a day from the export: its rows still refuse a move onto a day the client cannot
see. · Deleting such a price at the ledger edit: deleting a buy and adding it back wipes the prices
the user entered. · Quotes plus a per-unit price only where no quote can carry one: two encodings in
one row, and its quotes, rounded at each day's present units, still shift a price whose day's units
a later edit changed. · Deferring the import's whole-dataset rules to the commit, as pg_dump and
Spanner's import load before they key: DSQL defers no primary key and no foreign key past a part's
own transaction, and data tables without keys would let a row reach another generation. · Recording
a refused part so the commit can name its rule: none of the multipart protocols weighed remembers a
failed part, and S3 answers the commit `InvalidPart`. · Letting a second body overwrite a part, as
S3 and Azure do: a part's number then names whichever body arrived last, and the manifest's digest
would decide which. · `snapshot.put`, replacing the day: a day's quotes as the server gives them
back name no asset the day holds none of, and the screen prefills from them, so a day written again
deleted that asset's price, which no quote can carry, and answered that nothing was dropped. · A
put replacing only the positions the day holds: still a replacement, so a held position its sender
left out lost its price, the loss AIP-134 gives. · Every recorded day in `/view`: its size follows
the history, and the quotes screen reads one day. · The rebuilt series as the source of the recorded
quotes: it quotes a carried grid day and an archive price as well. · The settings as an op of
`/mutations`: it bumps `data_version`, so a period change costs a `/view` read and every other tab's
write is refused 412. · A `GET /settings`: the read rides `/view`. · A `PUT` of the whole settings
object: it deletes what its sender did not send, such as a field a build that loaded before does not
know (AIP-134, above). · Dropping a name that is no setting, as a read does: a client sending a
theme would be answered 200 and find it stored nowhere. · Salvaging a list's strings, as a read
does: the write would store something other than what was sent and answer 200. · Taking
`application/json` as a patch as well: the route takes one patch format, and RFC 5789 §2.2 answers
any other 415. · A write that merges into the text the gate read without a condition on it: of two
writers naming different fields, the later would put back the earlier's. · Writing back only
what a read serves, the fields this build has with the values its rules accept or, for a list, its
strings: a backend rolled
back to a build that predates a setting, or accepts fewer values of one, would delete it at the
next patch of any other. · A day's save naming only the drafts: the merge keeps the quote they
cleared. · The targets of N assets as N requests: a burst of five, and a failure partway leaves a
plan half saved. · An asset's last prune and its delete in one request: when the delete still does
not fit the bound the whole request is refused, and the prune with it.

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
not read that way. THE DATA ROUTES HAVE ONE TRANSPORT, `src/lib/transport.ts`, which no screen calls
yet. It sends the ID token as a bearer, and no cookie, to the API the page's host names, and hands
each answer back as a typed reply: the four refusals apart; a 412, a 409 for a write still running,
a 422 for an invalid op or for a reused key, a 413, a 428, a 401 and a 429 each as a kind of its
own; any other answer by its status and body. A body goes as the text it was given, under
`application/json` unless its caller names a type, as `PATCH /settings` must. Nothing is sent where
the host names no API, nor where the account is signed out or a sign-out is running, the pair held
meanwhile being the account's that is leaving; the reply to the latter two is a 401's kind. It shows
a refusal only for a route every user may call, which the first segment of its path names, and only
when no sign-out has begun since the request did: the session counts a sign-out when it begins,
because its status changes only once the relay answers. A sign-out that begins during a call ends
it before its next send, since the next token may be another account's. A 412 is never sent again.
A 429, a lost connection and a 409 for a write still running are sent again after a Full Jitter wait
drawn from up to half a second and doubled at each retry, at most four times, and are then returned
as they stand. A token the relay could not be reached for, a refresh the network lost or a load it
never answered, is asked for again on the same schedule and then returned as a lost connection. An
attempt waits only as long as API Gateway can take to answer, `ANSWER_MS` as the relay's calls do,
and one it does not answer is a lost connection. A keyed write goes under one `Idempotency-Key` for
all its attempts, so an answer lost in transit finds the 200 the server stored. A `derivation-id` that differs from the build's is
returned with the answer and acted on by nothing: `pnpm dev` defines the build's from the local
checkout and proxies to the deployed API, so on a branch the deploy lacks a reload on a difference
would not end. A SIGN-OUT THAT LANDS ON `/sign-in` SAYS SO THERE, ONCE: the fact rides the navigation
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
The IETF's `Idempotency-Key` draft is what lets a client send a POST again, and it names 409 as the
one refusal a client sends again with no correction; a 412 is the precondition doing its work, which
sending it again unchanged cannot change. AWS's backoff study shows exponential backoff alone still
leaves clusters of calls and jitter spreads them, and says most AWS SDKs support both in their
standard retry mode; its Builders' Library calls a retry "selfish", hence a bound. The window starts at
the half second in which the API's two requests per second refill one token.
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
`RESET_PASSWORD` step: the app has no reset to lead it to. · Retries left to TanStack Query: its
default is none for a mutation, and three for a query after a wait that doubles from a second with no
jitter, so a write would not be sent again on a lost answer unless each caller said so. · A reload
when the `derivation-id` differs: a checkout with a commit under `packages/core/src` the deployed API
lacks differs from it for as long as it stands.

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
cascade inside the request's one transaction, children before the parent: `asset.delete` counts the
asset's rows first and is refused with that count when they would pass the request's row bound, and
`asset.prune` deletes as many as the bound leaves, prices first and then transactions newest first,
and answers how many remain, so each step the client drives leaves a valid dataset. A user, their one account and their live dataset
are written in the SAME transaction by the gate's open-registration insert, by approval's rekey and
by the bootstrap mode — each idempotent, so a re-run leaves one account and one dataset. The
gate's and the bootstrap's retry on a serialization failure; approval's does not, a retry there
re-running an insert whichever concurrent approval won has already made. A PENDING application is
written by neither and provisions nothing: approval DELETES that row to rekey it onto the minted
`sub`, and a key restricted on delete would refuse that. The demo identity is written by a
migration, so its account is too, in a file of its own.
A USER'S DATA IS A DATASET: a `dataset` row keyed `(user_id, id)`, its id unique on its own, and
`app_user` names two of them — the live one and the one an import is staging. Each pointer's key
ends at the user's own dataset, and a dataset a pointer names is refused deletion. `asset`,
`transaction` and `user_price` lead every primary key with `dataset_id`, and every key between them
carries it, so no row reaches another generation; the account stays the user's, so `transaction`
also carries `user_id`, held to the dataset's owner by a key of its own. EVERY STATEMENT OVER THOSE
THREE, OR OVER AN IMPORT'S MANIFEST AND PARTS, JOINS ONE OF THE CALLER'S GENERATIONS ITSELF: the
live pointer — `JOIN app_user u ON u.dataset_id = … WHERE u.user_id = $1` — or, from the import's
module and the collector alone, the staging pointer `u.import_dataset_id`, or, from the collector
alone, a dataset of the caller's that neither names, each stated `IS DISTINCT FROM`. A guard over
`infra/src`'s modules, reading PostgreSQL's parse tree, refuses one whose own conditions — `WHERE`
and inner-join conjuncts and `=` key-sets — do not tie each data table to one of those, that reaches
two, or that reads a data table's own `user_id`; each such statement also has a test against a
second generation. Moving the live pointer off a dataset bumps `data_version` in the same
transaction, `/view`'s tag being composed from the version and not the pointer; `dataset.clear`
moves it to a new, empty dataset in one request, whatever the old one holds. GARBAGE IS A DATASET
NEITHER POINTER NAMES — what a commit, a clear, an abort or a new begin leaves, and an import idle
past its limit, whose pointer the collector clears — and every later `POST /mutations` that
answers 200 and every import request that succeeds removes one bounded batch of it, children first,
in statements of their own after its transaction, their failure logged; a commit as many as the
function's remaining time allows. Nothing collects on a schedule, on a read or on a settings write.
Every account holder
has a dataset: a backfill gave the ones provisioned before the switch theirs, and provisioning
writes one with the account. A write's idempotency keys live in `mutation_key`, one row per user
and key, restricted on the user's delete; a row holds a claim's token and window, and its stored
response whole or not at all. An import's manifest lives in `import_manifest`, keyed by the
generation it stages, and each staged part in `import_part`, keyed by that manifest, each restricted
on the delete of what it names. The account's settings are `app_user.settings`, one nullable text
column. EVERY `POST /mutations` CARRIES AN `Idempotency-Key`, a UUID unique per user and
read lowercased; one missing or malformed is 400, and the bounds and its format are checked before
anything is claimed. A CLAIM COMMITS FIRST, in a transaction of its own, under a token of the
request's; the effect, the version bump and the stored response then commit together, under that
token. The same fingerprint — the method, the route and the decoded body canonicalised as RFC 8785
does, `If-Match` left out — replays the stored response; another body is 422 `key_reused`; a live
claim is 409 `request_in_flight`; a claim past its window, which outlasts the function's timeout, or
a key past its lifetime, is taken over by a compare-and-set on its token. ONLY A SUCCESS IS STORED: a
refusal releases the claim. Each later success deletes a bounded number of the caller's expired keys
in a statement of its own, its failure logged, and nothing sweeps on a schedule. A serialization
failure, `40001` or `XX000`, is retried after short delays, the key row read first, which answers a
commit that landed under the error; a stale `If-Match` is 412, never 409, and never retried. A SCHEMA THE CODE WILL NEED SHIPS A MERGE BEFORE THAT CODE, the code
being live before the schema — except a table no deployed code writes, which may be recreated in the
merge that switches its reader, the reader failing until the migration applies. A migration that
drops a table refuses first while it holds a row. A version cut carries every merge since the last
one, so production meets each window at once: approval, the bootstrap and an open gate there wait
for the cut's migrations.
**Why.** Generated DDL carries no `IF NOT EXISTS` and DSQL has no cross-statement rollback, so a
file that fails partway cannot be retried — the retry dies on the first statement, which already
exists. The mutated-row ceiling is per transaction and one asset's saved prices can exceed it, while
a request is one transaction so that it lands whole; so an asset that does not fit is refused and
emptied in steps the client drives, as AIP-135 refuses a delete while children are present and S3
deletes only an empty bucket. A cascading key would not remove the ceiling, cascaded rows counting
against it. The key is resolved before the precondition because a retry of a request that landed
carries a tag gone stale by then; the claim commits apart from the effect so two requests holding
one key cannot both apply, Brandur's separate phase and Powertools' in-progress record; and the
stored response commits with the effect because DSQL can answer an error for a transaction that
committed, the Builders' Library's rule that the token and the mutation are one ACID operation. `transaction.account_id` is NOT NULL against a composite key, so a user
without an account is not an empty state any screen can render — every write is refused — and both
rows living in one database makes one transaction the whole answer to a partial failure. `ON
CONFLICT DO NOTHING` prevents a duplicate row and not the commit-time conflict optimistic
concurrency reports, which is why the retry is not that clause's job. An import must replace a
dataset larger than one transaction and leave readers the old one or the new, so it stages the new
one beside the live one and moves one pointer — the shape index aliases, Iceberg and Git refs take
— and DSQL refuses a changed primary key, so a generation needs keys of its own. The account
decides who gets one because it is what provisioning writes, and a pending row owns nothing. The
account is the user's rather than the generation's: one row per provider per user stays a
constraint, clearing a dataset moves only a pointer, and Ghostfolio keys its activities to an
account the same way. A generation is the LEADING KEY, not a filter beside `user_id`, which is why
the tombstone's objection is answered by that guard and those tests rather than by care: a
statement that skips the pointer reads every generation. Garbage is found as git finds it, by
reachability, and git's maintenance runs "after they have written data". A dataset is never
unreferenced at birth nor referenced again once dropped; a mutation begun before a commit or a clear
conflicts with it on `app_user`, and a part begun before an abort or a new begin writes the manifest
row the collector deletes before the dataset, so under DSQL's write-write adjudication the two
cannot both land and no grace period is owed — git's and Iceberg's guard a writer they cannot see. A
staging that nothing supersedes expires as Azure's uncommitted blocks and GCS's resumable sessions
do, a while after the last part. A batch follows AWS's DSQL guidance on batch size, under the row
ceiling with room for the request's own.
GitLab creates a table its code needs BEFORE that code deploys; this pipeline has only the
after-code slot, so the expand takes a deploy of its own.
**Rejected.** Replacing a dataset in place behind a lock: a failed import leaves the data locked
and half-replaced. · Tombstones: a `deleted_at` puts a filter in every read that the first forgotten one
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
is no headroom to buy. · Steps inside one request that commit on their own: the request would land
in part, which no stored response describes. · Storing a refusal: a corrected request under the
same key would replay it. · A scheduled sweep of expired keys: *Alerting* prices a scheduled
function at two alarms, and a key costs nothing until its owner writes again. · Collecting garbage
on a read: practice collects where data is written — git after a command that writes, SQLite at
commit — and the reads stay read-only transactions. · A timestamp per part so parts could be staged
in parallel: the manifest row is what makes a late part conflict with the commit and the collector.

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
the owner names no issue, its topmost `Ready` card with no open blocker the pick; the
`order-milestone` skill rewrites it, putting every `bug` with no open blocker on top, after a
triage, a planned epic and a version cut, and before every pick the owner does not name. Delete,
never archive; a figure lives in a test or not at all; `CLAUDE.md` is rules.
**Why.** A task list in two places disagrees with itself. An issue with no milestone has no place in
that order, and the sort decays one triage at a time; an observation waits for its day, not its
turn. Bug-first is a rule of the order alone, so once the order is rewritten the pick is the
board's topmost `Ready` card with no open blocker, where a pass by label could take one from below
it; the rewrite comes before an unnamed pick because anything since the last one, a close, an
edited relation, a relabel or a drag, can leave an unblocked bug below the top. A figure written
into prose goes stale in silence and passes every gate; a test fails.
**Rejected.** Jira or ticket keys: one person, no board. · A `Backlog` milestone: it holds exactly
the issues nobody has ordered. · A pick-order file in the repository: a closed issue stays in it
until the next rewrite, where a closed card leaves its column by itself. · Documentation ratchets:
a guard bumped on every routine edit is a rehearsal for bumping it unread.

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
watch mode takes the same. A hook whose answer moves with state it subscribes to is tested mounted, with
Testing Library's `renderHook`, in a file that opts into jsdom by its `@vitest-environment` comment;
the suite stays `node`, and such a test advances a fake clock inside `act`. THE USER-API TRANSPORT IS
TESTED AGAINST MOCK SERVICE WORKER 2, in node: `src/lib/transport.test.ts` serves the routes with
handlers and listens with `onUnhandledRequest: 'error'`, so a request no handler names is halted, and
one test sends such a request to keep the option live. `src/lib/writes.test.ts` serves a fake of the
user API the same way, which applies the ops with core's schemas and merge patch, a request landing
whole or not at all, so that a list the builders make is read back from the day or the export.
**Why.** These documents carry figures, contracts and instructions no type checker reads, and a gate
whose verdict moves with whether an agent happens to be running is not a gate. `toJS()` discards an
unknown tag and keeps the scalar, so a `!GetAtt` and a literal spelt the same way are one value to a
parsed template. A pattern over SQL re-derives a grammar it never finishes: each construct it learns
to skip, a nested query or a quoted name, is one more it can misread. A PGlite keeps the memory it
booted with after `close()`, so a cluster per test grew every worker until a full run left the
machine none to spare; per-test isolation stops at the database or schema in the tools this follows,
and cluster-level state is shared there too. A worker's memory does not shrink as the cores grow,
so a count that scales with them spends memory a loaded machine may not have; the one fewer is kept
for the main thread, whose single Vite server serves every worker. React deprecated
`react-test-renderer` and points to `@testing-library/react`; TanStack Query's testing guide mounts
a hook with `renderHook` inside a `QueryClientProvider`, and its suite, like usehooks-ts', runs
Vitest on jsdom. Testing Library's `waitFor` recognises fake timers only through a `jest` global, so
under Vitest's it polls on a clock nothing advances. Vitest's guide recommends Mock Service Worker and
shows `onUnhandledRequest: 'error'`, which halts a request no handler names; the test that sends one
fails under a version that renames the option, where the request would otherwise go through.
**Rejected.** Exempting a one-line docs branch: "too small to review" drifts to the size of whatever
the author is holding. · Asking the planner (`EXPLAIN` in PGlite) which sort keys are expressions:
`SELECT DISTINCT` and `count(DISTINCT …)` sort on expressions by design, so every query would need
an approved plan to compare against. · A cluster, or a `clone()`, per test: each keeps its memory. ·
Refusing a built-in edited in place by hashing every catalogue row: it would first need the columns
PostgreSQL rewrites on its own, to guard against what no suite does. · `'50%'` workers: it rounds
against every core, so a four-core runner would drop to two. · A budget over total memory: it cannot
see what the machine's other apps hold. · Sizing from free memory: the worker count, and so the
gate, would move with the machine's load. · `vmMemoryLimit`: it recycles only the vm pools' workers.
· jsdom for the whole suite, or a project of its own: every other test passes without a DOM, and
`src/vitest-scope.test.ts` keeps one project. · Vitest Browser Mode: a
Playwright provider and a browser project for a hook that needs no layout. · MSW 3: `@vitest/mocker`
declares `msw ^2.4.9`, and 3.0.2 renamed that option `onUnhandledFrame` and let a request through
under the old name.

## Dependabot
**Decision.** Security only, and deliberately no `.github/dependabot.yml`, the file that turns the
dependency tree into routine version PRs. The ADVISORY in the lockfile is the unit, not the PR and
not the alert: draining either list is not draining the advisories. A transitive advisory whose fix
its parent's range admits is fixed by the unpinned in-range update, `pnpm update <pkg> -r`, never by
an override and never by `pnpm audit --fix`. `.github/workflows/advisories.yml` runs `pnpm audit` on
`dev` daily and opens one issue for what it finds, naming each advisory, whether that update clears
it, and the command; while that issue is open it opens no other. An advisory accepted as it stands
goes in `auditConfig.ignoreGhsas`, with its reason; pnpm drops that GHSA on every version line it
sits on. `reference/DEPENDABOT.md` carries the two ecosystems, their fixes and where overrides live.
**Why.** Every merge here costs a review, so version churn taxes the gate that protects the app and
buys no security. GitHub's squash preserves the PR author, so the button would land a bot-authored
commit on a branch that forbids the force-push it would take to undo. Dependabot opens no pull request
for a transitive pnpm advisory: its security job asks pnpm for `<pkg>@<version>`, which pnpm leaves
undone where the locked version already satisfies the parent's range, and the job ends
`security_update_not_possible`
([dependabot-core#15766](https://github.com/dependabot/dependabot-core/issues/15766),
[pnpm#12744](https://github.com/pnpm/pnpm/issues/12744)). GitHub's preset auto-triage rule, "enabled
by default for public repositories", dismisses development-only npm alerts
([auto-triage rules](https://docs.github.com/en/code-security/dependabot/dependabot-auto-triage-rules/about-dependabot-auto-triage-rules)),
and a dismissed alert leaves its version in the lockfile. So the alert list understates the lockfile
and nothing reaches the task list on its own; `pnpm audit` reads the lockfile itself, and an issue
lands in `Triage`, which every session reads first. By default pnpm takes no
version younger than a day while an older one fits the range
([supply-chain security](https://pnpm.io/supply-chain-security)), and the locked version always
does, so the in-range update takes no release that new.
**Rejected.** Routine version-update PRs: one person, one review per merge, no advisory closed. ·
`pnpm audit --fix update`: it rewrites direct specifiers across the manifests and adds
`minimumReleaseAgeExclude` entries, version churn and a weaker release-age guard. · An override where
the range admits the fix: it outlives the advisory and pins the tree. · `open-pull-requests-limit: 0`
with grouped security updates: it shapes Dependabot's PRs and leaves the pnpm refusal that stops
them. · Renovate's `lockFileMaintenance`: it re-resolves every dependency to the latest
([options](https://docs.renovatebot.com/configuration-options/)). · A pull request from the
workflow: it needs Actions allowed to create pull requests, for a fix that is one local command.

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
the lockfile lying outside the tree. `GET /view` composes it into its tag and sends it as
`derivation-id`. The SQL that reads the rows, and its mapping into core's types, stay in `infra/`,
outside the tree, so a change there moves no identifier, and a revalidating client keeps the body it
holds until another of the tag's inputs moves, the Kyiv day at the latest; `infra/src/ledger.test.ts`
and `infra/src/sell-observations.test.ts` pin the mappings.
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
its occurrence stops being produced. A banner's close hides that banner; a coupon is settled by a
Skip on its card or a recorded payout, and with coupon suggestions on, a closed banner's card still
arrives on its date. The
theme is ONE list of values redefined per theme, and BOTH
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
