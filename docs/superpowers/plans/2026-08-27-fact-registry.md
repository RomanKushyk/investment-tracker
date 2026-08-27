# The fact registry — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fact that can be computed from the repository is computed, never written by hand; a fact that was measured carries its method and sample count in a type that will not let you omit them.

**Architecture:** The registry module alone — two constructors, `derived` for what the tree can compute and `measured` for what it cannot, plus one renderer. It ships holding NO facts and touching no document. The rewriter that consumes it is [`2026-08-27-fact-fences.md`](2026-08-27-fact-fences.md); the facts themselves are [`2026-08-27-fact-adoption.md`](2026-08-27-fact-adoption.md).

**Tech Stack:** TypeScript, vitest. No new dependencies.

**Spec:** [`../specs/2026-08-26-verifiable-documentation-design.md`](../specs/2026-08-26-verifiable-documentation-design.md) § 1.

**Why `src/facts/` and not `docs/`:** `src/docs-line-cap.test.ts` already lives in `src/` while being entirely about `docs/`, and the root `tsconfig.json` includes only `src` and `vite.config.ts`. Tooling that reads the repository follows that precedent. Test files are not bundled, so nothing reaches the shipped app.

## Global Constraints

- **`measured` requires `value`, `unit`, `at`, `method`, `samples` and `reproduce`**, all non-optional. `samples` is the point: a single cold reading has to declare `samples: 1` at the moment of writing, which is what the discarded "9.1× faster" never had to.
- **A derivation is never fixed by editing the document it disagrees with.** If a fact returns a number the docs do not state, the derivation is what is wrong until proven otherwise.
- No Markdown file over 200 lines (`src/docs-line-cap.test.ts`).
- Gate per commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`. The suite is 868 tests.
- Branch `feat/fact-registry`, squash-merge, `/code-review` before merge (D76).

---

### Task 1: The registry

**Files:**
- Create: `src/facts/registry.ts`, `src/facts/facts.ts`, `src/facts/registry.test.ts`

**Interfaces:**
- Produces: `derived(fn)`, `measured(spec)`, `renderFact(f)`, `type Fact`, and `FACTS: Record<string, Fact>`. The fences plan imports `FACTS` and `renderFact`.

- [ ] **Step 1: Write the failing test**

`src/facts/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { derived, measured, renderFact } from './registry';

describe('the registry', () => {
  it('renders a derived fact from its function', () => {
    expect(renderFact(derived(() => 53))).toBe('53');
  });

  it('renders a measured fact as value and unit', () => {
    const f = measured({
      value: 0.25594, unit: 'DPU', at: '2026-08-26',
      method: 'EXPLAIN (ANALYZE, VERBOSE), warm, order alternated',
      samples: 8, reproduce: 'infra/scripts/replan.mjs',
    });
    expect(renderFact(f)).toBe('0.25594 DPU');
  });

  it('refuses samples below one — the type says `number`, which allows zero', () => {
    expect(() =>
      measured({ value: 1, unit: 'DPU', at: '2026-08-26', method: 'x', samples: 0, reproduce: 'y' }),
    ).toThrow(/samples/);
  });

  it('refuses a date that is not ISO', () => {
    const bad = { value: 1, unit: 'DPU', at: '26 Aug 2026', method: 'x', samples: 1, reproduce: 'y' };
    expect(() => measured(bad)).toThrow(/at/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/facts/registry.test.ts`
Expected: FAIL — `./registry` does not exist.

- [ ] **Step 3: Write the registry**

`src/facts/registry.ts`:

```ts
/**
 * Two kinds, because they rot differently. DERIVED is computable from the tree
 * now, so it is never written by hand. MEASURED came from outside and cannot be
 * recomputed, so it carries how it was taken.
 */
export type Fact =
  | { kind: 'derived'; compute: () => string | number }
  | {
      kind: 'measured';
      value: number;
      unit: string;
      at: string;
      method: string;
      /** How many readings. ONE is a legitimate answer and a visible one. */
      samples: number;
      reproduce: string;
    };

export const derived = (compute: () => string | number): Fact => ({ kind: 'derived', compute });

export function measured(spec: Omit<Extract<Fact, { kind: 'measured' }>, 'kind'>): Fact {
  // The type says `number` and `string`; these two values are what the type
  // cannot say. `samples: 0` and a prose date both typecheck.
  if (!Number.isFinite(spec.samples) || spec.samples < 1) {
    throw new Error(`measured fact needs samples >= 1, got ${String(spec.samples)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.at)) {
    throw new Error(`measured fact needs an ISO date in \`at\`, got ${String(spec.at)}`);
  }
  return { kind: 'measured', ...spec };
}

export const renderFact = (f: Fact): string =>
  f.kind === 'derived' ? String(f.compute()) : `${f.value} ${f.unit}`;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/facts/registry.test.ts`
Expected: PASS, 4 tests. There are no facts yet — the registry is the mechanism,
and what it holds is the next plan.

- [ ] **Step 5: Full gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
git add src/facts/
git commit -m "feat: a registry for facts the repository states about itself"
```

---

## Done when

- `derived` and `measured` render, and `renderFact` is the only way a fact becomes text.
- `measured` throws on `samples < 1` and on a non-ISO `at` — the two things its type cannot say.
- Nothing reads or writes a document, and `FACTS` does not exist yet.

Then continue with [`2026-08-27-fact-fences.md`](2026-08-27-fact-fences.md).
