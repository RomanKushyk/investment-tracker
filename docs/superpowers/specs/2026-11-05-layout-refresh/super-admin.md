# The super-admin pages (wave 10)

The super-admin has two pages: «Архів цін» (/admin/archive, coded) and «Користувачі» (/admin/users, drawn in the record, not coded). Both are still in the old look. Most of this wave applies what is signed: glass cards, the wave-6 tables, wave-8 dialogs and sheets, the wave-5 role dock. Two choices are new: the status indicator and the archive's per-source figures.

## Renders

«Архів цін» is the live page with the archive's diagnosis and runs. The «Надсилається» row is a real start on its way, and the figures follow a real «Прочитати архів» press. Its confirmation is the live ConfirmStart (the import's). «Користувачі» is composed from the record’s anatomy and copy for it in the app's own classes; its confirmations are the app's live AlertDialog with the approve copy written in. The sidebar is the admin's own, in the wave-2/4 glass. Nothing scrolls sideways in any frame, at either width, in either theme.

At 1440, dark: the archive not read and read, the run log, the repair confirmation, «Користувачі» on «Заявки», the approve confirmation and a refusal.

![/admin/archive before «Прочитати архів», 1440, dark](renders/w10f-unread-1440-dark.jpeg)

![/admin/archive with the per-source figures read, 1440, dark](renders/w10f-read-1440-dark.jpeg)

![/admin/archive run log in four states and a start on its way, 1440, dark](renders/w10f-log-1440-dark.jpeg)

![/admin/archive repair confirmation, 1440, dark](renders/w10f-confirm-1440-dark.jpeg)

![/admin/users on «Заявки», 1440, dark](renders/w10f-users-1440-dark.jpeg)

![/admin/users approve confirmation, 1440, dark](renders/w10f-approve-1440-dark.jpeg)

![/admin/users refusal, 409 unclaimed_identity, 1440, dark](renders/w10f-refusal-1440-dark.jpeg)

At 1440, light: the same seven frames.

![/admin/archive before «Прочитати архів», 1440, light](renders/w10f-unread-1440-light.jpeg)

![/admin/archive with the per-source figures read, 1440, light](renders/w10f-read-1440-light.jpeg)

![/admin/archive run log in four states and a start on its way, 1440, light](renders/w10f-log-1440-light.jpeg)

![/admin/archive repair confirmation, 1440, light](renders/w10f-confirm-1440-light.jpeg)

![/admin/users on «Заявки», 1440, light](renders/w10f-users-1440-light.jpeg)

![/admin/users approve confirmation, 1440, light](renders/w10f-approve-1440-light.jpeg)

![/admin/users refusal, 409 unclaimed_identity, 1440, light](renders/w10f-refusal-1440-light.jpeg)

At 360, dark: the same seven frames.

![/admin/archive before «Прочитати архів», 360, dark](renders/w10f-unread-360-dark.jpeg)

![/admin/archive with the per-source figures read, 360, dark](renders/w10f-read-360-dark.jpeg)

![/admin/archive run log in four states and a start on its way, 360, dark](renders/w10f-log-360-dark.jpeg)

![/admin/archive repair confirmation as a sheet, 360, dark](renders/w10f-confirm-360-dark.jpeg)

![/admin/users on «Заявки», 360, dark](renders/w10f-users-360-dark.jpeg)

![/admin/users approve confirmation as a sheet, 360, dark](renders/w10f-approve-360-dark.jpeg)

![/admin/users refusal, 409 unclaimed_identity, 360, dark](renders/w10f-refusal-360-dark.jpeg)

At 360, light: the same seven frames.

![/admin/archive before «Прочитати архів», 360, light](renders/w10f-unread-360-light.jpeg)

![/admin/archive with the per-source figures read, 360, light](renders/w10f-read-360-light.jpeg)

![/admin/archive run log in four states and a start on its way, 360, light](renders/w10f-log-360-light.jpeg)

![/admin/archive repair confirmation as a sheet, 360, light](renders/w10f-confirm-360-light.jpeg)

![/admin/users on «Заявки», 360, light](renders/w10f-users-360-light.jpeg)

![/admin/users approve confirmation as a sheet, 360, light](renders/w10f-approve-360-light.jpeg)

![/admin/users refusal, 409 unclaimed_identity, 360, light](renders/w10f-refusal-360-light.jpeg)

## Signed

- **Held from the record.**
  - The panel's order is the operator's; one axis per source, never merged; the coverage strip's anatomy.
  - The diagnosis is read on a press only, and the log is polled every 10 s while a run runs.
  - One filled button on the screen («Запустити» in the confirmation).
  - No `pos` for a succeeded run and no `neg` for a failed one.
  - The users page record’s copy, filters, actions, arming, refusal placement and 50-row paging.
- **Status (S3), glyph and word.** RunLog's Chip loses its fill, border and padding. What stays:
  - the 12 → 14 px glyph at stroke 2.25 in the status colour: Clock `muted` (pending), LoaderCircle `info` (running, spinning, stopped by reduced motion), Check `muted` (succeeded), TriangleAlert `warn` (failed);
  - the word, 11 px semibold `ink`, 6 px after the glyph;
  - the 22 px line, so the column holds its rhythm;
  - the cross-fade on a state change.
  - Each status colour keeps 3 : 1 on the glass, and shape and word carry the state, never the hue alone, as Carbon asks. The column loses four boxes.
- **Figures (K2), the wave-7 hero.** Per source, in the glass card (r24, padding 22 / 20 held):
  - the 10 px caps label;
    - *Overturned by wave 18: the label role, 11 px ([type.md](type.md#signed)).*
  - empty days at Manrope 36 / 600, line 1.05, in `warn-tint-text` with a 26 px TriangleAlert while any day is empty;
    - *Left open by wave 18: 36 / 600 fits no role in its table ([type.md](type.md#left-open)).*
  - the existing sentence (`emptySub` / `noEmpty`) as an 11 px `muted` caption;
  - gaps and captures · size as the wave-7 F1 fact grid (two columns, 10 / 18 gap, 10.5 px caps labels, 12.5 px bold values). The hairline goes.
    - *Overturned by wave 18: the labels take the label role (11 / 14), and 12.5 px maps to 13 ([type.md](type.md#signed)).*
  - The order is held: empty days first, then gaps, then captures and size. The warn colour on the figure is held from today. The card is the same height for both sources at both widths.
  - Its cost: a 36 px «0 днів» on a healthy source shouts a zero.
- **Applied from earlier waves, not asked.**
  - **Tables (wave 6).** RunLog, SpotCheck and the users table take the wave-6 anatomy: caps header on an `ink` 7 % band, zebra at 3 %, no row lines, 16 px column gap, 12 px insets. RunLog's two-line rows keep 9 px vertical padding. The users rows are 36 px, holding 30 px sm buttons. Below md, RunLog's stack and the users records are zebra records (r11, 12 px padding) in their one card (wave 6's R2).
  - **Shell at md and up (waves 2/4).** The glass sidebar (260, inset 16, r26), held to super-admin-shell's content: the brand row with no currency line; the role band, a 18 px shield in `sb-icon-active` and «Суперадміністратор» in Manrope 14 / 600, on `ink` 5 % at r12, 44 px; «Адміністрування» with «Користувачі» (its count 20 × 18 r5 on `sb-badge-bg`) above «Архів цін»; the theme control only; Налаштування; the profile row; the legal links.
    - *Overturned by wave 21: the count is solid `accent` with `accent-fg` text (C1) ([rail-and-account-foot.md](rail-and-account-foot.md#signed)).*
  - **Shell at 360 (wave 5).** The glass bar, 56 px: the mark and «quirenote», then the shield and «Суперадміністратор». The role dock is centred, with equal tabs and the count at 16 px r4. Its colour is `sb-indicator`, which equals `accent` in both themes, so the record's two tokens agree. The dock keeps wave 5's order, «Архів цін», «Користувачі», «Ще», as the owner ruled at sign-off, though the sidebar lists «Користувачі» first.
    - *Overturned by wave 24: the mark is a 28 plate at r7 with the «q» at 15 ([brand.md](brand.md#signed)).*
  - **Dialogs (wave 8).** D2 glass with a `field-border` edge at md and up (420), and the M2 inset sheet (12 from the edges) below. Content and copy are held. A refusal is 12 px `neg` above the buttons, with the key in mono.
  - **Fields (wave 8).** The repairs' date pickers and the users Select take the page fill (F2). The Select is 272 at md and up, and full width below.
- **New copy:** none. Every string is the app’s or the users page record’s.

## Rejected

- **S1, tinted chips** (today's 22 px r6 chip, a glyph and the word on `info-tint`, `warn-tint` or `panel`, pending outlined): four tints in a column, and the fills barely show on glass, so the chip reads as a tinted word.
- **S2, square and word** (Carbon's 8 px square at r2 in the status colour, pending hollow): the squares differ only by colour, and the colours sit too close together, so the word carries the state alone; it fails Carbon's two-of-three.
- **K1, the KpiCard** (today: the figure at 26 px, its sentence, a hairline, two label–value rows): the last pre-wave-7 anatomy, and the rows read as a receipt under the figure.
- **K3, three equal figures** (empty days, gaps and captures side by side at 20 px): the empty-days figure loses its lead, and at 360 the captures-and-size figure does not fit a third, so the row breaks.

## Settled by research

- **A status takes at least two of colour, shape and label.** Carbon: "Relying solely on color to convey status is insufficient", and asks for "at least a 3:1 contrast between colors used for status indicators".
- **Status words are adjectives, never actions** (GOV.UK Tag).
- **A run list reads status first** (gh run list: STATUS, TITLE, WORKFLOW … ELAPSED, AGE), which the log already does.
- **The glyph indicator** follows Carbon icon indicators and GitHub's run list.
- **The figures** follow wave 7 (H1 + F1, the Атрибути item).

## Implementation checks

- RunLog's chip is `RunLog.tsx`'s CHIP; the figures and their words are `archive/Figures.tsx`'s own, today in its KpiCard.
- No test pins the chip's tint or the archive's KpiCard.
- `archive-repairs.test.tsx` counts `[data-run]` rows, so keep the attribute on both the rows and the records.
- `sidebar-plane.test.ts` names KpiCard for its wall tone only, and the archive never used wall.
- `super-admin-shell`, `sidebar-structure` and `sidebar-rail` pin order and structure, which this keeps.

## Not drawn

- The observe confirmation: it is the same dialog as the import's ConfirmStart.

## Findings left to their own issues

- NN/g says "Do not use confirmation dialogs for routine actions", yet the users page confirms approve and enable, which can be undone. Its ruling stands.
- At 360 the header's stamp and «Оновити» wrap under the title with the stamp mid-line, as today.
- The dark scrim still barely dims (wave 8's finding).

## Перенесено

Rules of the super-admin's shell and its two pages that no code, test or decision records.

- **«Стан» becomes a second nav group under a divider** once its first page exists.
- **A failed GET /me adds no failure line to the nav.** The failed-screen state already says it; a second line would say it twice, in a new phrase.
- **Where the role is not shown,** each with its reason:
  - a chip beside the wordmark: the mark, the wordmark, the chip and the chevron do not fit the row;
  - the role in the account row: it stands at the panel's foot, out of the eye's path at its top, and the rail and the header bar have no address row to carry it;
  - a rail tile: it takes the box every rail item uses, so it reads as one more pressable item;
  - «СА» letters: an abbreviation nothing else in the app uses;
  - the capital's caption recipe in the header bar, «Ви увійшли як» over the role: a new phrase for what the role already says;
  - a chip at the bar's end: it leaves the capital's place empty and reads as a status badge;
  - the wall's edge with a text chip: the edge repeats the colour that already marks the current route, and no edge reaches the header bar below md.
- **«Користувачі».**
  - **The applications count costs one request whatever the queue,** under the list route's throttle.
  - **A row's two actions are never folded into a row menu:** a menu adds a part and a press.
  - **A confirmation never puts the address in its title:** at 360 the address strands the «?» on a line of its own.
  - **A refusal is never shown on the row or at the list's head:** the re-read often removes the row; the head is away from the act, and once a disabled row has moved to «Вимкнені» the disable retry would have no button there.
- **«Архів цін».**
  - **The strips of one card compare by position:** that is why every group of a source shares the source's axis.
  - **The strip has no window switch:** nothing asked for one.
  - **`gaps` is never the count beside a strip:** it nets, so it can hide an empty day and go below zero.
  - **The seam carries the boundary between imported history and the captured era:** the hue cannot tell the two eras apart.
  - **The diagnosis is never polled:** besides its wait and the payloads it executes, its route admits one read a second.
  - **The repair confirmation says only that the start goes to the server with these parameters:** the answer is the server's.
  - **The confirmation is the guard against a stray start,** so «Запустити…» stays pressable while one is out.
  - **A start is never disabled on dev:** the 405 is the server's answer to show at the form; the client does not guess the environment.
  - **A 502's pending row is never matched to a recorded run:** the answer names none.
  - **A failed run is a caution, not a harm:** `neg-tint` stays with overdue reminders and irreversible harm.
