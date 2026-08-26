# Section J — Phase 7 implementation (2 of 2)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A31, A32, A33. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

## A31 — `/portfolio` manages its assets — `feat/portfolio-assets`

Brief § S3, extension § S3. Per-entity variant: `Done` only, no Save, no Cancel.

- [x] `AssetManager` moves out of Settings onto `/portfolio`.
- [x] Desktop: actions on the row's right edge, in a **ninth column that exists only in edit mode** — an always-present empty column would widen the table's min-width for a control that is not there. **Below `md`: a FOOTER BAND
      inside the `RecordCard`** — a 1 px `hairline` rule after the `<dl>`, 14
      above / 14 below, actions pushed right, both `Button size="sm"` (h 30 →
      r 8), `gap-2.5`. **Not the card header** — that is where A17's 360 px
      overflow was closed. **The arithmetic first written here was WRONG, and
      `RecordCard.tsx` now carries the correction** (A31 review): `TAP_44`
      reaches (44 − 30) / 2 = 7 px past each edge, so two neighbours need
      **≥ 14** to guarantee no overlap, not 10. What actually saves the pair is
      WIDTH — the overlay is `min-w-full` and both labels render wider than
      44 px, so the regions never meet. An icon-only `sm` action here would need
      the gap re-derived.
- [x] **The Total card gets no band** — a sum is not an entity.
- [x] Empty portfolio KEEPS the edit control, because `+ Add asset` is exactly
      what an empty portfolio needs. The one place the rule bends, and it bends
      toward the user.
- [x] `AssetForm` and the D17 delete dialog are reused with NO contract change.
- [x] **Settings' Portfolio card is deleted in this commit** — with A30 done it
      holds nothing. Settings keeps Data, Automation, Appearance.
- [x] **F7:** both changed here — *"…редагуються в Портфелі"* and *"…прив'яжіть у Портфелі."*. `settings.sections.portfolio` went dead with the card and was removed.
- [x] **Verified in the browser.** Desktop at rest: one `Редагувати`, 8 columns.
      In edit: **`Готово` alone** — no Save, no Cancel — 9 columns, 9 cells in
      the Total row and **zero buttons in it**. At 360: the record card grows a
      footer band with one hairline rule and the two actions, the Total card
      grows none, `+ Додати актив` appears, and horizontal overflow is 0.
      The delete confirm is untouched: `role="alertdialog"`, cascade reading
      **"9 транзакцій і котирування за 174 дні"** — the map's pinned counts, with
      correct Ukrainian plurals.
      `/settings` now has exactly three sections (Дані · Автоматизація · Вигляд)
      and no trace of the Portfolio card; **no page carries a stale
      "Налаштуваннях → Портфель" any more**.

**Two structural notes.**

**`cascadeCounts` moved to `screens/portfolio/portfolio.ts` with its tests**, the
way `targets.ts` moved in A30 — it is the portfolio's glue now.
`screens/settings/settings.ts` keeps `parseLeadDays`, which is still the
reminders field's.

**Then `/code-review` (D76) returned 13 findings. Twelve fixed, one declined.**

**Three were user-visible defects.** The delete confirm recomputed
`cascadeCounts` from the live queries, so after a successful delete the sentence
flipped to *"0 транзакцій і котирування за 0 днів"* for the whole 220 ms exit —
the node stays mounted for its animation while `invalidateQueries` has already
run. The counts are frozen at open now, and the fix was verified by actually
deleting …6475 and reading the sentence mid-exit: *"3 транзакції і котирування
за 54 дні"*, unchanged. **The row actions had no accessible name** — four
identical "Змінити / Видалити" pairs, on a control where one choice destroys an
asset and its whole history; they now carry `aria-label` with the asset, the
first cell is a `<th scope="row">` and the ninth header has an `sr-only` "Дії".
**And `/portfolio` had no empty state**: deleting Settings' card orphaned
`t.assets.empty`, so the live dataset showed a table of zeros with no guidance.

**Two places where the code contradicted its own comment.** The `gap-2.5`
arithmetic was simply wrong — `TAP_44` reaches 7 px past each edge, so two
neighbours need **≥ 14**, not 10; what actually saves it is `min-w-full` plus
labels wider than 44 px, and the true rule is now written in both places the
false one had been copied to. And `useAssetDialogs`' JSDoc still promised a
`dialogs` node from the pre-split draft, which it has never returned.

**Also fixed:** the card footer nested a second flex box inside a band that is
already `flex-wrap`, making the pair unwrappable and cancelling the wrap the
band exists for; `useBackupDownload` moved to `src/hooks/` now that a second
route uses it; the duplicate `useAssets()` observer went (the screen passes its
list in); `addAssetButton` was inlined with its two-call-site comment corrected;
`portfolio.ts`'s header stopped claiming to hold only highlight-card glue;
`src/README.md` stopped naming the deleted `AssetManager.tsx`; and
**`navigation-map.md` was updated — I had skipped it here while writing D76,
which requires it.**

**DECLINED, with the reason:** the review asked to push the dialog state back
down so opening one does not re-render the whole screen. It is right that the
state sits above every derivation, and the placement comment claiming otherwise
is corrected — but pushing it down means either a render prop around the whole
screen or memoising the row derivations, and neither is worth it for four rows
that recompute in microseconds. Revisit if the table ever gets long.

**The dialogs split into two files, and the linter is why.** The first draft was
one `.tsx` exporting a hook that returned JSX;
`react-refresh/only-export-components` refuses a `.tsx` whose only export is not
a component. The split it forced — `useAssetDialogs.ts` for the state and the
writes, `AssetDialogs.tsx` for the rendering — is the separation this project
makes everywhere else anyway, so the rule improved the shape rather than
obstructing it.

## A32 — The `Entry` group and the `/transactions` route — `feat/transactions-route`

Brief § S4, extension § S4. Independent of A29–A31.

- [x] Sidebar group `Daily entry` → `Entry` / `Ввід`, holding `Daily quotes`
      (`/`) and `Transactions` (`/transactions`).
- [x] `TransactionPanel` moves off `/` to the new route and shows the **FULL**
      ledger, not the last three — the cap existed because the panel was a guest
      on someone else's screen. Long lists scroll inside a `Scroller` (D65).
- [x] **`/`'s aside becomes CONDITIONAL, not its layout.** Coupon day → today's
      geometry, unchanged. No-coupon day → the `<aside>` is **not rendered** (an
      empty `flex: 1 1 300px` child still claims 300–360 px) and the ritual
      column takes `max-w-[884px]` — **the app's own `@min-[884px]` number**
      (560 + 24 + 300), not a new one. Without it the rows jump 812 → 1196 the
      day a coupon is recorded.
- [x] **F6 — the new route gets NO microlabel**, and no copy was invented.
      `t.transaction.recentTitle` ("Останні транзакції") became false the moment
      the list stopped being the last three, so it is DELETED; `recentEmpty`
      already read "Транзакцій ще немає." — exactly the empty-state string this
      task's own box asked for. **One string removed, none added, and the
      question the box left open ("heading left off, or new copy minted") is
      answered: left off.** The screen's own title already says what the list
      is.
- [x] `/` stays the index route.
- [x] **Verified in the browser.** `/transactions` renders **all 18** seed rows,
      newest first, with no microlabel; the nav group reads **ВВІД** with
      `Щоденні котирування` and `Транзакції`, and the active pill follows.
      **D-2 confirmed to the pixel:** on a no-coupon day `/` renders NO `<aside>`
      at all and the ritual column measures exactly **884 px** of a 1196 px
      `main`, carrying `max-w-[884px]`. Zero horizontal overflow at 360 on `/`,
      `/transactions`, `/portfolio` and `/allocation`.
      `navigation-map.md` gains the route with its seed values, and `/`'s row and
      section both record the departure.

**The with-coupon case was NOT exercised**, and saying so is the honest report:
the seed's next coupons are 25.08 and 03.12, so no S5 card is due today, and
forcing one means editing a bond's `nextCoupon` — a write to pinned demo data.
The branch is `due.length === 0 ? 'max-w-[884px]' : ''` around an
`{due.length > 0 && …}`, so the untested path is the one that leaves today's
geometry untouched.

## A33 — Collapsible sidebar groups — `feat/collapsible-groups`

Brief § S5, extension § S5. Independent.

- [x] A bare chevron on each group label; the whole label row is the target.
      **Boxed control = the shell, bare glyph = the content it labels** — three
      independent differences from the D66 whole-sidebar control, on an axis
      that needs no learning (the sidebar leaves sideways, a group closes
      downwards).
- [x] **The ACTIVE PILL STAYS VISIBLE under a closed label; the group does NOT
      auto-expand.** Auto-expand makes the control refuse the press, and —
      because the collapsed set persists — would rewrite the stored preference
      on every navigation into the group, so the arrangement would decay on its
      own.
- [x] **Persisted**, unlike A21's currency glance: a nav arrangement is a
      durable choice. The field enters `PersistedSettings`,
      `PERSISTED_DEFAULTS`, `migrateSettings` **and `partialize`, in the same
      commit** (the standing invariant).
- [x] One state serves both shells — the drawer IS the sidebar (D66).
- [x] The label row keeps radius **9**, borrowed from the nav pill: it draws no
      box in any state, so the proportional rule has nothing to read and
      deriving it would give two values for one row. **This is the extension's
      one deliberate D56 exception and it is argued there** — do not "fix" it.
- [x] **Verified in the browser.** Three group buttons with `aria-expanded` and
      the boxed D66 control still separate beside them. Collapsing Аналітика
      while ON `/portfolio` leaves the grid at **height 0** and the active pill
      rendered beside it — "Портфель" appears twice in the DOM, once clipped and
      once surviving; navigate away and it is once, which is the "zero rows or
      one" rule. The state survives a reload (`collapsedNavGroups: ["analytics"]`
      in `quirenote-settings`), and the transition keeps D7's asymmetry —
      measured **0.3 s** opening and **0.22 s** closing.
      At a 640 px viewport the three-band grid holds at `78,8 / 352 / 175,3` with
      every group expanded and the currency toggle on screen, so collapsing is a
      choice rather than a requirement.
      **683 tests (+4)** — the store's four transitions, including that a
      collapsed set survives `mergeSettings` where A21's currency does not.

**Three things the browser caught that the gates could not.**

**A Ukrainian case error in my own string.** `Згорнути ${group}` put a nominative
noun in an accusative slot: «Ввід» and «Налаштування» survive because their forms
coincide, «Аналітика» does not. Reworded to «Згорнути групу «Аналітика»», which
keeps the case on a word the template owns — the same trap `dates.monthIn`
solves for months.

**The chevron was not animating.** Tailwind v4 compiles `-rotate-90` to the
standalone `rotate` property, which `transition-transform` does not cover, so the
first draft rotated instantly while its comment claimed 220 ms.
`transition-[rotate]` fixes it; measured `rotate / 0.22s`.

**And one thing that looked broken and was not.** My first visibility check
reported the collapsed group's links as still visible. They were not: an element
clipped by a zero-height `overflow-hidden` ancestor keeps its own box, so
`getBoundingClientRect().height > 0` is the wrong question. The container
measured 0. The measurement was wrong, not the code — worth recording, because
the tempting next move was to "fix" working markup.

---

