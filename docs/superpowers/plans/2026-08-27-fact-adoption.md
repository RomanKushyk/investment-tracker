# The first facts, and adopting them — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The counts that measurably drifted stop being written by hand, in every live document that states them.

**Architecture:** `src/facts/facts.ts` holds the registry's contents; every live citation becomes a fence. No document is restructured and no prose changes beyond the number itself.

**Spec:** [`../specs/2026-08-26-verifiable-documentation-design.md`](../specs/2026-08-26-verifiable-documentation-design.md) § 1.

**Depends on:** [`2026-08-27-fact-registry.md`](2026-08-27-fact-registry.md) and [`2026-08-27-fact-fences.md`](2026-08-27-fact-fences.md), whose Global Constraints apply unchanged and are not repeated.

**Branch:** `docs/fact-adoption`, squash-merge, `/code-review` before merge (D76).

## What is live, and what is frozen

Measured 2026-08-27. **`docs/archive/` and `docs/decisions/` are FROZEN** — the archive records how things were and a decision is immutable, so a fence in either would rewrite history.

**A statement is fenced; an argument is not.** "Plan A: 53 closed tasks" states the
value. "Moving `4/174/18` means…" and O31's "May the seed's pinned row count
`4/174/18` move?" argue ABOUT it being pinned — a fence there lets the argument
rewrite itself when the answer lands, and O31 answers its own question. Surveyed
2026-08-27: almost every seed citation argues, which is why most are excluded here.

| Fact | Value | Fence exactly these |
|---|---|---|
| `plan.closedTasks` | 53 | `docs/README.md:114`, `docs/archive/README.md:14`, `docs/plans/PLAN-NOW.md:42` |
| `seed.*` | 4 / 174 / 18 | `navigation-map.md:87` ("4/174/18 + settings"), `docs/navigation-map/routes-2.md:101,121`, `docs/design-briefs/phase-7/s3-s4.md:140`, `docs/plans/O05-O29.md:145`, `docs/plans/W02-W08.md:172` (line 108 argues and stays unfenced — deliberate), `docs/reference/w7-migration-translations.md:12,15,42,46` |

`docs/archive/README.md` is the archive's INDEX, not a record, so it is live. Quoted UI
copy (`routes-2.md`'s "Data imported — 4 assets, …") is left alone — a fence inside a
quoted string makes it ungreppable as the spec of what the app actually renders.

Two known-frozen citations that must NOT be fenced, both true as written:
- `docs/README.md` — "PLAN-NOW.md had reached 2,211 lines and carried 51 closed tasks". Past tense, about a state that no longer exists.
- `docs/decisions/D95.md` — "Plan A's 51 closed tasks left for the archive".

---

### Task 1: The first facts

**Files:**
- Create: `src/facts/facts.ts`
- Modify: `src/facts/registry.test.ts`

**Interfaces:**
- Consumes: `derived`, `measured`, `renderFact`, `type Fact` from `./registry`.
- Produces: `FACTS: Record<string, Fact>`. Task 2 and the fences plan's drift test both import it.

- [ ] **Step 1: Write the facts**

```ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLOR_KEYS } from '../core/colors';
import { SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots } from '../lib/seed';
import { derived, measured, type Fact } from './registry';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const countRows = (p: string, re: RegExp) =>
  readFileSync(join(REPO, p), 'utf8').split('\n').filter((l) => re.test(l)).length;

export const FACTS: Record<string, Fact> = {
  // Cited in three live indexes. It read 51 in one and 53 in two until 2026-08-26.
  'plan.closedTasks': derived(() =>
    countRows('docs/archive/plan-a/README.md', /^\| [A-Z]\d+ \|/)),

  // `4/174/18`, cited in six live files.
  'seed.assets': derived(() => SEED_ASSETS.length),
  // A function, not an array — so the count follows the builder.
  'seed.snapshots': derived(() => buildSeedSnapshots().length),
  'seed.transactions': derived(() => SEED_TRANSACTIONS.length),

  'app.colorSlots': derived(() => COLOR_KEYS.length),

  'dpu.observeNbu.window': measured({
    value: 0.25594,
    unit: 'DPU',
    at: '2026-08-26',
    method:
      'EXPLAIN (ANALYZE, VERBOSE) on the 7-day window, warm, 4 runs with the order alternated against the qualified form, median of the aliased form',
    samples: 4,
    reproduce: 'D97; working in infra/docs/replan-a50.md round 2',
  }),
};
```

- [ ] **Step 2: Pin the derivations against what the documents already say**

Append to `src/facts/registry.test.ts`:

```ts
import { FACTS } from './facts';

describe('the first facts', () => {
  it('derives the seed counts D5 and D10 pin', () => {
    // 4/174/18 is a pinned contract, not an incidental total — a change here
    // means the seed moved, which D10 says needs a decision, not a green test.
    expect(renderFact(FACTS['seed.assets'])).toBe('4');
    expect(renderFact(FACTS['seed.snapshots'])).toBe('174');
    expect(renderFact(FACTS['seed.transactions'])).toBe('18');
  });

  it('derives the palette size, and a closed-task count that is actually read', () => {
    expect(renderFact(FACTS['app.colorSlots'])).toBe('4');
    // NOT pinned: it rises every time a task closes. What IS pinned is that the
    // ledger is readable — a regex that stopped matching would return 0 quietly.
    expect(Number(renderFact(FACTS['plan.closedTasks']))).toBeGreaterThan(40);
  });
});
```

- [ ] **Step 3: Run and check the values**

Run: `pnpm vitest run src/facts/`
Expected: PASS. If the seed trio fails, the derivation is wrong, not the seed —
fix `facts.ts`.

- [ ] **Step 4: Full gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
git add src/facts/
git commit -m "feat: the first facts — the counts that drifted"
```

---

### Task 2: Fence every live citation

**Files:** the files named in the table above, and no others.

- [ ] **Step 1: Confirm the survey still holds**

```bash
grep -rn "closed task\|4/174/18" --include=*.md . | grep -vE "node_modules|/archive/|/decisions/"
```

The survey is already done; this only checks nothing new landed since. Every hit
is either in the table or an argument about the value — if one is neither, leave
it alone and name it in your report. An unfenced live citation is a far smaller
problem than a rewritten frozen one.

- [ ] **Step 2: Fence the live ones**

A compact `4/174/18` becomes three fences:

```markdown
<!--f:seed.assets-->4<!--/f-->/<!--f:seed.snapshots-->174<!--/f-->/<!--f:seed.transactions-->18<!--/f-->
```

A table cell keeps its cell: `Plan A: <!--f:plan.closedTasks-->53<!--/f--> closed tasks, …`.

**Watch the line cap.** Fences are verbose and several of these files are near
200 lines. Check `wc -l` on every file you touch; if one crosses, STOP and say so
in your report rather than restructuring the document to fit — that is the
controller's decision, not yours.

- [ ] **Step 3: Verify**

```bash
pnpm facts                 # expect: no files changed — the values were already right
pnpm vitest run src/facts/ # expect PASS
wc -l docs/plans/*.md docs/README.md navigation-map.md docs/navigation-map/routes-2.md docs/design-briefs/phase-7/s3-s4.md docs/reference/w7-migration-translations.md
```

If `pnpm facts` changes a file, the number you fenced was wrong — read what it
wrote and confirm the derivation before touching anything.

- [ ] **Step 4: Prove the mechanism is real, not decorative**

```bash
# add one throwaway row to SEED_TRANSACTIONS in src/lib/seed.ts
pnpm vitest run src/facts/     # expect FAIL — the fenced 18 is stale
pnpm facts                     # every fenced citation becomes 19 at once
git diff --stat                # expect several .md files changed by one number
git checkout -- src/lib/seed.ts docs/ navigation-map.md
pnpm facts && pnpm vitest run src/facts/   # back to 18, green
```

Record the file list `git diff --stat` printed. That list is the answer to "how
many places would have drifted", and it is the point of the whole plan.

- [ ] **Step 5: Full gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
git add docs/ navigation-map.md
git commit -m "docs: the drifting counts are derived in every live citation"
```

---

## Done when

- Every live citation of the two families is fenced; every archive and decision citation is not.
- `pnpm facts` on a clean tree changes nothing.
- Adding one seed transaction fails the suite, and one `pnpm facts` updates every citation.
- No Markdown file crossed 200 lines; anything that came close is named in the report.
