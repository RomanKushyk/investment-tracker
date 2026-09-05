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
commit that adds it. The JSON backup envelope is `formatVersion 5`, refusing a newer, an older and
an unreadable version with three distinct sentences; import validates fully, shows a diff, then
replaces in one transaction — a key the file omits is REMOVED — after a safety backup that cannot be
cancelled. Export re-reads its own output and refuses a file it could not read back. CSV is
export-only.
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
ACT/365, and a zero denominator is «—».
**Why.** The day before is the only boundary at which each transaction counts exactly once, and it
makes the full history collapse onto its unwindowed twin. One shared span keeps rows comparable —
the first thing a reader of a table uses — and the grey mark is what makes it honest. A stored
coupon amount goes stale on the next purchase; a rate does not.
**Rejected.** Per-asset annualization: a fixed-coupon bond would beat its own contract, and XIRR is
already the per-asset answer. · Re-deriving a schedule the walkers already answer: two readings of
one schedule is the failure, not the arithmetic in either.

## Language, numbers, fonts
**Decision.** Ukrainian is the default language, English the second; formatting and the number
grammar separate completely per language — Ukrainian groups on whitespace and reads both `,` and
`.` as the decimal, English keeps the comma as grouping, and when both marks appear the last one
is the decimal. A currency token beside the number (`₴`, `$`, `грн`, `грн.`, `UAH`, `USD`) is
dropped before the grammar reads it; a token alone or any other letter is not, so `12abc` stays
refused. Ukrainian tables and inputs read `68 702,10`, English prose and KPIs `₴68,629.36`, dates
`dd.MM.yyyy`. The ₴/$ toggle converts the DISPLAY of headline KPIs and the sidebar capital only;
tables stay in ₴. Faces: IBM Plex Sans for headings, buttons and KPI numbers, JetBrains Mono for
body and tables.
**Why.** The reference's brand pair carries no Cyrillic at all, so the app would have dropped to a
system fallback on every screen the moment the default language applied. The replacement keeps
the same mono advance, so no width moves, and its display face has tabular figures by default.
**Rejected.** One locale-blind parser: what a field SHOWS must be what its parser READS. · The
keyboard layout as the signal: no browser reports a numeric convention.

## Shape system
**Decision.** Nothing in the app is a capsule. A standalone control takes
`round(min(w, h) × 0.26)` off its SHORT side; a box nested against a parent's corner takes
`outer = inner + gap`, the gap being padding plus any border. A segmented control is both at once —
segment proportional, track concentric. Surfaces keep the reference's 16 / 20 / 24, and a full-bleed
bar takes square corners. Only asset avatars, colour dots and the decorative blob stay round; the
mark's own arc is drawn, not a radius. Measure the RENDERED height — `text-[11px]` sets a font size,
not a line height.
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
rounder than any the app has. The gutter is the ScrollArea ROOT's padding, both inline sides, fixed.
Ask for both orientations on content you did not author — the axis you omit is `overflow: hidden`,
not merely unscrollable — and give a scrolling band `min-h-0` AND `min-w-0`. A dialog is three bands
and only the middle one scrolls. `Select` keeps the styled native bar.
**Why.** A square-cornered platform track cuts a rounded panel's corner, and takes layout width on
one OS and none on another, so a screen reflows differently per platform. Padding on the scrolling
element is INSIDE the scroll box: away from the ends of the range, content slides under the rail.
**Rejected.** Insets concentric with the parent's corner: invisible on a shape this thin, and the
real estate is not free. · Gating the gutter on whether a rail is showing: the panel then flips
between symmetric and lopsided as its content grows.

## Two shells, one breakpoint
**Decision.** Two layouts and one switch — `md`, 768px. Below it the sidebar is an off-canvas 280px
drawer, a Radix `Dialog`, so the focus trap, Escape, scroll lock and focus return are the library's,
and the header carries the capital; at and above it the 244px rail sits in flow beside a collapse
control that hands the header the same job. The breakpoint is written twice — in the markup and in
`useIsDesktop` — and the two must stay one number. 44 × 44 is HIT AREA, never geometry: a transparent
centred overlay grows the pressable region and leaves every radius where the shape system put it.
Exactly one branch mounts per shell.
**Why.** Growing controls to 44 would rewrite five radii and a concentric chain as a side effect of
an accessibility fix. A control with no drawn box gets real padding instead, because an overlay
reaching past its own control hands the tap to the neighbour — and a text field can never take one,
since an `<input>` renders no pseudo-element at all.
**Rejected.** A third geometry: the old narrow rail has no job once a drawer exists. · Rendering both
table forms and hiding one: the phone still builds and derives the table it cannot show.

## Brand
**Decision.** The product is Quirenote and the domain is `quirenote.com`; the rename went all the way
through the infrastructure, so no identifier anything addresses still carries the old name. The logo
is the Q-arrow mark — an open arc whose tail is a sand arrow — and it lives in THREE files that must
change together: `src/app/Sidebar.tsx`, `public/favicon.svg` and `public/apple-touch-icon.png`.
Nothing sits behind it — the mark IS the circle — and its brand token is one value in both themes.
**Why.** Every precise word was taken in every zone, so the name is a compound, and the collision
audit killed better candidates than the availability sweep did — half the neighbours of a mined
ending are financial. The mark's only plane is dark in BOTH themes, so a per-theme pair would put
the light value on the lighter plate, where it fails contrast.
**Rejected.** A hosted DNS zone: a standing monthly charge for records any registrar serves free. ·
Leaving the machines named for the old product: the rename is cheapest while the archive is young.

## The price archive
**Decision.** A daily job archives prices into Aurora DSQL; the app does not read it yet. It buys,
narrowly, the provider's DEALER QUOTE for every instrument — which exists nowhere else — plus fund
prices after its last published file until its client API ships. NBU fair value is a different
basis, already archived from each bond's issuance, and the two are NEVER merged. The observation key
is `(as_of, instrument_ref, basis, source)` and immutable: a wrong key is a DROP/CREATE of a live
archive. `as_of` is per source, the observer writes every day, `nav` is archived and shown nowhere
with `nav: 0` stored as NULL, and the provider's FX rate is stored nowhere at all.
**Why.** Writing every day keeps a zero delta distinguishable from an unknown one — a row missing on
a quiet day is byte-identical to a capture that never ran. Premises are kept forever and conclusions
never: an unparseable payload is stored anyway, and a rate recoverable by division is not a column.
**Rejected.** Alarming on a price that did not move: maintenance, a weekend and a holiday all trip
it, and a muted alarm is worse than none — so every capture check is structural, and none reads a
price. · Converting the archived `nav` to the basis the app values in: it looks observed, and is not.

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
**Why.** Nothing decided at token-issue time can revoke anything — the refresh token lasts years —
so authorization belongs to the API. An application costs a row where a sign-up costs a monthly
active user; and the built-in mail path suppresses bounced addresses with no way to clear them.
**Rejected.** SMS codes: two AWS review queues instead of one, a price orders above email for the
numbers that matter, and a code anyone can trigger spends the account's money from outside it. ·
Open registration by default: threat protection is a paid tier, so a public door has only quotas.

## User schema and deletes
**Decision.** DSQL refuses `USING btree`, refuses a `CREATE INDEX` that is not `ASYNC`, and has DDL
that is create-time-only — `NOT NULL`, a column's type, `UNIQUE` as a constraint, the primary key —
while a later constraint is `NOT VALID` for life; the constraints file carries the matrix. Foreign
keys are declared `ON DELETE RESTRICT`, never cascading, and deleting an asset is an APPLICATION
cascade whose FIRST step NULLs every settlement link pointing into it — an `UPDATE`, never a delete
— then children before the parent, in batches, each batch its own transaction, every predicate
scoped by `user_id`. Deleting a transaction or an account stays open; an issue holds the question.
**Why.** The mutated-row ceiling is per transaction and one asset's saved prices can exceed it, so
batching is the only shape that works — a cascading key would not remove it, since cascaded rows
count against the same ceiling. Parent last makes a failure resumable, and the key exists for the
second writer, whose orphans are invisible to reads that run parent to child.
**Rejected.** Tombstones: nothing here has asked for undo or retention, and a `deleted_at` puts a
filter in every read that the first forgotten one turns into deleted data rendered as live. ·
Deleting settling rows instead of nulling their links: it strands chains and takes another asset's row.

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
issue where the value is declared, so the shortfall is recorded at the value rather than in prose.
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
stamped as an answer. A segmented control's track takes its plane's FOREGROUND and its chip the
background — `ink` and `card` everywhere but the sidebar, whose currency toggle is a ruled exception:
a light lozenge there already means a selected route. `muted` is derived against its worst surface.
Gain and loss belong to DELTAS: an informational chip reads `info`, a text selection reads
`selection`, and neither borrows `pos`. Partly done — the reminder strip, the fresh-quote chip, the
`/` progress pill and the NBU rate have moved; eight surfaces have not, and #97 carries the two
groups that need an answer rather than a swap.
**Why.** A dismissal on `animationend` never lands in a throttled tab, so it commits on a timer. A
`card` chip reads as raised in one theme and as a recess in the other; a filled track inverts. A
green highlight on a reminder, a fresh quote or a run of selected text says "up" about something
that has no direction.
**Rejected.** A motion library: the theme tokens and the utilities already in the tree carry it. ·
Resolving `system` at write time: it would decay into whatever the system was when the user looked.

## Forms and layout
**Decision.** `/` and `/transactions` are composed the way `/payouts` is — main's own width, a
`1.6fr 1fr` grid, one column when it collapses, `/transactions` mirrored so the ledger leads. Inside
a grid track the track is the bound, so a card carries no width cap; the form's cap survives only in
the stacked column, where a full-row form reads as a settings page. The asset form derives more than
it asks — the provider kind follows the yield type, units come from the ledger, the reinvest-policy
control is gone — and a deposit is a portfolio-level row that names no asset. The ОВДП code takes
four letters or digits, derived from the ref or the name as a suggestion that stops the instant the
user types; naming a bond from the provider list fills its maturity, next coupon, cadence and rate.
**Why.** Those four are facts about the instrument, not the user's data, so overwriting them is
right where overwriting a typed code is not. A screen that is locally optimal and globally foreign
is the worse outcome, and a field that is not read where it is filled cannot be fixed by making it
easier to fill.
**Rejected.** Six characters in the code: it fits only by widening the circle into a pill. · A
control with no answer of its own: it can only agree with what it sits beside, or contradict it.

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
