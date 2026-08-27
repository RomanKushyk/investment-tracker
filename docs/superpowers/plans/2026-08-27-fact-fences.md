# Fences and the drift test — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A named fence in a Markdown file carries a fact's current value, `pnpm facts` fills every one, and a stale fence fails the suite.

**Architecture:** A pure `rewrite(text, facts)` so the check needs no disk, a thin script that writes, and one test in the existing gate. No document is fenced here — that is [`2026-08-27-fact-adoption.md`](2026-08-27-fact-adoption.md).

**Spec:** [`../specs/2026-08-26-verifiable-documentation-design.md`](../specs/2026-08-26-verifiable-documentation-design.md) § 1. **Depends on** [`2026-08-27-fact-registry.md`](2026-08-27-fact-registry.md) AND on `src/facts/facts.ts` from [`2026-08-27-fact-adoption.md`](2026-08-27-fact-adoption.md)'s Task 1, because the drift test reads the real registry. Their Global Constraints apply unchanged. Two more bind this plan:

- **An unknown key or an unclosed fence is an ERROR, never a silent skip.** A rewriter that ignores what it cannot resolve is how a check stops checking while the suite stays green — this repository has shipped that guard once already.
- **The rewriter is idempotent**, which is what makes the drift test mean anything.

**Branch:** `feat/fact-fences`, squash-merge, `/code-review` before merge (D76).

---

### Task 1: The fence rewriter and the drift test

**Files:**
- Create: `src/facts/fences.ts`, `src/facts/fences.test.ts`, `scripts/facts.ts`
- Modify: `package.json` (one script)

**Interfaces:**
- Consumes: `FACTS` and `renderFact` from Task 1.
- Produces: `rewrite(text: string, facts: Record<string, Fact>): string` — pure, so it is testable without touching disk.

- [ ] **Step 1: Write the failing test**

`src/facts/fences.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { derived } from './registry';
import { rewrite } from './fences';

const TEST_FACTS = { 'a.count': derived(() => 7) };

describe('the fence rewriter', () => {
  it('fills a fence with the fact value', () => {
    expect(rewrite('there are <!--f:a.count-->3<!--/f--> of them', TEST_FACTS))
      .toBe('there are <!--f:a.count-->7<!--/f--> of them');
  });

  it('is idempotent', () => {
    const once = rewrite('x <!--f:a.count-->3<!--/f--> y', TEST_FACTS);
    expect(rewrite(once, TEST_FACTS)).toBe(once);
  });

  it('leaves text with no fences untouched — frozen past tense must survive', () => {
    const frozen = 'PLAN-NOW.md had reached 2,211 lines and carried 51 closed tasks';
    expect(rewrite(frozen, TEST_FACTS)).toBe(frozen);
  });

  it('THROWS on an unknown key rather than skipping it', () => {
    // A rewriter that silently ignores what it cannot resolve is how a check
    // stops checking while the suite stays green.
    expect(() => rewrite('<!--f:nope-->1<!--/f-->', TEST_FACTS)).toThrow(/nope/);
  });

  it('THROWS on an unclosed fence', () => {
    expect(() => rewrite('<!--f:a.count-->3 and then nothing', TEST_FACTS)).toThrow(/unclosed/i);
  });

  it('handles two fences on one line', () => {
    const two = '<!--f:a.count-->1<!--/f--> and <!--f:a.count-->2<!--/f-->';
    expect(rewrite(two, TEST_FACTS)).toBe('<!--f:a.count-->7<!--/f--> and <!--f:a.count-->7<!--/f-->');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/facts/fences.test.ts`
Expected: FAIL — `./fences` does not exist.

- [ ] **Step 3: Write the rewriter**

`src/facts/fences.ts`:

```ts
import { renderFact, type Fact } from './registry';

const OPEN = /<!--f:([a-zA-Z0-9._-]+)-->/g;
const CLOSE = '<!--/f-->';

/** Fill every `<!--f:key-->…<!--/f-->` with its fact's current value. Pure, so
 *  the drift test compares without writing. */
export function rewrite(text: string, facts: Record<string, Fact>): string {
  let out = '';
  let cursor = 0;
  OPEN.lastIndex = 0;
  for (let m = OPEN.exec(text); m !== null; m = OPEN.exec(text)) {
    const [tag, key] = m;
    const fact = facts[key];
    if (!fact) throw new Error(`unknown fact key \`${key}\` — add it to src/facts/facts.ts`);
    const bodyStart = m.index + tag.length;
    const end = text.indexOf(CLOSE, bodyStart);
    if (end === -1) throw new Error(`unclosed fence for \`${key}\``);
    out += text.slice(cursor, bodyStart) + renderFact(fact);
    cursor = end;
    OPEN.lastIndex = end;
  }
  return out + text.slice(cursor);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/facts/fences.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the writer script**

Node cannot import TypeScript, and `rewrite` must not be duplicated in JavaScript
— duplication is the defect this whole design exists to remove. So declare the
runner rather than borrowing one: `tsx` is already present transitively in
`node_modules/.bin`, which makes it a lockfile update away from vanishing.

```bash
pnpm add -D tsx
```

`scripts/facts.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { FACTS } from '../src/facts/facts';
import { rewrite } from '../src/facts/fences';
import { markdownFiles, REPO } from '../src/facts/markdown-files';

let changed = 0;
for (const path of markdownFiles(REPO)) {
  const before = readFileSync(path, 'utf8');
  const after = rewrite(before, FACTS);
  if (after === before) continue;
  writeFileSync(path, after);
  console.log(`updated ${path}`);
  changed += 1;
}
console.log(changed === 0 ? 'every fence was already current' : `${changed} file(s) updated`);
```

Add `"facts": "tsx scripts/facts.ts"` to `package.json` and `pnpm add -D tsx` — it is only transitively on disk today; the brief says why that must not be relied on.

- [ ] **Step 6: Write the drift test**

`src/facts/fences.test.ts` gains one more block — the check that joins the gate:

```ts
import { FACTS } from './facts';
import { markdownFiles, REPO } from './markdown-files';

it('every Markdown fence in the repository is current', () => {
  // The REAL registry, not the fixture above — scanning the tree against a
  // one-key stub would throw on every genuine fence. The gate already runs
  // `pnpm test`, so this needs no new command; `pnpm facts` is the fix.
  const stale = markdownFiles(REPO).filter((p) => {
    const text = readFileSync(p, 'utf8');
    return rewrite(text, FACTS) !== text;
  });
  expect(stale, 'stale fences — run `pnpm facts`').toEqual([]);
});
```

The walk and its SKIP set live inside `src/docs-line-cap.test.ts` today, and two
copies would drift. Move them to `src/facts/markdown-files.ts` VERBATIM —
`REPO`, `SKIP` and `markdownFiles(dir)`, keeping the comment on why each
directory is skipped — then import them from both callers and delete the local
copies. `docs-line-cap.test.ts`'s assertions do not change; run it before and
after and confirm it scans the same number of files.

- [ ] **Step 7: Prove the drift test bites**

No fences exist in the tree yet, so make one to break: put
`<!--f:app.colorSlots-->999<!--/f-->` in any Markdown file, run
`pnpm vitest run src/facts/` and confirm it FAILS naming that file, run
`pnpm facts` and confirm it corrects to 4 and passes, then revert the fence.

- [ ] **Step 8: Full gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
git add src/facts/ scripts/facts.ts package.json
git commit -m "feat: fences carry a fact's current value, and a stale one fails the suite"
```

---

---

---

## Done when

- `pnpm facts` fills every fence and changes nothing on a second run; an unknown key and an unclosed fence each throw with the key named.
- A stale fence fails `pnpm test`, naming the file, and frozen past-tense prose is untouched.
- `markdownFiles` has ONE definition, and `docs-line-cap.test.ts` scans the same count of files as before.

Then continue with [`2026-08-27-fact-adoption.md`](2026-08-27-fact-adoption.md).
