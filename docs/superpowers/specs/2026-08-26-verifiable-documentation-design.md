# Verifiable documentation — design

Scope: why this repository's prose keeps making false factual claims, and the mechanism that
stops it. Drafted 2026-08-26, after three tasks — A50, A51 and the W7 plan edits — went through
repeated `/code-review` passes, from which **39 distinct findings** were classified.

> **Evidence status.** Every figure in `## The problem, measured` was measured against the
> working tree on 2026-08-26. The 39 and their classification are a judgement over review
> output, not a measurement — findings recurred across passes and were deduplicated by hand, so
> a second reader could score them differently. No total of findings-as-raised is claimed: that
> number was not recorded as the passes ran. Under step 2 these figures become derived facts and
> this table generates itself; until then the commands are in the commit that introduced it.

## The problem, measured

| | |
|---|---|
| Markdown | 21,960 lines |
| Code, non-test | 22,810 lines |
| Decisions | 97, of which **55 carry numeric or measured data**, 22 carry tables |
| Numeric claims in prose | 499 |
| Exclusivity claims ("only", "nothing reads") | 94 |
| Sentences repeated across 2+ files | 72, in 247 instances |
| `003_user_schema.sql` | 494 lines, **375 comment (75%)**, 12 blank, 107 DDL |

Of the 39, **29 share one mechanism**: a statement of fact that nothing in the repository
checks. The remaining ten are a measurement-method class and a genuine-design class.

| Class | Count | Example |
|---|---|---|
| Claim about code the code contradicts | 11 | "`Transaction.source` is write-only" — a form Select writes it, `csv.ts` exports it |
| Drift between files | 10 | 51 / 52 / 53 closed tasks in three indexes |
| Contradiction inside one document | 8 | "the ONE divergence", where there were two |
| Measurement method | 6 | a 9.1× win that was first-parse warmup |
| Real design error | 4 | surrogate primary keys |

Backend work concentrates the damage: a false frontend claim usually breaks a test, while
backend claims describe query plans, DPU cost and a live cluster that no test touches — and SQL
is strings, so TypeScript does not help either.

## Root cause

Diátaxis: reference is austere description (tables, facts); explanation is narrative (why).
Mixing them "obscures the reference material and prevents the explanation from being developed".
ADR practice: a decision record is immutable, single-purpose, and must timestamp time-sensitive
data.

This repository fused the two and then applied immutability to the fusion. **A perishable fact
inside an immutable document is a guaranteed future lie** — which is exactly D91's `0.356 DPU`:
stated in the present tense inside a document the repo forbids editing, so when it failed to
reproduce it could only be annotated around, not corrected.

The same error of criterion produced the drift class: D95 splits files by **size** (200 lines)
where Diátaxis splits by **purpose**. Size-driven splits manufactured the range files whose
duplicated counters are class 2, and 247 repeated sentences, mostly split boilerplate.

## Design

### 1. Reference layer

Two kinds of perishable fact, one registry, in `docs/reference/facts/`.

**Derived** — computable from the repo now (counts, inventories, who-reads-what), never written
by hand. **Measured** — from an external system at a point in time, with fields the type makes
mandatory:

```ts
'app.colorSlots': derived(() => COLOR_KEYS.length),

'dpu.observeNbu.window': measured({
  value: 0.25594, unit: 'DPU', at: '2026-08-26',
  method: 'EXPLAIN (ANALYZE, VERBOSE), warm, 4 runs, order alternated',
  samples: 8, reproduce: 'infra/scripts/replan.mjs',
}),
```

`samples` is the safeguard: the discarded 9.1× would have had to declare `samples: 1` at the
moment of writing.

Documents carry the value inline, machine-maintained:

```markdown
Measured <!--f:dpu.observeNbu.window-->0.25594 DPU<!--/f--> on a warm cluster.
```

Claims of **absence** ("AWS documents it in neither direction") are not facts and take no key.

### 2. Claim lint

1. Bare numbers of measured shape (`DPU`, `ms`, `×`, `%`) outside a fence fail. Fenced code
   blocks are exempt — a pasted plan is evidence, not a claim.
2. Bare counts of repository things outside a fence fail.
3. An absolute **that names a code identifier** must cite a fact. `Never add a VPC` and
   `the app's ONE scroll surface` are design intent and pass; `nothing reads
   `Transaction.source`` does not.

The lint reads `.md`, `.sql` and comment blocks in `.ts` — the worst claims were in comments,
not documents.

Escape hatch: `<!--unchecked: reason-->`, which is greppable, so the count of unchecked claims
is itself a derived fact.

Existing prose rides a **ratchet**: `claim-baseline.json` holds per-file counts; exceeding one
fails, and so does a stale baseline after a file improves.

### 3. The 97 decisions

ADR practice permits **amendment**. Three actions, none a rewrite:

1. Each number gains its own date plus a forward link:
   `Measured 2026-08-25: 0.356 DPU (current: `dpu.observeNbu.window`)`. Frozen history stays
   frozen; the live value is a link.
2. `docs/decisions/README.md` becomes generated from per-file front matter
   (`id`, `date`, `title`, `supersedes`, `superseded_by`). It is a table about documents —
   reference about explanation — and hand-maintaining it produced a two-cell row in a
   three-column table.
3. Front matter lands across all 97 in ONE pass, not by ratchet: the index cannot be generated
   until every file carries it, so a partial pass buys nothing. Extraction is mechanical but
   per-file (each `supersedes` relation is stated in prose, differently each time), which is
   what makes it a fan-out rather than a script. The generated index must reproduce the current
   one's content before it replaces it — that equality is the pass's acceptance test.
   The 55 perishable numbers stay on the ratchet; only the metadata is one pass.

No decision is merged or deleted: numbers are cited bare from code, and a reason outlives its
decision. 97 stays 97.

### 4. Distillation

| Carrier | States |
|---|---|
| Code | what it does |
| Fact registry | how many, which, who |
| Prose | why, and what was rejected |

Mechanical: repeated sentences (ratchet; boilerplate that must repeat becomes a generated
block), comment density per file (ratchet, not a cap — a cap yields worse comments, not fewer),
and history-in-the-artifact ("the first draft", "review found"), which git already holds.

Editorial, and stated as such: would a reader act differently for knowing this? If not, cut.
High density is a **diagnostic** — where cutting would be wrong, the knowledge has no home and
the fix is architectural.

### 5. Schema

`infra/schema/*.ts` in Drizzle becomes the single source; `drizzle-kit generate` writes to a
temp dir and the result is copied over `drafts/003_user_schema.sql`, without applying it, and
`ledger.md`'s column tables are generated. Three copies become one source and two derivations.

DSQL divergence: the `ASYNC` index DDL is hand-authored at promotion, not generated — `--custom`
writes into `out` and appends `meta/_journal.json`, which this branch deliberately keeps out of
the repo; one-DDL-per-transaction is the `breakpoints` config flag rather than a paragraph of
prose.

`src/core/types.ts` stays **independent** until W7 — the app has no database, and deriving domain
types from an unapplied schema is the tail wagging the dog. The remaining seam is covered by
`model-parity.test.ts` (field names after case mapping, nullability, enum values), which
<!--unchecked: counterfactual; the test does not exist yet-->would have caught three of the
schema findings.

Rule: **generate where there is one owner; verify where two models must coexist.**

### 6. Splitting and the gate

The 200-line cap becomes a diagnostic, not a rule — a file over it holds more than one purpose,
and the fix is to find the second purpose. Live plans split by **section**, as the archive
already does, not by ID range.

Everything new is a vitest test, not an npm script: `facts`, `claims`, `prose`,
`model-parity`, `schema-generated`. The gate already runs `pnpm test`, and CI runs `infra/src`
since A50. Five new commands would be five things to forget.

Generators are code and can be wrong — `order-by-alias.test.ts` went blind on one unpaired
backtick and stayed green. **Each generator carries its own behaviour tests**, fed a defect to
prove it fails.

## What this does not solve

The four real design errors — the surrogate primary keys, `LIMIT` as a remedy for a `Sort` —
sit outside the 29 and are caught by review, not by mechanism. Review did catch them. Nothing
here replaces that, and D76 stays as it is.

Nor does it make a wrong generator impossible. It moves that risk to where review sees it once,
instead of prose that rots silently.

## Order of work

**Schema goes first, and the reason is a date.** W7's gate opens 2026-09-02; after it the
primary keys are immutable and a wrong one is a DROP/CREATE of live user data rather than a
migration. Everything else here is reversible at any time, so it yields.

1. **Drizzle + parity test** — before W7. The only item with a deadline.
2. Reference layer + `facts.test.ts`. Everything below depends on it.
3. Decisions front matter (one pass) + generated index.
4. Claim lint + baseline.
5. Distillation ratchets.
6. Splitting rule; retire the hard cap.

Steps 2-6 have no gate and can stop between any two without leaving the repository worse than
it is now — the property that makes this order safe to interrupt.
