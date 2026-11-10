# Forms and dialogs (wave 8)

The shell, cards and tables moved to glass; the forms and dialogs never did. Each form writes its own field classes, a dialog on a phone is still a floating card, and at 360 a toast can land on the new dock. This wave settles the field on glass, the dialog surface, what a dialog becomes on a phone, and the toast.

## Renders

Every frame is the live app's own form or dialog, opened through its real trigger. The toast frames show two real toasts from the app: the success «Зріз збережено», and the error «Не вдалося зв’язатися з Inzhur — перевірте з’єднання.» with its 28 px r7 close box.

At 1440: the transaction form submitted empty, the asset dialog, the delete confirmation and the toasts.

![The transaction form submitted empty, 1440, dark](renders/w8f-tx-1440-dark.jpeg)

![The transaction form submitted empty, 1440, light](renders/w8f-tx-1440-light.jpeg)

![The asset dialog on the glass panel, 1440, dark](renders/w8s2-add-D2-dark.jpeg)

![The asset dialog on the glass panel, 1440, light](renders/w8s2-add-D2-light.jpeg)

![The delete confirmation on the glass panel, 1440, dark](renders/w8s2-del-D2-dark.jpeg)

![The delete confirmation on the glass panel, 1440, light](renders/w8s2-del-D2-light.jpeg)

![A success and a failure toast in glass, 1440, dark](renders/w8s4-T3-1440-dark.jpeg)

![A success and a failure toast in glass, 1440, light](renders/w8s4-T3-1440-light.jpeg)

At 360: the form errors, the asset sheet, the delete sheet and the toasts above the dock.

![The transaction form errors, 360, dark](renders/w8f-tx-360-dark.jpeg)

![The transaction form errors, 360, light](renders/w8f-tx-360-light.jpeg)

![The asset dialog as an inset sheet, 360, dark](renders/w8s3-add-M2.jpeg)

![The asset dialog as an inset sheet, 360, light](renders/w8f-add-360-light.jpeg)

![The delete confirmation as an inset sheet, 360, dark](renders/w8s3-del-M2.jpeg)

![The delete confirmation as an inset sheet, 360, light](renders/w8f-del-360-light.jpeg)

![A success and a failure toast in glass above the dock, 360, dark](renders/w8s4-T3-360-dark.jpeg)

![A success and a failure toast in glass above the dock, 360, light](renders/w8s4-T3-360-light.jpeg)

The 360 sheet at real speed: a flip-book of renders, one per 60 Hz frame. The delete sheet rises in 260 ms and leaves in 220 ms on `ease-soft`, and the scrim fades over 220 ms, the «Ще» sheet's own tokens. Under reduced motion the global kill-switch makes it appear at once.

![The delete sheet rising at 360, the flip-book's first frame](renders/w8m-fo00.jpeg)

## Signed

- **Held from the record, not re-asked.**
  - A field is 36 px at r9 with a `field-border` edge ≥ 3 : 1, hover to `ink`, invalid `neg`, and the global 2 px focus ring.
    - *Overturned by wave 17: the focus ring is two-tone, a `card` halo inside the `accent` ring (F2) ([controls.md](controls.md#signed)).*
  - 44 is hit area, never geometry.
  - The button variants and their 60/30/10 ration.
    - *Overturned by wave 17: the secondary button is the glass knob (B4) ([controls.md](controls.md#signed)).*
  - Radix's trap, Escape and focus return.
  - "No refusal sentence moves its button".
  - The toast's r13 and its 28 px close box.
- **Field (F2), every form.** Fields take the recessed `page` fill, one step darker than the card in light, so every field reads as a well in the surface. It makes the two forms agree.
  - Held: 36 px at r9, a `field-border` edge, hover to `ink`, invalid `neg`, the global 2 px focus ring, labels above at 11 px `muted`, the 44 hit area below md, 16 px type below md.
    - *Overturned by wave 17: the focus ring is two-tone, a `card` halo inside the `accent` ring (F2) ([controls.md](controls.md#signed)).*
  - Errors: an 11 px `neg` line under the field, and the summary under the submit (as shipped).
  - One shared field recipe replaces the per-surface ones.
- **Dialog at md and up (D2).** The wave-4 glass (`card` 80 % + `blur(30px) saturate(180%)`, bevel and sheen), with the `field-border` edge kept (the record’s floating-edge rule).
  - *Overturned in light by wave 15: the light fill is `card` 70 %, with the lit edge ([glass-light.md](glass-light.md#signed)).*
  - r24, and three bands: the header `pt-6 pb-4`, a scrolling body, the footer `pt-4 pb-6`, all at `px-[28px]`.
  - The secondary action sits left of the primary, and the scrim is held.
  - Over the scrim the page behind is dimmed, so the glass reads mostly through its bevel and sheen.
  - Drawn on the asset dialog («Додати актив», 520) and the delete confirmation (AlertDialog, 420).
- **Dialog below md (M2), an inset sheet like «Ще».**
  - Geometry: 12 px from the sides, `bottom: calc(12px + env(safe-area-inset-bottom))` above the keyboard inset, r24, `max-height: calc(100dvh − 80px)`, with the body scrolling inside.
  - The buttons end up within thumb reach. Fields stay 36 px with the 44 hit area, at the 16 px type the app forces below md.
  - Motion: it rises `translateY(calc(100% + 12px))` → 0 in 260 ms and leaves in 220 ms on `ease-soft`; the scrim fades over 220 ms. Reduced motion uses the global kill-switch.
  - The same sheet serves forms and confirmations; Radix keeps trap, Escape and focus return.
- **Toast (T2 + T3), T2's status glyph in T3's glass.**
  - *Overturned by wave 22: the toast's edge is wave 15's glass edge ([controls-and-overlays.md](controls-and-overlays.md#signed)).*
  - The wave-4 glass, r13, the `field-border` edge, 14/16 padding, 13 px text.
  - A leading 18 px glyph: Lucide circle-check in `ink` for success (`pos` and `neg` are reserved for deltas), circle-alert in `neg` for a failure. The shape says the status, so colour is never alone.
  - A failure keeps its 28 px r7 close box and stays until closed. `role=status`.
  - Placement at md and up: bottom-right, 24 px from the edges.
  - Placement at 360: 12 px from the sides, and the offset adds the dock's height + 12, so the toasts sit above the dock.

## Rejected

- **F1, the card fill** (the transaction form today): on a card-coloured dialog the field is the panel's colour, so in light it reads as a line, not a box.
- **F3, a light ink tint** (`ink` at 4 % over its surface): a translucent fill that shifts with the backdrop over the glass.
- **D1, today's solid card** (r24, the `field-border` edge): no cost was recorded against it; D2 brings the dialog into the glass that waves 2/4 gave every card and the dock.
- **D3, glass with a title band** (the title row on the wave-6 band, `ink` 7 %): the band's height follows each dialog's own title row, so it varies between dialogs.
- **M1, today's floating card** (centred, 100vw − 32 wide, capped at 85 % of the height): the buttons sit mid-screen, away from the thumb.
- **M3, forms full-screen, confirmations stay sheets:** two forms to maintain, the page behind disappears, and the top needs the safe-area inset.
- **T1, today's text toast** (text only, on the opaque card): success and failure differ only by the close box.

## Settled by research

- **Labels sit above fields.** GOV.UK: "align labels above the text input"; NN/g.
- **Errors show on submit and clear as a field is corrected.** GOV.UK: "Do not validate when the user moves away from a field".
- **Confirmations name what happens** (NN/g).
- **Toasts announce politely** (WCAG 4.1.3, `role=status`).
- **At 360 a toast clears the dock.**
- **The footer order**, secondary left of primary, follows Carbon.
- **The inset sheet** reuses the signed «Ще» sheet. Apple HIG: "A sheet helps people perform a scoped task". Its cost is a long form scrolling inside the sheet (Apple: "For complex or prolonged user flows, consider alternatives to sheets").
- **The status glyph** follows WCAG 1.4.1 (not colour alone); Carbon notifications carry a status icon.
- **The glass panel and toast** follow waves 2/4: every floating surface is glass.

## Implementation checks

- The shared field recipe replaces the per-surface ones in `TransactionPanel.tsx`, `AssetForm.tsx` and `sign-in/parts.tsx`.
- `field-border.test.ts`: the shared recipe and the fill.
- `floating-edges.test.ts`: glass panels and toasts keep the edge.
- `toaster-press.test.ts`: the offset gains the dock. Today's offset knows the action bar and the drawer band, not the dock.
- The Dialog's below-md geometry, which no test pins today.
- `transaction-form-reset.test.ts`: the errors are unchanged.

## Left open

Wave 8 left these record conflicts open:

- Stacked button order below md (import: destructive last; re-authentication: action first).
- Dialog r24 vs the record’s r20 for floating edges.
- Field radius 10 (the asset form's record) vs 9.

Wave 16 settles all three ([dialog-buttons-and-radii.md](dialog-buttons-and-radii.md#signed)).

## Findings left to their own issues

- The forms use example placeholders («6 164», «10 000,00», «ОВДП UA4000241234», «16,5»), which GOV.UK rules out "for hints or examples". In the asset form they read as filled values.
- In light theme the placeholder text is under 4.5 : 1. That is Tailwind's default, `currentColor` at 50 %.
- Портфель's edit mode at 1440 runs «Приріст капіталу, %» into «Частка» (wave 6's column gap fixes it).
- At 360 the asset form keeps its field pairs side by side, so «Раз на півроку» truncates. The record says pairs "stack at narrow widths; the form fits 360px unclipped".
- In dark the scrim (the page colour at 64 %) barely dims a dark page.

## Перенесено

Rules that no code, test or decision records: of the re-authentication and deletion dialogs on /profile, the asset and transaction forms and their field edges, Settings with its appearance, its Data card with the import's drop zone, and the import dialog, and the targets on /allocation.

- **No extend control.** The window is a security limit, which WCAG 2.2.1's essential exception covers, and confirming again is the extension.
- **The panel's height follows its content at once,** with no height transition: an exception to *Interaction rules*, so the panel's top and each step's row stand still.
- **The time left is replaced in place,** with no motion of its own: an exception to *Interaction rules*, since it changes on a clock, not on an interaction.
- **No emailed code** as a way to confirm.
- **No toast for a refusal.** The sentence stands next to its source.
- **No radios or option blocks for the deletion's timing.** The button pressed is the timing, so nothing is chosen in advance.
- **The deletion is confirmed in a dialog,** never on a separate page.
- **The body's link to Settings is enough for the copy,** so no «Спершу завантажте копію» button stands beside it.
- **A deletion that stopped part way leaves no marker.** Closed after a failure, /profile is as it stands, and the same trigger asks again.
- **No mailed reminder before the purge.**
- **The asset form's motion.** A field's error line fades and slides in over 220 ms, and a field's hover edge changes over 150 ms. A conditional group (the fixed-coupon fields the yield type shows, the Inzhur group its switch shows) reveals with its height as well as the fade and slide, 300 ms soft, and hides the same way.
- **The Inzhur picker and the manual field swap by a crossfade with a height change,** over 220 ms.
- **The 1.10× band between a field's edges binds its resting edges only:** the error edge and the hover may stand above it, since an error and a pointer's response should outrank a resting edge.
- **A "new asset" cue on the trigger, if one is wanted, comes back dashed, never as a heavier stroke:** a dash is how a field says "proposed".
- **The note takes no character counter.** It would be furniture for a bound the field refuses at by a sentence, and the only character counter in the app.
- **The note's refusal reads «Нотатка — не більше 100 символів.»**
- **Automation has no switch for fetching quotes.** A fetch only ever starts from its button, so there is nothing to turn off.
- **Automation's sub-rows reveal and collapse with their height** as well as the fade and slide, 300 ms soft. The lead time's error fades and slides in over 220 ms.
- **The erase's typed confirmation in Settings shows no error while it is unarmed.** A word not yet typed out is a step toward arming, not a mistake.
- **Changing the theme shows no toast:** the whole screen repainting is the feedback.
- **The backup button stays enabled on an empty portfolio:** an empty export is a valid export.
- **A CSV button shows no spinner,** since the file is built too quickly for one to say anything. **An empty table's button stays enabled:** a header-only file is the honest answer, and a disabled button would look like a bug.
- **No error shows at the Data card's level;** each belongs to the row that caused it, and an empty portfolio changes nothing in the card.
- **Dragging a file over the import panel never scrolls the page.**
- **The drop zone's edge is no furniture, so 3 : 1 binds it:** it has three states, two of them drawn as changes of that edge, and a pointer aims at it.
- **The drop zone's hover is judged by its edge against the surface, not by its step from rest,** so a step that narrows in one theme is accepted.
- **The import panel's motion.** The rejection line fades and slides in over 220 ms and fades out over 220 ms. A row whose content changes height animates the height with a fade over 220 ms.
- **At md and up, the import dialog is capped at `calc(100dvh - 48px)`.**
- **A problem in the import's list is inert but selectable text, with no copy button:** a person copies a line by selecting it.
- **The import diff's motion.** The rows fade and slide in over 220 ms. The warnings block reveals with its height and a fade over 300 ms.
- **The targets' error on /allocation fades and slides in over 220 ms.**
- **A plan that tracked the draft would tell a person to buy something on the strength of a number they have not committed to,** so the rebalance plan reads the saved targets.
- **While the targets are edited, each row's signed delta re-derives against the draft,** as its target tick does.
- **One verb puts a page into its edit mode and the other changes one record, and Ukrainian is the language that shows it,** so «Редагувати» and «Змінити» are never unified.
