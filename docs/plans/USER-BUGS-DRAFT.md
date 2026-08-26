# Bugs

Raw list, owner's own words. The pair to [`USER-FEATURES-DRAFT.md`](USER-FEATURES-DRAFT.md):
that page is what the app does not do yet, this one is what it does WRONG. Add a
line and move on — keep it plain, bare bullets, no ceremony.

Cycle: collect here → reproduce → groom into Plan A or Plan B → wipe this list
and start collecting again. Started 2026-08-26 with the two lines that were
sitting in the ideas list.

**`PLAN-NOW.md` is an INDEX (D95)** — a groomed `fix/` task gets a Status row
there and its body in the matching range file (`A41-A60.md` and so on), listed
in that file's "Where the detail is" table in the same commit. A bug gated on
W7 or on the migration goes to `PLAN-WAITING.md` instead.

**A pasted sample is BYTES — never retype one.** The first line below arrived
with a non-breaking space (U+00A0) as its thousands separator, which is exactly
what a paste from a Ukrainian-formatted page yields, and it is plausibly the
whole bug. Retyping it into an ASCII space was caught in review on this page's
first day. Copy the line, do not re-key it, and write the failing test against
the bytes.

**A line here is a SYMPTOM, not a diagnosis.** Nothing is implemented from this
page and nothing is fixed from it directly: reproduce first, then write the test
that fails, then fix. A bug report says what the owner saw; what is actually
broken is a separate finding, and the two are wrong about as often as they agree.

**Not for cosmetics consciously shipped as-is** — those go in
[`FOLLOW-UPS.md`](FOLLOW-UPS.md). Not for a missing capability either: "it will
not let me edit a transaction" is a feature, and belongs on the ideas page. The
test is whether the app is doing something it already claims to do, and getting
it wrong.

- when copy-pasting for example '4 214,24 грн. ' snapshot saves with empty quotes object, no error etc. Add error, add regexp to trim currency symbols or text at the end of value.
- in balances the 'ОВДП UA4000238976' shows nothing, while the quotes was provided, they stored in the indexed DB and included in the yield
- 
