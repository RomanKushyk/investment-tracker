# Decisions — the rules of the log

> The index is [`README.md`](README.md), and it is nothing but the index now:
> a title, this pointer, and three generated tables. **O35 split them on
> 2026-08-28 (D102)** — that file is both a folder README and a machine-written
> list that grows one line per decision, and the two purposes were fighting
> over a 200-line diagnostic. Everything below moved here unchanged EXCEPT for
> four re-anchorings, named so the claim can be checked: the appending rule
> (D102 reverted D99's second command), the heading "How the tables below are
> generated" → "How the index's tables are generated", "the rows below are
> GENERATED" → "the rows in `README.md` are GENERATED", and "the table below" →
> "the index's table". Everything that said "below" had to stop, because the
> tables are no longer below.

## Rules

- **Append-only, and appending now means creating a file — WITH front matter.**
  A new decision is a new `D<n>.md`, carrying front matter (below) before any
  prose, then `pnpm decisions` to regenerate its row. **One command** — for
  two days after D99 it took two, because the index had crossed 200 lines and
  was pinned at its own length, so every entry moved it; D102 made the cap
  count AUTHORED lines only and the second command went away. Skip the front
  matter
  and `readDecisions` throws, naming the file — `pnpm test` fails with it, not
  silently. **D96 retired the range files** (`D01-D20.md` … `D81-D100.md`) on
  2026-08-26 for exactly that reason: the old rule sent every entry to the
  highest-numbered file, and a 200-line cap made that file overflow on its
  fourth entry. Both historical slips — `D41-D50.md` holding D41–D60,
  `D61-D80.md` holding D81–D83 for a day — were one failure, a filename
  asserting a range it did not hold, and neither is possible now.
- **Moving is not rewriting.** All 95 entries moved verbatim into their own
  files and were verified byte-identical. **Numbers never change** — ~20
  citations across `src/` and `docs/` are by bare number. Tidying or renumbering
  in transit is the one thing that breaks callers.
- **Never rewrite a decision — supersede it.** A wrong entry stays, and a newer
  one says what replaced it and why. `D43` is the worked example: the original
  diagnosis is kept directly under its replacement, labelled, because being
  wrong about *which* of five explanations held is the reusable lesson.
  **The front matter is not the entry.** `id`/`date`/`summary`/`amends` were
  added on 2026-08-27 to generate the index's table; correcting a `summary` that
  says something the entry does not is a metadata fix, not a rewrite. The prose
  under the heading is what may never change.
- **A contract change requires an entry.** Pinned contracts in
  `../archive/BUILD-PLAN.md` and `../plans/NEXT-PHASE-PLAN.md` stay binding
  until a decision here supersedes them.
- Entries are numbered, never renumbered. Code comments cite `D5`, `D30` and so
  on by bare number — those citations must keep resolving forever.

**One file per decision, named as it is cited.** `D5` is [`D5.md`](D5.md); D96
opened [`D96.md`](D96.md) by existing. The range files `D01-D20.md`,
`D21-D40.md`, `D41-D50.md`, `D61-D80.md` and `D81-D100.md` were retired on
2026-08-26 — **D96** says why, and their entries moved verbatim.

## How the index's tables are generated

**Every decision file carries YAML front matter — `id`, `date`, `summary`, optional
`amends` — and the rows in [`README.md`](README.md) are GENERATED from it. Never hand-edit
a row: change the file's `summary`, then run `pnpm decisions`.** Rows sit between markers,
one pair per table:

```
<!-- decisions:rows range="1-20" -->
| [D1](D1.md) | Tech stack: use `package.json` as-is | 2026-07-27 |
<!-- /decisions:rows -->
```

`date` must be a real ISO calendar date (`YYYY-MM-DD`); a literal `|` inside `summary` or
`index_extra_row` must be written `\|`, or it silently adds a table column — both are
validated, and `pnpm decisions` throws naming the file if either is wrong. `amends` is a
flat list of ids; see `src/decisions/frontMatter.ts`'s module docstring for why not
`supersedes`, and why the reciprocal `amended_by` is derived, never stored.

## The ones worth reading before touching anything

- **D5** — reference-data reconciliation. Read before touching seed data or any
  derivation; every figure in the app is derived, none is hard-coded.
- **D2** — persistence is Dexie on IndexedDB, and the app is still local.
- **D13 / D18** — the dual metric families. Consult with
  `../reference/FORMULA-AUDIT.md` before changing `core/derive.ts` or
  `core/xirr.ts`.
- **D30** — the observation key. Immutable on DSQL: a wrong key is a
  DROP/CREATE of a live archive, not a migration.
- **D45 / D47** — alerts do not go to email, and that is deliberate. Do not
  "fix" it by adding an SNS topic.

## A pattern these entries kept finding

D43, D44, D48, D49, D50, D53, D89 and D91 are eight independent instances of one defect:
**a green indicator that was green because nothing had been attempted.** A dead
alert channel with zero failed notifications, a backfill whose result nobody
read, an archive with deletion protection and no backup, an insert counter that
could not tell a re-run from a re-write, in D53 a failure handler that published no datapoint at all inside the very check written to catch this, in D89 fifteen recovery points that nothing stopped anyone deleting, and in D91 a two-branch query verified on one branch. When adding a check, ask what it reads
when the thing it watches has stopped entirely — if the answer is "the same as
healthy", the check is not one.
