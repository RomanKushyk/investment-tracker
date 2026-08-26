# Ideas

Raw list, owner's own words. Not a plan — nothing here is scheduled and nothing
is implemented from this page. Add a line and move on.

Cycle: collect here → groom into `PLAN-NOW.md` / `PLAN-WAITING.md` → wipe this
list and start collecting again. Last groomed 2026-08-18 (7 → 0); where each
line went is in the ledger at `../archive/plan-a/README.md` § Section H.

**Ideas only — a bug goes in [`USER-BUGS-DRAFT.md`](USER-BUGS-DRAFT.md).** This
page is what the app does not do yet; that one is what it does wrong. Two lines
moved there on 2026-08-26. A missing capability is an idea, not a bug: "it will
not let me edit a transaction" belongs here.

- sections in setting can be better visually separated, or even each can have link in settings sidebar group;
- instead of demo toggle create a separate route e.g. quirenote.com/demo/... which copies all pages but show demo data only, always public (no need for registration), mimics all the behavior but has no affect on real site/data;
- editing transactions, and separately on each tab (a payout is its own tab) — right now if I got something wrong there is nothing to fix it with; the screen for it is already specified as Phase 7's `/data` browser, and `useUpdateTransaction` / `useDeleteTransaction` exist with no caller;
- bond form: «Сума купона, ₴» needs a hint saying what it is — it is not clear whether that means the coupon's price at the start or a quote; «Наступний купон» should take the earlier ones into account; «Погашення» and «Графік виплат» should be filled from the ОВДП picker where it knows them — the picker's maturity hint is conditional, and with the feed down it degrades to a plain text field;
- daily quotes are great, but needing a manual backfill is not; a table by type and date, the shape my spreadsheet has, and on its OWN page — the rail is 360 wide and holds no controls;
- the ОВДП/ФОНД selector needs a search box: Radix `Select` does prefix typeahead, but bond options are labelled by ISIN and nobody remembers an ISIN;
- «Політика реінвестування» drives nothing, though it is not unused: `/attributes` shows it and it makes `/allocation`'s trim rows add «або призупинити реінвестування». No reinvest follows from it — decide whether it should drive anything before touching it;
- the new-asset form is too narrow to work in — the inline quick-create on `/transactions` is 360 by a merged drawing, while `/portfolio`'s own dialog is 520;
- «Код» could take 4 characters, or 6, digits as well as letters — or mark an ОВДП differently: by colour, by shape, by the ISIN's last 4 digits. Parked until [O27];
- a colour selector for an asset would not be excessive — a dropdown of predefined colours. One of [O27]'s candidates;
- «Внесок» is a somewhat unclear name;
- do not allow adding a transaction that goes past the free balance on the broker account, and think about a different way of recording that balance altogether;
- a universal tracker should split assets by PROVIDER: then the free balance is tracked per provider, the site reads as micro-cabinets, and the whole transaction flow can be reworked around them;
- для дохідності додати перемикач між "дохідність за активом від першої купівлі" та "повна дохідність" - те саме + усі виплати по активу
