# Decisions

Current state only, one topic per section: what is decided, why, and what stays rejected. Rewritten in place when a decision changes — the history is `git log -p` on this file. Code cites a topic by its heading; the table at the end resolves the old `D<n>` numbers still found in comments.

## Core is pure
**Decision.** `src/core/` is the pure domain layer — no React, no Dexie, no store, no UI — and
`src/lib/` holds persistence and infra; the import zones are enforced by lint, not by convention.
Pure modules return keys and tokens, never assembled prose, and the component layer writes the
sentence. New code calls `repository.ts`, never `db.ts`. Adding a dependency is a decision, and it
gets a line in this file.
**Why.** The domain layer is exactly the part a move to a server does not touch, and the repository
is the seam that move replaces — so the boundary is worth enforcing before anything stands on the
other side of it. Prose assembled inside a pure module cannot be translated where it is built.
**Rejected.** A component reaching for `db.ts`: it bypasses the one surface the migration swaps. ·
English returned from `core/`: the language is a parameter, never a default.

## Persistence today
**Decision.** Dexie on IndexedDB behind `repository.ts`, which is the only writer; two databases —
demo, seeded, and live, never auto-seeded — bound once at boot from persisted settings. The Dexie
version bumps for stores and indexes only, and every persisted setting joins `partialize` in the
commit that adds it. The JSON backup envelope is `formatVersion 6`, refusing a newer, an older and
an unreadable version with three distinct sentences; import validates fully, shows a diff, then
replaces in one transaction — a key the file omits is REMOVED — after a safety backup that cannot be
cancelled. Export re-reads its own output and refuses a file it could not read back. CSV is
export-only, and what it writes is data rather than formulas — a cell beginning `=` or `@` is passed
through as typed, the exposure every free-text column in it already carries.
A LIVE STORE HOLDING A RETIRED ROW SHAPE IS ERASED, NOT MIGRATED, and the consequence is stated
rather than discovered: a `tax` row predating that type's retirement fails the envelope, so export,
import and the safety backup all refuse together and the version gate cannot reduce it to one
sentence, since the file this build writes is already the current version. On screen such a row renders with an EMPTY type name — the ledger looks its type
up in a dictionary the key has left — while every derivation ignores it correctly. The exit is
Settings → Danger zone, whose erase does not go through the envelope. Re-entering by hand is the
ruling that made the retirement affordable; a Dexie upgrade that dropped the rows would be a
migration this model does not do.
**Why.** Replace-never-merge is why the diff exists: yesterday's backup silently dropping today's
work is the case the dialog must state before the press. The version tracks what a build ACCEPTS —
not how long ago it shipped — so two live builds can never share a number and disagree about fields.
**Rejected.** A library's own dump format: the envelope has to be an app-owned, human-readable
contract with domain validation. · CSV import: a second restore path, and a lossy one.

## Derived figures and the seed
**Decision.** Every portfolio figure is derived from stored data and none is hard-coded; value at a
date is `units(a, D) × coalesce(user_price(a, D), archive(a, D))`, so nothing is prefilled because
nothing is written. Automation stays suggest-only wherever the app still decides — a fetched or
accrued value reaches a draft or prefilled form and the user's Save is the sole write path — while the
server may derive values and serve them ready. A hand-entered value is marked; an archive one is not.
**Why.** The seed exists so the first run reproduces the reference, and it is written to reconcile by
construction rather than through exclusion rules — which is why its pinned figures MAY move when the
ledger model requires it, and the checkpoints are re-derived from the new seed rather than defended.
`coalesce` is silent, so without the mark an observed value and a published one read identically:
mark the exception, never the default.
**Rejected.** A minimal purpose-built fixture: checkpoints that move with the fixture cannot catch a
regression. · The user-owned display-rate override, retired with client-side derivation: the server
fetches the official rate, and the one a provider payload implies is a different basis.

## Metric families and windows
**Decision.** Two metric families, both permanent and never conflated: capital gain and total return.
The annualized column divides every row by ONE span — the selected window's, shared by all assets —
and a row whose holding falls well short of that span renders muted; per-asset XIRR is the
money-weighted column, and its annualization mark tests the WINDOW's length, not the asset's. A
window's opening position is valued the day BEFORE it opens. Units are `Σ quantity deltas` over the
ledger, never a stored total; free cash is the ledger's signed sum; a coupon derives from its RATE.
A withholding is a FIELD on the payout it was taken from, not a row of its own and never a rate
applied to one — one figure, because that is what the provider reports. ACT/365, and a zero
denominator is «—».
**Why.** The day before is the only boundary at which each transaction counts exactly once, and it
makes the full history collapse onto its unwindowed twin. One shared span keeps rows comparable —
the first thing a reader of a table uses — and the grey mark is what makes it honest. A stored
coupon amount goes stale on the next purchase; a rate does not. Tax runs the other way: rates
change, so a computed withholding eventually lies where a recorded one cannot — and on the payout
rather than beside it, the asset and the category are exact instead of inferred.
**Rejected.** Per-asset annualization: a fixed-coupon bond would beat its own contract, and XIRR is
already the per-asset answer. · Re-deriving a schedule the walkers already answer: two readings of
one schedule is the failure, not the arithmetic in either. · A stored observed cash balance beside
the derived one, with a chip reporting the drift between them: a second source of truth for the one
figure the rule above hands the ledger, and no screen ever let anyone enter the observation — every
snapshot carried the previous one's figure forward, the demo's from the seed and an unseeded
account's from zero, so a real ledger would have read as a permanent drift its own size. Re-adding
an observed balance stays additive: a table, and somewhere to type into it.

## Language, numbers, fonts
**Decision.** Ukrainian is the default language, English the second; formatting and the number
grammar separate completely per language — Ukrainian groups on whitespace and reads both `,` and
`.` as the decimal, English keeps the comma as grouping, and when both marks appear the last one
is the decimal. A currency token beside the number (`₴`, `$`, `грн`, `грн.`, `UAH`, `USD`) is
dropped before the grammar reads it; a token alone or any other letter is not, so `12abc` stays
refused. Ukrainian tables and inputs read `68 702,10`, English prose and KPIs `₴68,629.36`, dates
`dd.MM.yyyy`. The ₴/$ toggle converts the DISPLAY of headline KPIs and the sidebar capital only;
tables stay in ₴. Faces: Manrope for headings, buttons and KPI numbers, JetBrains Mono for body
and tables — and `body` sets `font-variant-numeric: tabular-nums`, which is part of the face
decision rather than a detail under it.
**Why.** A face without Cyrillic drops the app into a system fallback on every screen the moment
the default language applies, so that is the first thing either face is asked for. Only the mono
advance is fixed, so only the tables and body copy are width-stable; every display-face figure and
label moved when the face did, and the browser is where that is checked. Manrope's figures are
proportional and it ships `tnum`, so the one rule on `body` is what buys the aligned KPI column —
and `src/ui-face.test.ts` fails if the face and the rule are ever separated, because either alone
is wrong.
A field that holds an unsaved number **stores a language-free spelling** and DERIVES what it shows —
it holds `1234.5` and shows `1 234,5` or `1,234.5`, so a language switch re-draws the value instead
of re-reading it. Four fields are NOT on that shape yet — the asset form's three percent inputs and
`/allocation`'s target row — and they are safe only because the one control that changes the language
lives on `/settings`, which every one of them has unmounted before reaching. `language-holders.test.ts`
holds THAT — the single writer — because a comment cannot; the four fields themselves are a list a
reader still has to keep true. That is what makes
the switch a plain re-render: nothing migrates, so a half-typed `6,` is `6.` all along and still
takes the next digit in either language. A field holding a GROUPABLE number groups it live on top of
that, and there is no opt-out: a value under a thousand simply never reaches a grouping mark, which
is why a percentage and the ₴/$ rate look ungrouped without being treated differently.
A mark the typist PRESSES is read as this language's own: under English the comma
groups, so it is absorbed. A mark that ARRIVES BY PASTE is read by the grammar instead, which is the
only way to keep refusing a European `1234,567` under English — pasted and typed, that text is
identical to the state a digit inserted into `123,456` passes through, so nothing but how it got
there can tell them apart. The caret is put back behind the same DIGIT, never at the same offset.
A field reads a number only in a spelling it could SHOW, so `1e3`, `1.2E+09`, `0x10`, `0b101`, `0o17`
and `Infinity` are refused everywhere though `Number()` reads all six — a pasted spreadsheet cell is
the ordinary way they arrive. And a numeric refusal names WHICH refusal it was — nothing entered, not
a number under this grammar, or out of range — in three sentences, so a `16,5` pasted under English
is told it is not a number here instead of that it is not positive, which it is.
**Rejected.** One locale-blind parser: what a field SHOWS must be what its parser READS. · A field
that stores what it shows: the stored text then carries a language, and a switch re-reads an English
`1,234` as 1.234. · Judging a pasted mark the way a typed one is judged: it turns a refusal into a
silent thousandfold. · The keyboard layout as the signal: no browser reports a numeric convention. ·
`font-variant-numeric` per call site: it holds only while every site that ever shows a number
remembers it. · Bare `Number()` as the reader: it takes spellings no field here writes back, and the
field and the schema then disagree about the same string. · One sentence for every numeric failure:
it answers the commonest mistake — a mark from the other grammar — with a fact about the sign.

## Shape system
**Decision.** Nothing in the app is a capsule. A standalone control takes
`round(min(w, h) × 0.26)` off its SHORT side; a box nested against a parent's corner takes
`outer = inner + gap`, the gap being padding plus any border. A segmented control is both at once —
segment proportional, track concentric. Surfaces keep the reference's 16 / 20 / 24, and a full-bleed
bar takes square corners — the sidebar's capital strip and its footer band are both. Only asset
avatars and colour dots stay round. The mark is drawn geometry — its loop and pills are strokes,
not radii. Measure the RENDERED height — `text-[11px]` sets a font size, not a line height.
**Why.** Proportional describes an object, concentric describes containment, and reaching for the
wrong one gives an answer that looks derived while being arbitrary. A panel's width is a layout
consequence rather than a designed size, so a radius scaled from it cuts across the corners of what
it contains.
**Rejected.** A track given its own proportional value: the two curves then diverge at every corner.
· A lone capsule kept for its affordance: where nothing else is one, it reads as an oversight.

## Scrolling
**Decision.** Nothing scrolls with the platform's bar — every constrained box goes through
`Scroller`. The rail is 12 across (`2+2+4+2+2`), thumb r1 and rail r5, with a margin of 8 equal on
all four sides and a reserved gutter of `2m + 12`; `max(8, ceil(R × (1 − 1/√2)))` guards a corner
rounder than any the app has. The gutter is the ScrollArea ROOT's padding, both inline sides, fixed. One column is too narrow to
hold it — the collapsed rail has 40 of content against a 28 reserve — and passes `overlay`, which
floats the bar at the edge on a 2px margin instead.
Ask for both orientations on content you did not author — the axis you omit is `overflow: hidden`,
not merely unscrollable — and give a scrolling band `min-h-0` AND `min-w-0`. A dialog is three bands
and only the middle one scrolls. `Select` keeps the styled native bar.
**Why.** A square-cornered platform track cuts a rounded panel's corner, and takes layout width on
one OS and none on another, so a screen reflows differently per platform. Padding on the scrolling
element is INSIDE the scroll box: away from the ends of the range, content slides under the rail. The
one floating case is allowed because its item has no row to read across — a single 18px glyph centred
in 40, which the bar clears — while reserving there would leave 12px for a 40px item.
**Rejected.** Insets concentric with the parent's corner: invisible on a shape this thin, and the
real estate is not free. · Gating the gutter on whether a rail is showing: the panel then flips
between symmetric and lopsided as its content grows — which `overlay` is not, being a fixed property
of one caller's width rather than of its content.

## Two shells, one breakpoint
**Decision.** Two layouts and one switch — `md`, 768px. Below it the sidebar is an off-canvas 280px
drawer, a Radix `Dialog`, so the focus trap, Escape, scroll lock and focus return are the library's,
and the header carries the capital; at and above it the sidebar is 244px in flow or a 56px icon
rail, and the choice persists. Collapsed, the rail owns the control that expands it and the header
carries the figure and the dataset caution — the two things a 56px shell cannot hold. The breakpoint
is written twice — in the markup and in
`useIsDesktop` — and the two must stay one number. 44 × 44 is HIT AREA, never geometry: a transparent
centred overlay grows the pressable region and leaves every radius where the shape system put it.
Exactly one branch mounts per shell.
**Why.** Growing controls to 44 would rewrite five radii and a concentric chain as a side effect of
an accessibility fix. A control with no drawn box gets real padding instead, because an overlay
reaching past its own control hands the tap to the neighbour — and a text field can never take one,
since an `<input>` renders no pseudo-element at all.
**Rejected.** A rail that only hides: collapsing to nothing leaves an absence rather than a place,
which is why that state was never worth keeping across a reload and this one is. · A theme control
in the rail: one glyph cannot show the two states it is not in, and there it would be the only theme
control on screen; currency survives the same test because the box shows the state you are in. ·
Rendering both table forms and hiding one: the phone still builds and derives the table it cannot
show.

## Brand
**Decision.** The product is Quirenote and the domain is `quirenote.com`; the rename went all the way
through the infrastructure, so no identifier anything addresses still carries the old name. The logo
is the 5h mark — a rounded loop with a small second bay, and two pills falling from its right edge,
all stroke and no fill — and it SHIPS in three files: `src/app/Sidebar.tsx`, `public/favicon.svg`
and `public/apple-touch-icon.png`. The raster is generated, so the drawing is DRAWN in four — the
fourth being `scripts/build-touch-icon.mjs`, which the mark's test reads as a first-class copy and
against which it checks the committed PNG. Edit the mark and all four move. Nothing sits behind it.
Its three parts take three PER-THEME tokens — `logo-outline`, `logo-pill-a`, `logo-pill-b` — so
the mark inverts with the app; the two files that cannot read a token hold the same values as
literals, and the favicon's light trio is its default branch because Safari ignores the colour-scheme
query. The box is the design sheet's own and is not cropped to the ink. The sidebar LOCKUP is that
mark at 22px beside a lowercase `quirenote` in the mono face at 600 and -3%: one row, no plate behind
it and no tagline under it, with the dataset badge as the row's third member rather than an ornament
floating over a box.
**Why.** Every precise word was taken in every zone, so the name is a compound, and the collision
audit killed better candidates than the availability sweep did — half the neighbours of a mined
ending are financial. One brand sand served both themes only because the mark's only plane was dark
in both; re-planing the wall onto the theme spent that reason and left the sand under 1.4.11 on
parchment. Cropping a mark to its ink was the retired drawing's argument, and it bought that drawing
a thicker stroke on a 16px tab; this one is set out on a padded box that the sheet itself renders the
lockup on at the size the app draws it, so taking the box is taking the drawing as drawn — and a box
measured off the geometry rather than the paint clips the loop's caps, since a bbox ignores stroke.
**Rejected.** A hosted DNS zone: a standing monthly charge for records any registrar serves free. ·
Leaving the machines named for the old product: the rename is cheapest while the archive is young. ·
The sheet's own one-colour fallback for a 16px tab: the full mark reads on both chromes, and a
second drawing is a fourth copy to keep in step. It stays documented, unminted, until something
needs one thread or one ink.

## The price archive
**Decision.** A daily job archives prices into Aurora DSQL; the app does not read it yet. It buys,
narrowly, the provider's DEALER QUOTE for every instrument — which exists nowhere else — and the
funds' NAV series: the provider's published history, imported as rows from the price file linked on
each offer page, and the daily quote after it until its client API ships. NBU fair value is a
different basis, already archived from each bond's issuance, and the two are NEVER merged. The
observation key is `(as_of, instrument_ref, basis, source)` and immutable: a wrong key is a
DROP/CREATE of a live archive. `as_of` is per source, the observer writes every day, `nav` is
archived and shown nowhere with `nav: 0` stored as NULL, an imported file is not archived but its
rows are under their own `parser_version`, and the provider's FX rate is stored nowhere at all.
**Why.** Writing every day keeps a zero delta distinguishable from an unknown one — a row missing on
a quiet day is byte-identical to a capture that never ran. Premises are kept forever and conclusions
never: an unparseable payload is stored anyway, and a rate recoverable by division is not a column.
**Rejected.** Alarming on a price that did not move: maintenance, a weekend and a holiday all trip
it, and a muted alarm is worse than none — so every capture check is structural, and none reads a
price. · Converting the archived `nav` to the basis the app values in: it looks observed, and is not.
· Archiving the price file beside its rows: the rows are the premise, the packaging is not.

## External sources
**Decision.** The list is closed: the provider's public asset feed, its price files, and the National
Bank — daily fair-value files and the official rate. The price files MAY be fetched automatically,
since they are linked from pages the site's own crawl rules allow, but the filename carries a content
hash, so the link is re-read from that page and no known URL is polled; disallowed paths stay
off-limits. SMIDA's open-data API is alive and is never fetched by our code, categorically;
`stockmarket.gov.ua` is dead.
**Why.** A blanket `Disallow` is final even where a statute licenses the use: the only way past it is
a rule reading "a named `Disallow` is final EXCEPT for documented APIs", inherited by every future
source with no bright line. And a false "this source is dead" is the costliest kind of note — it does
not fail loudly, it just stops anyone from looking again.
**Rejected.** Crawling a disallowed path while claiming to respect the site's rules: self-refuting. ·
Polling a known price-file URL: a new cut publishes at a different, unguessable address.

## Alerting
**Decision.** No SNS topic, and the alarms carry no `AlarmActions` at all. CloudWatch publishes every
alarm's state change to EventBridge regardless of actions, so delivery is EventBridge → AWS User
Notifications → the Console Mobile App, and an alarm with no action still alerts. The channel
measures itself: the capture emits its channel count on every run, healthy or not, and the number is
readable in the log and on the dashboard with no delivery at all.
**Why.** An alarm that cannot deliver is worse than none — it turns an unmonitored system into one
everybody believes is monitored, and every surrounding indicator reads healthy because nothing was
ever attempted. A liveness signal cannot arrive through the channel it is checking, so its primary
form is a value someone can look at.
**Rejected.** An SNS topic with an email subscription: three subscriptions across two topics died
within seconds of confirmation, invisibly — do not add the topic back. · Keeping the topic for a
second channel later: speculative, and SNS was never on the path that worked.

## Cloud target
**Decision.** The backend is Aurora DSQL with Lambda, IAM auth and EventBridge, and no VPC. At the
migration the DERIVATION MOVES TO THE SERVER: the API Lambda imports the same `src/core/` modules the
app uses — an import, never a port — and `/view` serves derived state with no parameters, while raw
rows stay on the export/import path. The environment split stops at USER data: one archive, one
capture, for every environment. Cross-browser beats offline, so there is no service worker and no PWA
shell. Any statement over the archive is bounded by a SQL date window, and completeness names both
bounds, the row limit first. The free tier on monthly actives is watched via the pool's user count.
**Why.** One implementation cannot be a second source of truth, which is the objection to server
derivation and the reason importing answers it. The archive is public reference data — a second copy
would be a second history to keep honest, and worthless anyway, since its value IS its accumulation.
**Rejected.** A service worker: the most browser-divergent layer in the plan, bought for an offline
the plan had already given up. · A SQL `LIMIT` in place of the window: the plan sorts above the
scan, and a sort consumes its whole input before it yields a row.

## Auth model
**Decision.** Cognito Essentials with managed login, behind an HTTP API JWT authorizer with no
Lambda in the path. Registration is an APPLICATION, not an open door: sign-up writes a row and
creates no identity, a super-admin approves, and approval is what creates the account and sends the
one invitation. Identity lives in the provider; status and role live in the application row, which
the API checks on every request. Three sign-in methods — password, social, passkey — one account per
email, by the pool's username attribute plus a pre-sign-up trigger that links a federated identity
only when the provider asserts the address verified. Onboarding is passkey-first; mail via SES.
Reads answer to THREE policies, never mixed in one response and never sharing a route: the price
archive is public and global, a user's own data is private and per-user, and the demo is public but
belongs to one owner — the seeded original is a single row set under an
`app_user` of its own — an identity that must never gain a provider account, since approving one
would create it — and the super-admin's ownership is the right to EDIT that row set rather than the
scope it is stored under. Until the play copy
exists an unauthenticated caller reads it and writes nothing.
Three surfaces stand outside the authorizer and check no application row: the archive's reads, the
demo's, and the sign-up application, which exists to create the very row the others are checked
against. Everything else is behind it.
**Why.** Nothing decided at token-issue time can revoke anything — the refresh token lasts years —
so authorization belongs to the API. An application costs a row where a sign-up costs a monthly
active user; and the built-in mail path suppresses bounced addresses with no way to clear them. The
demo lives under its own identity because the super-admin is the owner's own account: rows held
there would put a real portfolio behind a public route, and a flag distinguishing them would have to
be remembered in every predicate on every table, where one forgotten `WHERE` is the same failure. It
is the cheapest read there is — one portfolio, the same bytes for every visitor — so it caches
where a private read never may, which is exactly why the two may not share a URL: one edge would
hold both. Three things move a demo response and only one of them is a write: the day's
capture, the day's rate — which the API fetches and caches on its own clock, not the capture's — and
the super-admin editing the original. A counter that moves on writes alone cannot be the whole of
what validates it, and that is as true of a user's own read, which carries the same rate and the
same archive prices. And without a demo an application-gated door
is all a first visitor finds, at exactly the release that stops telling crawlers to stay away.
**Rejected.** SMS codes: two AWS review queues instead of one, a price orders above email for the
numbers that matter, and a code anyone can trigger spends the account's money from outside it. ·
Open registration by default: threat protection is a paid tier, so a public door has only quotas. ·
A demo a visitor may write to, this early: the copy that makes play safe has to answer where it
lives, what it is scoped to, whether it survives a sign-out and how a reset back to the original is
offered, and those are open on purpose. ·
No demo at all until they are answered: the absence would be discovered after the cutover rather
than chosen before it.

## User schema and deletes
**Decision.** DSQL refuses `USING btree`, refuses a `CREATE INDEX` that is not `ASYNC`, and has DDL
that is create-time-only — `NOT NULL`, a column's type, `UNIQUE` as a constraint, the primary key —
while a later constraint is `NOT VALID` for life; the constraints file carries the matrix. Foreign
keys are declared `ON DELETE RESTRICT`, never cascading, and deleting an asset is an APPLICATION
cascade: children before the parent, in batches, each batch its own transaction, every predicate
scoped by `user_id`. No transaction references another, so deleting one removes one row and nothing
else, and a provider account has no delete at all — it is one row per provider, and an empty one
costs nothing.
**Why.** The mutated-row ceiling is per transaction and one asset's saved prices can exceed it, so
batching is the only shape that works — a cascading key would not remove it, since cascaded rows
count against the same ceiling. Parent last makes a failure resumable, and the key exists for the
second writer, whose orphans are invisible to reads that run parent to child. Free cash sums across
accounts and the breakdown is a group, so a provider row with nothing in it adds nothing to either.
**Rejected.** Tombstones: nothing here has asked for undo or retention, and a `deleted_at` puts a
filter in every read that the first forgotten one turns into deleted data rendered as live. · A
self-referential key tying a tax row to the payout it settles: it describes a graph — chains, settled
rows that name no asset, a settler filed against another asset, and a cycle an update can build —
where the app wanted one sentence, and no derivation, screen or export ever asked which payout a tax
belonged to. Three rulings on its delete each answered the shape the round before had found; the
withholding is a field on the payout instead.

## Git model
**Decision.** `dev` integrates and deploys to dev.quirenote.com; `main` is production and moves only
by fast-forward, when a version is cut or on demand. Every change reaches `dev` on a
`<type>/<kebab-title>` branch and arrives by squash-merge, no diff too small — `dependabot/…` is the
one naming exception. No merge commits; rulesets hold both branches to linear history with no bypass
actors. Every `gh` call runs under the pinned `GH_CONFIG_DIR` and `gh auth switch` is forbidden.
Commits carry the owner's personal identity, and no git artifact carries AI attribution.
**Why.** "Small enough to skip the branch" drifts one commit at a time, and only in one direction; a
rule with no threshold cannot. Two accounts share the machine's keyring, so switching the global
default yanks another repository's session — `origin` is an SSH alias, so `git push` is unaffected.
**Rejected.** Promotion on a calendar: an arbitrary fence around the judgement a version bump
already makes. · Disabling the rebase button: it makes no merge commit, so it breaks no rule.

## Work tracking and documentation
**Decision.** GitHub Issues and the Project's `Status` field are the only task list; nothing in the
repository says what to do next. An issue is worked only from `Ready` — criteria a test or a browser
check can verify — one issue, one branch, closed by `Closes #N` in the squash-merge; milestones are
releases. This file is the decision record: current state, rewritten in place, `git log -p` the
history. Delete, never archive; a figure lives in a test or not at all; `CLAUDE.md` is rules.
**Why.** A task list in two places disagrees with itself, and the squash-merge already leaves the
commit-to-issue link a hosted tracker cannot. A figure written into prose goes stale in silence and
passes every gate; a test fails.
**Rejected.** Jira or ticket keys: one person, no board. · Markdown plan files: closed work every
session reads and skips. · One file per decision: current state assembled by hand from a chain. ·
Documentation ratchets: a guard bumped on every routine edit is a rehearsal for bumping it unread.

## Review, gates, tests
**Decision.** `/code-review` runs on the whole branch diff before every squash-merge, documentation
included; findings are fixed, or declined in the squash commit body with the reason. One round is
the norm; a second or third only for a fix that changed behaviour in core, persistence, `infra/` or
a workflow, or for a defect class. Three is the cap — a fourth means the branch is wrong, so a
root-cause comment on the issue comes first. The gates are lint, typecheck, test and `format:check`,
which skips Markdown on purpose, plus `tsc --noEmit -p infra` when `infra/` or a shared core file
changes. Tests are vitest over pure logic with `fake-indexeddb` for the repository's write surface,
and a nested checkout under `.claude/` stays invisible to git, eslint, vitest and prettier alike.
The skill frontmatter those three skip keeps one guard in `src/`: a description is a QUOTED YAML
scalar, because an unquoted one ends at the first ` #` and the harness never receives the rest.
**Why.** These documents carry figures, contracts and instructions no type checker reads — which is
where the evidence for reviewing them came from. A gate whose verdict moves with whether an agent
happens to be running is not a gate, and prettier re-pads every table cell it is let near.
**Rejected.** Exempting a one-line docs branch: "too small to review" drifts to the size of whatever
the author is holding. · A component or E2E harness: the browser check is the verification.

## Dependabot
**Decision.** Security only — alerts and automated security fixes as repository settings, and
deliberately no `.github/dependabot.yml`, the file that turns the dependency tree into routine
version PRs. The ALERT is the unit, not the PR: draining the PR list is not draining the advisories.
A Dependabot PR is merged locally under this repository's own authorship, `Closes #N` in the commit
body. Overrides live in `pnpm-workspace.yaml`. Three ecosystems exist — the root pnpm tree, `infra/`
under npm, and the pinned workflow actions, which have no manifest, so their fix is a hand edit.
**Why.** Every merge here costs a review, so version churn taxes the gate that protects the app and
buys no security. GitHub's squash preserves the PR author, so the button would land a bot-authored
commit on a branch that forbids the force-push it would take to undo.
**Rejected.** Routine version-update PRs: one person, one review per merge, no advisory closed. ·
The `pnpm` field in `package.json`: no longer read, and it fails as a warning that passes every gate.

## Deployment
**Decision.** Amplify Hosting as a manual-deploy app, fed by a GitHub Actions workflow that builds,
deploys and polls the job to completion; one workflow serves both branches and takes its environment
from the ref. Authentication is GitHub OIDC with no long-lived keys, and the deploy role
deliberately lacks the permission to change the app — the SPA 200 rewrite and the cache headers stay
console-managed, and CI cannot touch hosting configuration. Cloudflare sits in front: the apex,
`www` and `dev` are proxied; the certificate-validation CNAME and the mail records never are.
**Why.** A git-connected Amplify app has no build-status badge, and an Actions badge is real
deployment status when the workflow performs the deploy. Proxying keeps repeat traffic off origin
egress, the one cost line a flood can move — and a record left grey publishes the address its
proxied neighbour hides.
**Rejected.** Console drag-and-drop: unautomatable on an actively developed project. · A proxied
validation record: the answer becomes the edge's own address and the certificate stops renewing.

## Design pipeline
**Decision.** The reference is `design/Investment Tracker.dc.html`, whose styles are inline in the
markup — read it for any exact size or spacing, and ignore `support.js` and the `_ds/` references,
which are prototype runtime only. COLOUR IS THE ONE THING IT NO LONGER OWNS:
`design/extensions/parchment-5h.dc.html` is the colour reference for BOTH themes and supersedes
every colour in every merged drawing, geometry and copy in none of them. A merged drawing is
immutable; a new surface gets its own file under `design/extensions/`. The pipeline is brief → a
separate design session that turns it into an extension → the UI task, which may not start before
its extension merges. A merged drawing
wins a layout dispute, the brief wins copy and behaviour, and colours come only from theme tokens.
3 : 1 (WCAG 1.4.11) is the bar a boundary that identifies a component or its state is HELD to, in
both themes — not a claim that every surface clears it. A region's decorative edge and furniture that
identifies nothing fall outside the bar, and anything still under it carries its reason or its open
issue where the value is declared, so the shortfall is recorded at the value rather than in prose —
or, where a SHARED RANK clears the bar and one surface reading it does not, at that surface. A
boundary token is minted only when it would hold a value, or a record, that the rank does not — and a
name left holding the rank's own value in BOTH themes, once a contrast ruling has moved it there, is
one step drawn twice and is retired into the rank rather than kept as an alias.
Dark takes its elevation from the surface step and zeroes its shadows bar one, so a component's
stroke there is usually the whole boundary — the fill step carries almost none of it. Every colour
move goes through a design session, in either theme — the asymmetry that let a dark-only repair ship
as a plain fix was a property of the reference, not of the work, and it ended when one extension
started supplying both planes.
**Why.** The drawing owns the RESULT and the code owns the mechanism: a static sheet has no
intermediate widths, no viewport height and no second language, so where it is silent the code
decides — and says where it decided. "It renders the same" is a claim to check at every width. The
master reference drew light only, so for as long as it was the colour source a light value moving
superseded a drawing and a dark one superseded nothing; the parchment extension draws both, so a
move in either theme now supersedes it and needs the same session to authorise it.
**Rejected.** Editing a merged drawing to match a later ruling: it destroys the only record of what
changed. · A hex picked inside a component: a token family is minted by a design session or not at all.
· Exempting a boundary because its surface is not a field: 1.4.11 binds the component, not the class
of token it happens to read. A region's decorative edge is what falls outside it.

## Measurement
**Decision.** Geometry and colour are read through the chrome-devtools MCP, never Playwright's
headless Chromium, where lengths are honest and border and outline THICKNESSES are not. Drop a
calibration probe before recording any figure, disable transitions before reading anything
animatable, check `document.visibilityState` before believing a motion reading, and reload rather
than flip `data-theme` or trust CSS after a burst of hot reloads. Read the rendered box, never the
class list. The dev server's port is pinned in `vite.config.ts` with `strictPort`, so a
conflict refuses to boot instead of drifting to a neighbour — but a pinned port only says where
THIS checkout binds, so confirm the `Quirenote` title before trusting whatever answers there.
**Why.** A wrong instrument puts wrong figures through review with full confidence, and the reviewer
has nothing to check them against but the arithmetic of the classes. A background tab freezes
transitions and never fires `animationend`, which reads as "the animation is broken". When a reading
disagrees with the arithmetic of its own classes, the instrument is wrong until proven otherwise.
**Rejected.** Sampling a property mid-transition: a focus ring answers differently depending on when
the sample lands. · A live theme flip instead of a reload: utilities resolve against the old state.
· A dev server free to pick its own port: which instance produced a figure then becomes a guess,
and the guess is only caught when the figure is wrong.

## Interaction rules
**Decision.** Every interaction animates, soft and fluid; nothing pops or snaps. Transitions inherit
one soft curve at 220ms — 150 for hover, 300–400 for reveals and layout shifts — every pressable
takes a small active scale, and `prefers-reduced-motion: reduce` is a global kill-switch. A click
target never moves under a hovering pointer. A destructive clear is armed by typing the dataset's
name, and offers a backup first. Reminders derive their ids and write nothing, so a dismissal expires
when its occurrence stops being produced. The theme is ONE list of values redefined per theme,
stamped as an answer, and BOTH controls that write it — the Appearance card's and the sidebar's —
write that one field, so neither has a value of its own to fall out of step. A segmented control's
track takes its plane's FOREGROUND and its chip the background — `ink` and `card` everywhere but
the sidebar, whose two footer-band tracks run the active route's own tint, with a solid accent
thumb and no edge: a track is identified by its thumb, and a tint on a band needs no boundary of
its own. The sidebar's ACTIVE ROUTE is a tint plus a 2px inset left indicator, never a fill, so a
state is never colour alone; a solid fill therefore means a selected segment there and nothing
else. COLOUR IS RATIONED 60 / 30 / 10: the
canvas and its surfaces are the sixty, text and borders and the chart series the thirty, and the
accent is the ten — the mark, ONE main CTA per screen, the active route, the chart's line and
cursor, and the focus ring. So the ACCENT fill is what a screen gets only once, and a second action
beside it takes an outline or a ghost; the `neg` fill is a separate emphasis, reserved for a
dialog's armed action, and a segmented track's `ink` is a plane's foreground rather than an accent.
The ring reads `focus`, an alias of the accent in both themes, bound by 1.4.11 at 3 : 1 rather than
1.4.3's 4.5; a filled segmented track keeps its own ring in the plane's background, because the
accent on that fill does not clear the bar. Done but for the cursor, which one object shares across
four charts — #112. In light the accent and `warn` are a blue channel apart and identical in
LUMINANCE, so a caution separates from the brand by chroma alone and by no contrast reading; the
second cue that would fix it is a brief, not a value — #111. `muted` is derived against its worst
surface.
Gain and loss belong to DELTAS: an informational chip reads `info`, a text selection reads
`selection`, and neither borrows `pos`. Partly done — the reminder strip, the fresh-quote chip, the
`/` progress pill and the NBU rate have moved; eight surfaces have not, and #97 carries the two
groups that need an answer rather than a swap.
**Why.** A dismissal on `animationend` never lands in a throttled tab, so it commits on a timer. A
`card` chip reads as raised in one theme and as a recess in the other; a filled track inverts. WCAG
1.4.1 does not accept a state said in colour alone, and the rail's old light lozenge said it that
way — so the indicator is the half that survives a colour-blind reading, and it is what frees a
solid fill to mean something else on the footer band, which a rule and a plane change separate from
the list of routes above it. A green highlight on a
reminder, a fresh quote or a run of selected text says "up" about something that has no direction.
**Rejected.** A motion library: the theme tokens and the utilities already in the tree carry it. ·
Resolving `system` at write time: it would decay into whatever the system was when the user looked.
· Giving the currency toggle the general `ink` track once its exception lapsed: a near-black slab
inside a parchment wall, against the 60/30/10 the palette is built on.

## Forms and layout
**Decision.** `/` and `/transactions` are composed the way `/payouts` is — main's own width, a
`1.6fr 1fr` grid, one column when it collapses, `/transactions` mirrored so the ledger leads. Inside
a grid track the track is the bound, so a card carries no width cap; the form's cap survives only in
the stacked column, where a full-row form reads as a settings page. The asset form derives more than
it asks — the provider kind follows the yield type, units come from the ledger, the reinvest-policy
control is gone — and a deposit is a portfolio-level row that names no asset. A transaction names no
source of funds: the field came across from the spreadsheet this tracker replaced, no derivation
reads it, and in every row that exists the type and the asset already carry it — while the two
values that carried more named holdings, which no CHECK may do. Nothing replaces it. The ОВДП code takes
four letters or digits, derived from the ref or the name as a suggestion that stops the instant the
user types; naming a bond from the provider list fills its maturity, next coupon, cadence and rate.
A payout also asks what was WITHHELD from it, in the two-column slot the units take on the other side
of the amount — one layout rule with a second occupant, so «Джерело коштів» drops to its own row
exactly as units already make it drop. The amount changes column with the type there as it already
does between a buy and a deposit; what the placement settles is which field it is paired with. Every type asks for a NOTE, up to
**100 characters**, absent rather than empty and refused by a sentence rather than capped by the
control; the ledger row draws it as a second line, and a row with no note draws nothing at all.
**Why.** The note's cap is a DRAWN number rather than a stored one: at 360 the ledger row is 280 px
and its label already truncates, so a note cannot join that line, and on a second line a hundred
characters is three lines and 48 px — taking a bordered record from 61 to 111, near double, where a
fourth line would read as a paragraph hanging under it. It is counted in characters and not lines because
`transaction_note_ck` has to enforce the same bound and SQL cannot check a line count; the number and
the layout are one decision, since reserving the ✕ column on that line costs a fourth line and moves
the cap. Those four are facts about the instrument, not the user's data, so overwriting them is
right where overwriting a typed code is not. A screen that is locally optimal and globally foreign
is the worse outcome, and a field that is not read where it is filled cannot be fixed by making it
easier to fill.
**Rejected.** Six characters in the code: it fits only by widening the circle into a pill. · A
control with no answer of its own: it can only agree with what it sits beside, or contradict it. · A
`textarea` for the note: a hundred characters is a line, not a paragraph, and a control at any height
but 36 is invisible to the structural walk that holds every field edge — the guard would silently
stop covering the newest field on the screen. · A character counter beside it, or a `maxLength` that
stops the typing: both are furniture for a bound the field can simply refuse at, and a cap the
control enforces in silence teaches nothing about why it is 100. ·
Narrowing the source of funds to own-versus-accrued rather than dropping it: neither value names a
holding, so a CHECK would be legal, but nothing reads it, the type answers it in every row that
exists, and a purchase funded from accrued income is honestly a reinvest row — which the own-capital
denominator already excludes. Re-adding it is a nullable column and a field.

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
