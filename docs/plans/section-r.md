# Plan A — Section R

> Body of Section R's one task. Status table and rules:
> [`PLAN-NOW.md`](PLAN-NOW.md). **Read the ruling before the task**:
> [`../decisions/D135.md`](../decisions/D135.md).

## Section R — the observe window, from O32, closed by D135 (2026-09-03)

Letter R because A–Q are spent: `../archive/plan-a/README.md` holds A–P and
Section Q left with W4 on 2026-09-03. One task, as Sections C and M each are.

## A55 — bound the observe statement, and derive completeness from both bounds

**Branch:** `infra/observe-window-bound` · **Size:** S

Ruled by [D135](../decisions/D135.md). The ruling is the specification; this
row is the work.

### What is wrong today

`observeNbu` has two bounds and only one is real. `limit = req.limit ?? 400`
(`infra/src/capture.ts:819`) stops the JS loop at `:838`, **after** the rows
have arrived. `NEWEST_CAPTURE_PER_DATE` selects every usable capture in
`[from, to]` with `payload_gzip` projected and has **no bound at all** — so a
default `{observe:{}}` spans 3 895 days against a plan that A50 measured falling
to `Full Scan (btree-table)` by 2 000, and pulls roughly 2 666 rows of payload
to consume 400.

### The change

- [ ] A `CAP` of **1 000 days**, and `windowEnd = min(to, from + CAP)` passed as
      the statement's upper bound in place of `to`.
- [ ] `complete = windowEnd >= to && dates < limit`, replacing
      `remaining = captures.length > dates` (`:898`).
- [ ] `nextFrom` from whichever bound bit, **and the two are ORDERED**: the JS
      limit is checked FIRST and wins (`cursor + 1`); only if it did not bite
      does the window answer (`windowEnd + 1`); `null` when neither. **Both
      truncate on almost every run** — ~684 dates in a window against a limit of
      400 — so letting the window win skips the ~284 fetched-but-unconsumed
      dates in `(cursor, windowEnd]`. `min(cursor, windowEnd) + 1` does NOT
      express this: with the limit unbitten it collapses to `cursor` and stalls
      an empty stretch at a day per invocation.
- [ ] The identical change in `observeInzhur` (`:954`, `:957`, `:987`, `:1118`).
      It does not need the bound until 2029 and takes it anyway — the file's own
      rule at `:923` is that two observers that drift are two contracts.

### Tests that must exist before the change is done

The failing-test-first rule applies, and these are the four the ruling's
reasoning names:

- [ ] **Both bounds truncating at once continues from the CURSOR, not the
      window** — the ~284-date silent skip, and the case that happens on almost
      every real invocation.
- [ ] **A window that truncates reports `complete: false`.** This is the
      regression the whole question exists to prevent: cap the range and the old
      `captures.length > dates` returns `complete: true, nextFrom: null` on a
      partial run.
- [ ] **An EMPTY window advances `nextFrom` by CAP, not by one day.** Deriving
      from `cursor` alone stalls the caller at one day per invocation across an
      archive gap; this is what makes the loop terminate.
- [ ] **A run that reaches `to` inside one window reports `complete: true`** with
      `nextFrom: null` — the loop must still end.

### Gates

`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, **plus the
fifth**: `npm ci` in `infra/`, then `pnpm exec tsc --noEmit -p infra` from the
root. `capture.ts` is `infra/`, so the root typecheck does not read it.

### What this task must NOT do

- Add a SQL `LIMIT`. [D97](../decisions/D97.md) ruled it out and D135 does not
  re-open it: the `Sort` consumes its whole input before yielding a row.
- Add an `EXISTS`-past-the-cursor probe. D135 rejected it on a termination
  hazard — it must carry `NEWEST_CAPTURE_PER_DATE`'s real predicate,
  `ok = true OR ($4::text IS NOT NULL AND error LIKE $4)` (`capture.ts:801`),
  which is **not** the same on both paths: `observeNbu` binds `$4 = null` and so
  filters on `ok = true` alone, while `observeInzhur` binds `TRACKED_ABSENT_LIKE`
  (`:993`).
- Touch `refs` scope, the `Sort` node itself, or anything about `price_capture`'s
  key. D135 lists all three as undecided by it.
