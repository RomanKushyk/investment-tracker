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
reading the config back. Pure modules return keys and tokens, never assembled prose. New code calls
`repository.ts`, never `db.ts`. A dependency is a decision, and it is recorded under the topic it
serves rather than in a register of its own. The seam test against `infra/schema/user.ts` sits in
`infra/src/`, so the edge between them runs one way.
**Why.** The domain layer is the part a move to a server does not touch, and the repository is the
seam it replaces. A `package.json` is a boundary and relative imports were crossing it, which is
what a package removes; it was taken while the shared surface was small rather than after server
derivation widened it. Two programs compiling one source is the property worth paying for — it is
what catches a browser-only type before a backend build does, and it is the reason no compiled
artifact sits between them.
**Rejected.** A component reaching for `db.ts`: it bypasses the one surface the migration swaps. ·
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
version; import validates fully, shows a diff, then replaces in one transaction — a key the file
omits is REMOVED — after a safety backup that cannot be cancelled. CSV is export-only and writes
data rather than formulas: a cell beginning `=` or `@` is passed through as typed. THE BACKUP WRITES
THE MODEL'S SHAPE, NOT THE STORE'S: `buildBackup` projects every row onto its schema's keys, so a key
the model retired, still sitting in IndexedDB, never reaches the file and needs no migration. A
VALUE the reader refuses — a moving row with no count, the retired `tax` type — has nothing to
project and still fails the envelope; that store cannot back itself up, and its exit is the CSV
export, which validates nothing, then Settings → Danger zone, erase on live and reseed on demo.
**Why.** Replace-never-merge is why the diff exists: yesterday's backup silently dropping today's
work is what the dialog must state before the press. The envelope's version tracks what a build
ACCEPTS, not how long ago it shipped, so two live builds cannot share a number and disagree about
fields — which is why a projecting writer bumps nothing. A strict reader needs a strict writer:
spread, the store's leftovers rode into the file and the file's own parser refused it, shutting
the download, both destructive dialogs' backup and the import's safety backup at once. The export
is terminal, the store the only truth and the file there to be restored into it, so nothing
downstream waits for a field this build has never heard of.
**Rejected.** A library's own dump format: the envelope has to be app-owned, human-readable and
domain-validated. · Preserving unknown keys through the round trip, as a relay does: it becomes
right the day the backup carries data between two builds as a sync or merge channel, where a
projecting writer would destroy the other build's fields.

## Derived figures and the seed
**Decision.** Every portfolio figure is derived from stored data and none is hard-coded; value at a
date is `units(a, D) × coalesce(user_price(a, D), archive(a, D))`, so nothing is prefilled because
nothing is written. Automation stays suggest-only wherever the app still decides: the user's Save is
the sole write path. A hand-entered value is MARKED; an archive one is not.
**Why.** The seed exists so the first run reproduces the reference, and it reconciles by
construction rather than through exclusion rules — which is why its pinned figures MAY move when the
ledger model requires it. `coalesce` is silent, so without the mark an observed value and a
published one read identically.
**Rejected.** A minimal purpose-built fixture: checkpoints that move with the fixture cannot catch a
regression.

## Metric families and windows
**Decision.** Two metric families, both permanent and never conflated: capital gain and total
return. The annualized column divides every row by ONE span, the selected window's, and a row whose
holding falls well short of it renders muted; per-asset XIRR is the money-weighted column, and its
annualization mark tests the WINDOW's length, not the asset's. A window's opening position is valued
the day BEFORE it opens. Units are `Σ quantity deltas` over the ledger, never a stored total; free
cash AT A DATE is the ledger's signed sum up to it, a payout contributing
`amount − coalesce(tax_withheld, 0)`; a coupon derives from its RATE. A withholding is a FIELD on
the payout it was taken from, never a row of its own. Nothing bounds free cash, so a share is taken
only of a USABLE total, positive and finite, only while free cash is at or above zero, and only of a
value at or above zero; otherwise it is ABSENT and renders «—» with the accessible name "cannot be computed", and the rebalance plan
proposes nothing. Free cash below zero or unreadable carries a warn-tint warning on every screen
that shows a share. Every display formatter renders a non-finite figure as «—», whatever produced
it; a field's own value stays the field boundary's.
**Why.** The day before is the only boundary at which each transaction counts exactly once, and it
makes the full history collapse onto its unwindowed twin. A stored coupon amount goes stale on the
next purchase where a rate does not; tax runs the other way, rates changing, so a computed
withholding eventually lies where a recorded one cannot. The withholding is READ off the payout
rather than skipped, which is two columns of one row and not an exclusion returning by another
door; without it free cash overstates by every hryvnia ever withheld, and per-asset XIRR silently
turns from net to gross. A share off a negative total reads in the hundreds of percent, a top-up
off one is a negative buy, and `Intl` prints `NaN` as a word — each keeps rendering and keeps being
wrong, where an absent figure says it cannot be computed. Negative cash that leaves the total
positive still shrinks it: the shares sum past 100 %, a deep enough shortfall puts one past it
alone, and the plan trims off the shortfall. The «—» alone is silent about the cause; the ledger is
the cause nothing else can see, so a short ledger is named.
**Rejected.** Per-asset annualization: a fixed-coupon bond would beat its own contract, and XIRR is
already the per-asset answer. · A stored balance beside the derived one: no screen ever let anyone
enter the observation, so the second source of truth could only ever carry the previous figure
forward, and a chip comparing the two reported a gap neither of them could close.

## Language, numbers, fonts
**Decision.** Ukrainian is the default language, English the second, and the number grammar
separates completely per language: Ukrainian groups on whitespace and reads both `,` and `.` as the
decimal, English keeps the comma as grouping, and when both marks appear the last one is the
decimal. A currency token beside the number is dropped before the grammar reads it; a token alone or
any other letter is not, so `12abc` stays refused. The ₴/$ toggle converts the DISPLAY of headline
KPIs and the sidebar capital only; tables stay in ₴, and dates are `dd.MM.yyyy`. Faces: Manrope for
headings, buttons and KPI numbers, JetBrains Mono for body and tables, and `body` sets
`font-variant-numeric: tabular-nums`. A field holding an unsaved number STORES A LANGUAGE-FREE
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
every radius where the shape system put it. Exactly one branch mounts per shell.
**Why.** Growing controls to 44 would rewrite five radii and a concentric chain as a side effect of
an accessibility fix. A control with no drawn box gets real padding instead, an overlay reaching
past its own control handing the tap to the neighbour.
**Rejected.** A theme control in the rail: one glyph cannot show the two states it is not in, where
currency's box shows the state you are in.

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
**Decision.** A daily job archives prices into Aurora DSQL; the app does not read it yet. It buys
the provider's DEALER QUOTE, which exists nowhere else, and the funds' NAV series. NBU fair value is
a different basis, archived from each bond's issuance, and the two are NEVER merged. The observation
key is `(as_of, instrument_ref, basis, source)` and immutable: a wrong key is a DROP/CREATE of a
live archive. `as_of` is per source, the observer writes every day, an imported file is not archived
but its rows are, and the provider's FX rate is stored nowhere at all.
**Why.** Writing every day keeps a zero delta distinct from an unknown one — a row missing on a
quiet day is byte-identical to a capture that never ran. Premises are kept forever, conclusions
never.
**Rejected.** Alarming on a price that did not move: maintenance, a weekend and a holiday all trip
it, so every capture check is structural and none reads a price. · Archiving the price file beside
its rows: the rows are the premise, the packaging is not.

## External sources
**Decision.** The list is closed: the provider's public asset feed, its price files, and the
National Bank — daily fair-value files and the official rate. The price files MAY be fetched, being
linked from pages the crawl rules allow, but the filename carries a content hash, so the link is
re-read from that page and no URL is polled. SMIDA's open-data API is alive and is never fetched by
our code, categorically; `stockmarket.gov.ua` is dead.
**Why.** A blanket `Disallow` is final even where a statute licenses the use: any exception is a
rule every future source inherits with no bright line. And a false "this source is dead" does not
fail loudly, it stops anyone looking again.
**Rejected.** Crawling a disallowed path while claiming to respect the site's rules: self-refuting.

## Alerting
**Decision.** No SNS topic, and the alarms carry no `AlarmActions` at all: CloudWatch publishes
every state change to EventBridge regardless of actions, so delivery is EventBridge → AWS User
Notifications → the Console Mobile App, and an alarm with no action still alerts. The channel
measures itself: the capture emits its channel count on every run, healthy or not, readable with no
delivery at all. Backup freshness and the free tier on monthly actives take the same shape, each
watched by the stack that owns it. A count that could not be read THROWS rather than publishing
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
row limit first.
**Why.** One implementation cannot be a second source of truth, which is the objection to server
derivation and the reason importing answers it. The archive is public reference data, so a second
copy would be a second history to keep honest and worthless anyway, its value being its
accumulation; user data is the opposite on both counts.
**Rejected.** A service worker: the most browser-divergent layer in the plan, bought for an offline
the plan had already given up.

## Auth model
**Decision.** Cognito Essentials with managed login behind a JWT authorizer, and ONE POOL PER
ENVIRONMENT — a shared one would spend a production monthly active user on every dev sign-in and put
dev identities in the table a real portfolio is keyed by. The passkey relying party is the
environment's own APEX: an RP ID cannot change afterwards without stranding every credential
registered against it, and `reference/COGNITO-POOL-PARAMS.md` carries its cost. THE REFRESH TOKEN IS
BOUNDED AND ROTATES, which answers the three refresh requirements the browser BCP singles out and no
more: that section incorporates RFC 9700, whose replay question is open against this pool in that
same file. Cognito has no inactivity expiry, so the idle timeout is the session cookie's `Max-Age`,
a UX bound and not a security boundary. Registration is an APPLICATION, not an open door — threat
protection is a paid tier, so a public door has only quotas: sign-up writes the row that carries
status and role, and approval mints the identity — so approve is a Cognito write and a row
REPLACEMENT, a DSQL primary key being immutable.
**Why.** Nothing decided at token-issue time can revoke anything, at any lifetime, so authorization
belongs to the API, read from that row on every request.
**Rejected.** As the relying party, a Cognito prefix domain — a later move to the custom one strips
the passkeys registered against it — or the auth host, which would scope every credential to managed
login alone. · A post-confirmation trigger creating the row: AWS does not invoke it for an
admin-created or a federated user, the two routes into the pool that matter. ·
Cognito groups as the role: status and role are application state, decided and stored by the
approval this system performs, so a group is a second place for them to live and the two can
disagree; freshness is the lesser argument, a group riding on tokens that last an hour. · Letting an
open-registration sign-in approve its own earlier application: convenience, and a way to overturn a
rejection by signing up again.

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
THAT RESERVE ALREADY SPENT, naming it, rather than being killed at a ceiling already set to the
service maximum. That bounds when a statement STARTS and not how long it runs: one wait that
overruns alone is still a kill. THE CODE IS LIVE BEFORE THE SCHEMA, the SQL riding in the deployed
bundle, so every migration MUST BE WRITTEN expand/contract-compatible with the code already running
— the ordering imposes that on each migration's author, and nothing in the pipeline can check it.
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
check can verify — one issue, one branch, closed by `Closes #N`; milestones are releases. Delete,
never archive; a figure lives in a test or not at all; `CLAUDE.md` is rules.
**Why.** A task list in two places disagrees with itself. A figure written into prose goes stale in
silence and passes every gate; a test fails.
**Rejected.** Jira or ticket keys: one person, no board. · Documentation ratchets: a guard bumped on
every routine edit is a rehearsal for bumping it unread.

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
template text.
**Why.** These documents carry figures, contracts and instructions no type checker reads, and a gate
whose verdict moves with whether an agent happens to be running is not a gate. `toJS()` discards an
unknown tag and keeps the scalar, so a `!GetAtt` and a literal spelt the same way are one value to a
parsed template.
**Rejected.** Exempting a one-line docs branch: "too small to review" drifts to the size of whatever
the author is holding.

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
OIDC deploy role deliberately cannot change the app: the SPA 200 rewrite and the cache headers stay
console-managed. Cloudflare sits in front: the apex, `www` and `dev` are proxied; the
certificate-validation CNAME and the mail records never are.
**Why.** A git-connected Amplify app has no build-status badge, and an Actions badge is real
deployment status when the workflow performs the deploy. Proxying keeps repeat traffic off origin
egress, the one cost line a flood can move — and a record left grey publishes the address its
proxied neighbour hides. The reference page is a build step rather than a flag because a flag is how
this pattern fails: a disable switch that turns out to be dead code and ships the page anyway. A
step that does not run cannot.
**Rejected.** A proxied validation record: the answer becomes the edge's own address and the
certificate stops renewing.

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
