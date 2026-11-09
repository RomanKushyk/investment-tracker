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
  - empty days at Manrope 36 / 600, line 1.05, in `warn-tint-text` with a 26 px TriangleAlert while any day is empty;
  - the existing sentence (`emptySub` / `noEmpty`) as an 11 px `muted` caption;
  - gaps and captures · size as the wave-7 F1 fact grid (two columns, 10 / 18 gap, 10.5 px caps labels, 12.5 px bold values). The hairline goes.
  - The order is held: empty days first, then gaps, then captures and size. The warn colour on the figure is held from today. The card is the same height for both sources at both widths.
  - Its cost: a 36 px «0 днів» on a healthy source shouts a zero.
- **Applied from earlier waves, not asked.**
  - **Tables (wave 6).** RunLog, SpotCheck and the users table take the wave-6 anatomy: caps header on an `ink` 7 % band, zebra at 3 %, no row lines, 16 px column gap, 12 px insets. RunLog's two-line rows keep 9 px vertical padding. The users rows are 36 px, holding 30 px sm buttons. Below md, RunLog's stack and the users records are zebra records (r11, 12 px padding) in their one card (wave 6's R2).
  - **Shell at md and up (waves 2/4).** The glass sidebar (260, inset 16, r26), held to super-admin-shell's content: the brand row with no currency line; the role band, a 18 px shield in `sb-icon-active` and «Суперадміністратор» in Manrope 14 / 600, on `ink` 5 % at r12, 44 px; «Адміністрування» with «Користувачі» (its count 20 × 18 r5 on `sb-badge-bg`) above «Архів цін»; the theme control only; Налаштування; the profile row; the legal links.
  - **Shell at 360 (wave 5).** The glass bar, 56 px: the mark and «quirenote», then the shield and «Суперадміністратор». The role dock is centred, with equal tabs and the count at 16 px r4. Its colour is `sb-indicator`, which equals `accent` in both themes, so the record's two tokens agree. The dock keeps wave 5's order, «Архів цін», «Користувачі», «Ще», as the owner ruled at sign-off, though the sidebar lists «Користувачі» first.
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
