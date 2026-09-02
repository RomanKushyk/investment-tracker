---
name: work-issue
description: End-to-end path for a GitHub Issue in this repository — reproduce, failing test, branch, gates, `/code-review`, squash-merge carrying `Closes #N`. Use it whenever the user wants to work on, start, pick up, reproduce or fix an issue, including bare forms like "work on #3", "fix #1", "take the next bug", or a pasted issue URL. Not for filing, listing, or grooming issues into plans.
---

# Work a GitHub Issue

This repository's inbox is GitHub Issues (D103), and an issue becomes work by
being **branched, fixed and closed by the squash-merge** — not by growing a task
body in `docs/plans` (D105). This skill is that path, start to finish.

## Inputs

- **`$issueNumber`** — e.g. `3`, `#3`, or a full issue URL (required). **Strip
  the `#` before it reaches a shell**: unquoted, `gh issue view #3` is truncated
  at the `#` as a comment and gh then fails with `accepts 1 arg(s), received 0`.
- **`$additionalSteps`** — extra steps to run after implementation (optional)
- **`$additionalGuidelines`** — extra constraints during implementation (optional)

---

## Before anything: three rules that decide the shape of the work

**Read these first — each one is cheap to honour up front and expensive to
retrofit.**

1. **A line in an issue is a symptom, not a diagnosis** (D103). The reporter is
   the owner, often writing on a phone, describing what he saw. Sometimes he
   also names the cause and is right: #31 reported quotes that did not match and
   guessed it was tied to units being entered only on the first purchase — which
   it was. Even then the diagnosis was one step worse than the report, a missing
   column rather than a mis-entry, and only reproducing it showed that. So take
   a hypothesis as a lead worth testing first, never as the thing to fix.
2. **Nothing goes into `docs/plans`** (D105). The default is: branch, do the
   work, `Closes #N`. Grooming an issue into a Status row plus a section-file
   body is D103's path and is now the exception — reserve it for an issue big
   enough to want a plan body, or one that turns out to be gated on something
   you cannot finish. If you think you have one of those, say so and ask.
3. **`gh` runs under the pinned config, and `gh auth switch` is forbidden.**
   Two accounts share the keyring and the owner works both at once, so
   switching yanks the account out from under his other session. Every command
   in this skill carries the prefix:

   ```bash
   GH_CONFIG_DIR="$HOME/.quirenote/gh-config" gh …
   ```

   The work account is *not* read-only here, so nothing fails loudly to warn
   you.

---

## Step 1: Read the issue — the bytes, not a paraphrase

```bash
GH_CONFIG_DIR="$HOME/.quirenote/gh-config" gh issue view $issueNumber \
  --json number,title,body,labels,milestone,comments
```

**A pasted sample is BYTES, and you cannot see them.** This is the rule most
likely to destroy the evidence you were given, and it fails below the level of
intent — you will retype a sample correctly-looking and wrongly while believing
you copied it.

Issue #1's sample, written so it survives being read:
`4\u00A0214,24 грн. ` — a **U+00A0** thousands separator, a Cyrillic suffix, and a
**trailing space**. Rendered literally it looks identical to `4 214,24 грн. `,
which is why the escaped form is the one to pass around.

Read the bytes rather than the rendering:

```bash
GH_CONFIG_DIR="$HOME/.quirenote/gh-config" gh issue view 1 --json body \
  --jq '.body' | od -c | head
```

Then get the sample into the fixture **without retyping it** — pipe it to the
file, or write it escaped (`'4\u00A0214,24 грн. '`) so a later reader and a later formatter
both leave it alone. A test whose input was retyped pins a cleaned-up lookalike
and passes while the bug survives.

**This is not hypothetical: the first draft of this skill retyped it.** The
sample went in literally, three tool calls after the correct `od -c` output had
been on screen, and the NBSP silently became `0x20`. Prose telling you to be
careful does not survive transcription; an escaped form does.

### What the byte dump is actually for

**It refutes hypotheses more often than it confirms them, and #1 is the worked
example.** The obvious suspect there is the U+00A0 — and it is the wrong one, so
do not carry that assumption into the work. `normalizeNumberInput` opens with
`input.replace(/\s/g, '')` (`src/core/schemas.ts`), and JavaScript's `\s`
matches U+00A0 — the NBSP and the trailing space are both gone on the first line
and never reach the parser.

The actual cause is the **dot in `грн.`**. After stripping, `4214,24грн.` holds
both a comma and a dot, so the "when both marks appear, the last is the decimal"
rule elects the dot and deletes the real comma as a thousands separator:
`421424грн.` → `NaN` → the row is dropped and a success toast shown.

That also makes the issue's own proposed fix dangerous. Trim the currency text
*after* the marks are read and the sample becomes `421424` — a **hundredfold
error stored as a perfectly legal quote**, which is worse than the empty object
that was reported. The trim has to happen *before* disambiguation.

Two independent runs reached this by dumping the bytes and then reading the
parser, rather than by trusting the note. **Treat the hypothesis in an issue —
or in `CLAUDE.md` — as the first thing to test, not the thing to fix.** When a
measurement disagrees with a written claim, the claim is the candidate for being
wrong, and saying so is part of the work.

**The label sets the queue position, not the tone.** `bug` is the one class
allowed to preempt the plan order (D105, D108); a missing capability is an
`enhancement`. If the issue is labelled wrong for what you found, say so — the
label is a decision about sequencing.

---

## Step 2: Reproduce before you diagnose

**For a `bug`, this step is not optional and not a formality.** You are
establishing that you can make the defect happen on demand, because that is the
only thing that later proves you fixed it.

Reproduce at the lowest level that shows it:

- a failing unit test against `src/core/…` when the defect is in derivation,
  parsing or schema — most of them are;
- the running app when the defect is visual or interaction-level. The dev server
  is normally already up on `:3000`; connect to it rather than starting a fresh
  one. For anything measured, follow **D115**, whose first instruction is
  **measure in the `chrome-devtools` MCP, not Playwright** — a
  `border:1px; outline:2px; width:100px` probe computes to 0.571 / 1.714 / 100
  in Playwright's headless Chromium and 1 / 2 / 100 in real Chrome, so lengths
  are honest there but thicknesses are not. Then calibrate with that probe,
  disable transitions before reading anything animatable, and drop the probe
  before recording a number.

**If you cannot reproduce it, stop and report that.** Do not fix the thing you
suspect. A change that cannot be shown to fix anything is worse than an open
issue, because it closes the issue.

**For an `enhancement`, replace this step with understanding.** Find the code
that would have to change and read it. D103's rule — nothing is built from an
issue without understanding it first — applies to both classes; only the method
differs.

---

## Step 3: Branch

Every change reaches `dev` on a branch and arrives by squash-merge, with no
exception for size (D73).

```bash
git fetch origin --prune
git switch -c <type>/<kebab-title> origin/dev
```

- `<type>` is `fix` for a `bug`, `feat` for an `enhancement` that adds
  capability, or `docs` / `chore` / `refactor` / `test` / `style` / `infra` as
  the change warrants.
- `<kebab-title>` describes **what the change does**, not the issue's title and
  **not the issue number** — the format has nowhere to put one, and the link
  comes from `Closes #N` alone. Issue #31 was branched
  `fix/quotes-ignore-post-link-purchases`.

If work is already in progress on a branch for this issue, check it out and
rebase it on `origin/dev` instead.

---

## Step 4: Confirm the diagnosis before writing the fix

Present, and wait for a reply:

> **What the issue says:** [the reporter's words]
> **What I reproduced:** [the actual failing behaviour, and how]
> **The cause:** [what is really wrong, which may not be what was reported]
> **What I plan to change:** [numbered, concrete]
> **Does this match what you saw?**

This checkpoint exists because the reporter is the only person who knows whether
you reproduced *his* bug or a different one that looks like it. It is also where
a diagnosis that turns out to need a **decision entry** surfaces — if the fix
changes a contract, a stored format or a rule that later readers will need the
reasoning for, say so now (see Step 7).

---

## Step 5: Commit the failing test first

Land the reproduction as its own commit, before any fix:

```
test: reproduce #31 — the fetch cannot see a purchase made after the link
```

That is a real commit from this repository, and it is the shape to copy. The
reason to give it its own commit rather than folding it into the fix is that it
is the only artifact proving the defect was real: a reviewer can check out that
commit and watch the suite go red. It also makes the fix's diff honest — what
turns the test green is exactly the fix and nothing else.

Write the test to fail for the reported reason. A test that passes before your
fix has pinned the wrong thing.

---

## Step 6: Implement

Make the smallest change that turns the test green.

- **Surgical only.** Touch what the fix requires. Don't improve adjacent code,
  reformat, or fix unrelated things you notice — mention those instead.
- **Match the surrounding idiom** — naming, comment density, the way nearby
  files are structured.
- **The design rules are systems, not preferences.** Shape follows D56, scroll
  containment follows D65, hit area follows D66's `tap-target.ts`, and palette
  comes from theme tokens rather than ad-hoc hex. A fix that violates one of
  these will be caught at review; reading the rule first is cheaper.
- **Fetch current library docs** via the `context7` skill before writing against
  a library API. Versions here move.
- **Ask when ambiguous.** Two readings of a requirement means two different
  changes; guessing wastes the whole branch.

If `$additionalGuidelines` were given, treat them as additional constraints.

---

## Step 7: Regenerate what your change invalidated, then run the gates

**Machine-maintained files first** — a stale one fails the suite, and each has
exactly one command:

| If your change… | Run |
| --- | --- |
| changed what DERIVES a value inside a `<!--f:…-->` fence | `pnpm facts` |
| added or removed a machine-checked claim | `pnpm claim-baseline` |
| changed a pinned docs file's length, either way | `pnpm distillation-baseline` |
| added a `docs/decisions/D<n>.md` | `pnpm decisions` |

Two of those fail in **both** directions, so a shrinking file is as red as a
growing one: `claim-baseline.json` reports a file over its count as an
un-ratcheted claim and one under it as a stale number nobody lowered, and
`src/docs-line-cap.test.ts` asserts both "no file over its recorded length" and
"no stale line-count baseline entry". Deleting a superseded paragraph turns the
suite red exactly like adding one.

Never hand-edit a fenced number — the fence is machine-maintained; change what
derives it and regenerate. And prefer **rewording to ratcheting** when a new
claim-lint hit is an artifact rather than a claim: rule 2 matches a number plus
up to two words plus a repository noun, and its `[\d,]*` will swallow a trailing
comma, so `2026-09-02, correcting this line` reads as a claim about "line".
Baselining that spends the ratchet on nothing.

A decision file needs YAML front matter (`id` / `date` / `summary`, plus
`amends` when it narrows an earlier one) **before anything else**, or `pnpm test`
fails at collection. Supersede a wrong decision; never rewrite one.

**Then the four gates, all of which must pass:**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```

**A fifth, conditionally.** If the change touched `infra/` or any of the eight
shared files its program compiles — `src/core/types.ts`, `dates.ts`, `ovdp.ts`,
`inzhur/{parse,dcf,ref}.ts`, `nbu/{date,fair-value}.ts` — the root typecheck does
not read that folder, so run its own:

```bash
cd infra && npm ci && cd .. && pnpm exec tsc --noEmit -p infra
```

(`pnpm exec`, not `npx`: `infra/` declares no TypeScript of its own.) CI runs
this only after the merge, so locally it is yours.

**And `pnpm build` when dependencies moved** — it is the only gate that resolves
through Vite's production `exports` conditions (D110).

Finally, verify in the browser what a test cannot see: if the fix changes
anything visible, look at it, and update the affected route's Status and
checkpoints in `docs/navigation-map/`.

---

## Step 8: `/code-review` — no exemptions

Run `/code-review` on the branch **at the point you would otherwise say "ready
to merge"** (D76). Doing it now, rather than after the owner asks for the merge,
means his go-ahead lands on already-reviewed work and the review can still
change the branch cheaply.

### Name the range, then check what came back

**Pass the range explicitly** — by this step your work is in commits, so a review
that defaults to "the current diff" is looking at a clean tree:

```
/code-review dev...HEAD high
```

**Then verify the findings are about your branch before you act on any of
them.** A review can resolve against a different checkout than you meant —
another worktree, another session's tree, the repository root rather than the
branch — and it will report confidently either way. Two cheap tells:

- **are the findings, as a body, about your change?** Compare with
  `git diff --name-only dev...HEAD`. The tell is the BULK of them describing
  work you never did — a whole review about another branch's feature.
- **does its test count match yours?** A total wildly unlike your own
  `pnpm test` run suggests a different tree — though a review that ran before
  your last commit will differ honestly, so treat this as a prompt to ask, not
  a verdict.

**A single finding about a file outside your diff is not the tell, and
discarding one on that basis is a real way to ship a regression.** The review
range deliberately covers callers and callees: "your new precondition breaks
this other module" names a file you never opened and is exactly right. So does
"you corrected this claim here and the identical claim still stands over there"
— which is how the review of *this skill* found that `docs/plans/README.md`
carried the same NBSP error `CLAUDE.md` had just been fixed for. Both were worth
more than anything inside the diff.

The failure mode is real: across six trial runs of this workflow, every review
that completed — five of five — had resolved against the wrong checkout. But
discard on the WEIGHT of the evidence, and when a review is genuinely
mis-scoped, re-run it scoped to the branch rather than picking through it.
**If you cannot get a valid review, say so and do not merge.** D76 has no
exemptions, and an unreviewed branch reported as reviewed is the one outcome
worse than a slow one.

**Documentation is reviewed too, and that is the point.** This repository's
Markdown carries measured figures and pinned contracts that no test checks —
every defect that motivated D76 was in Markdown, four out of four.

Fix what the review finds, or decline it in writing with the reason. Expect more
than one round — #31's squash-merge (`b607a53`) records six, and the worst thing
they caught would have shipped a toggle that turned a typed «55 694,50» into
₴6 961 812 500 000 000 after three taps. Take figures like that from the commit
body rather than from memory; this one was written here wrong the first time.

`/code-review` does not replace the gates and the gates do not replace it.

---

## Step 9: Squash-merge onto `dev`

`dev` forbids force-push and requires linear history, with no bypass — so the
mechanics are not improvisable. A plain `git merge` authors exactly the merge
commit the ruleset rejects, and it does so locally, after which the push fails
and the history has to be unpicked. Use `--squash`, which stages the work
without creating that commit:

```bash
git switch dev
git pull --ff-only origin dev     # a moved dev fails here, not after the commit
git merge --squash <your-branch>
git commit                        # the body below
git push origin dev
```

The commit body is the permanent record — there is no PR here, so it is the only
place a declined finding can live (D76).

```
fix: <what the change does, not what the issue said>

Closes #<n>.

<what was actually wrong, and why the fix is shaped this way>

DECLINED, with reasons (D76):
- <finding> — <why it was declined>

Decisions: D<n> (<one-line summary>)
```

- **`Closes #<n>` closes the issue on merge**, because `dev` is the default
  branch, and GitHub leaves the commit↔issue link behind. That link is one of
  the reasons D103 chose GitHub Issues at all — do not close the issue by hand
  or by dragging a card (D108).
- **Merge locally, never through the GitHub PR button** — it preserves the PR
  author, and authorship here is pinned to
  `RomanKushyk <romankushyk0@gmail.com>` (D110).
- **No merge commits, ever** — squash only, then push `dev`.
- **No AI attribution** in the message. Plain authorship.

Then run `$additionalSteps` if any were given.

---

## Done

Report briefly:

- what was actually wrong, if it differed from the report;
- what changed, and what proves it (the test name);
- findings declined and why;
- anything you noticed but deliberately did not touch.

If the issue turned out to be **not reproducible**, or **gated on work that is
not startable**, say so plainly and leave it open — that is a real outcome, and
closing it would be the failure.
