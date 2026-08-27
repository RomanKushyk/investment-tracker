# Schema parity, and the header's knowledge — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Drizzle schema and the app's model cannot silently diverge, and none of the 375 comment lines that generation deletes is lost.

**Architecture:** `src/core/types.ts` stays **independent** of the schema until W7 — the app has no database, and deriving domain types from an unapplied schema is the tail wagging the dog. A parity test covers the seam that independence leaves. The old SQL header's knowledge splits by kind: contracts go where the code is, migration translations become a reference doc, the changelog goes to git.

**Tech Stack:** `drizzle-orm`, vitest.

**Spec:** [`../specs/2026-08-26-verifiable-documentation-design.md`](../specs/2026-08-26-verifiable-documentation-design.md) § 5.

**Depends on:** [`2026-08-26-drizzle-schema-source.md`](2026-08-26-drizzle-schema-source.md), whose Global Constraints apply here unchanged and are not repeated.

**Branch:** `infra/schema-parity`, squash-merge, `/code-review` before merge (D76).

---

### Task 1: Parity between the schema and the app's model

**Files:**
- Create: `src/core/model-parity.test.ts`

**Interfaces:**
- Consumes: `asset`, `transaction` from `infra/schema/user.ts`; `TxType` from `src/core/types.ts`; `COLOR_KEYS` from `src/core/colors.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// `src/core/types.ts` is INDEPENDENT of the schema until W7. This test covers the
// seam that independence leaves: names, nullability, enum values and key order.
// Three of A51's review findings were exactly these.
import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { asset, transaction } from '../../infra/schema/user';
import { COLOR_KEYS } from './colors';
import type { TxType } from './types';

const SQL = readFileSync('infra/migrations/drafts/003_user_schema.sql', 'utf8');

/** The quoted values inside a named `CHECK (... IN (...))` in the generated SQL. */
function checkValues(constraint: string): string[] {
  const m = new RegExp(`"?${constraint}"?[^(]*CHECK\\s*\\([^)]*IN\\s*\\(([^)]*)\\)`, 'i').exec(SQL);
  if (!m) throw new Error(`no CHECK named ${constraint} in the generated SQL`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('the schema agrees with the app model', () => {
  it('accepts every TxType the app can produce, under the spec name', () => {
    // The app's `dividend_accrual` is the spec's `dividend_payout`; every other
    // name is shared. A new TxType with no counterpart fails here.
    const appTypes: TxType[] = ['buy', 'sell', 'deposit', 'withdrawal', 'dividend_accrual',
      'interest_payout', 'reinvest', 'redemption', 'tax'];
    const mapped = appTypes.map((t) => (t === 'dividend_accrual' ? 'dividend_payout' : t));
    expect(new Set(checkValues('transaction_type_ck'))).toEqual(new Set(mapped));
  });

  it('makes required app fields NOT NULL', () => {
    // `Asset` declares these four required. A nullable column here is how the
    // first draft of the DDL was wrong.
    const byName = Object.fromEntries(
      Object.values(getTableColumns(asset)).map((c) => [c.name, c]),
    );
    for (const name of ['expected_pct', 'target_pct', 'payout_schedule', 'first_purchase']) {
      expect(byName[name].notNull, `${name} must be NOT NULL`).toBe(true);
    }
  });

  it('bounds color_slot by the real palette', () => {
    // COLOR_KEYS has four entries and new assets cycle `% 4`. A bound above that
    // admits an unpainted chart series, silently.
    expect(SQL).toContain(`color_slot" < ${COLOR_KEYS.length}`);
  });

  it('leads every per-user primary key with user_id', () => {
    for (const table of [asset, transaction]) {
      const pk = getTableConfig(table).primaryKeys[0];
      expect(pk.columns[0].name).toBe('user_id');
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/core/model-parity.test.ts`
Expected: PASS, 4 tests.

If `checkValues` throws, the regex does not match Drizzle's emitted form — read the generated
SQL and adjust the pattern, not the schema.

- [ ] **Step 3: Feed each assertion a real divergence**

```bash
# nullability
# drop `.notNull()` from asset.expectedPct in infra/schema/user.ts, then:
out=$(mktemp -d)
DRIZZLE_OUT=$out pnpm drizzle-kit generate --config=infra/drizzle.config.ts --name=user_schema
cp "$out"/*.sql infra/migrations/drafts/003_user_schema.sql
pnpm vitest run src/core/model-parity.test.ts   # expect FAIL on expected_pct
git checkout -- infra/schema/user.ts infra/migrations/drafts/003_user_schema.sql
```

`DRIZZLE_OUT` and the explicit copy match `infra/src/schema-generated.test.ts`'s shape: `out` is
a fresh temp dir per run (`infra/drizzle.config.ts` mints one itself when the env var is unset),
so the committed file only changes when this copy step runs it over.

Repeat for the palette bound (change `< 4` to `< 32` in the schema's check) and for the key
order (put `id` before `userId` in `asset`'s `primaryKey`). Each must fail its own assertion and
no other. Restore after each.

- [ ] **Step 4: Commit**

```bash
git add src/core/model-parity.test.ts
git commit -m "test: the schema and the app model cannot silently diverge"
```

---

### Task 2: Relocate the header's knowledge

**Files:**
- Modify: `infra/schema/user.ts`
- Create: `docs/reference/w7-migration-translations.md`
- Modify: `infra/migrations/drafts/README.md`, `docs/README.md`

The hand-written SQL carried **375 comment lines for 107 of DDL** (494 total, 12 blank).
Generation deletes them, so the knowledge must land first — and generation is the moment to
distil it rather than move it wholesale.

- [ ] **Step 1: Move the six migration translations to a reference doc**

Create `docs/reference/w7-migration-translations.md` holding, verbatim from the old header:

1. ids are slugs today and the schema says UUID — the remap spans `asset.id`,
   `transaction.id`, `transaction.asset_id`, `user_price.asset_id` and every snapshot quote key;
2. `assetId` is `''` on the seed's portfolio rows and NULL in SQL;
3. `deposit`/`withdrawal` rows carry a REAL asset id in the app and must be NULLed;
4. `Asset.inzhur.units` is the only place unit counts exist and the only seed for
   `transaction.quantity`;
5. `Snapshot.cash` has no column and no decided home — see `PLAN-OPEN.md` O31;
6. timestamps exist in three incompatible encodings and `TIMESTAMPTZ` resolves a zoneless
   literal against the session zone.

These describe data the schema will meet at W7, which is why they outlive the file they were
written in.

- [ ] **Step 2: Move the contracts into the schema file**

Contracts 1-6 become comments in `infra/schema/user.ts`, each above the table or column it
governs rather than in one block at the top. Drop anything that restates its own code — a
`check('...', sql\`${t.amount} > 0\`)` needs no comment saying amounts are positive.

- [ ] **Step 3: Delete the review-findings changelog**

The old header ended with a list of what earlier drafts got wrong. Git holds that history, and
an artifact is not a changelog. It does not travel.

- [ ] **Step 4: Update the folder README**

`infra/migrations/drafts/README.md`: the SQL is **generated**, `infra/schema/user.ts` is the
source, and a hand edit fails `schema-generated.test.ts`. Remove the inline-UNIQUE rule —
generation enforces it. Keep the ASYNC rule, repointed at `infra/schema/user.ts`: nothing
converts a plain `CREATE INDEX` to `ASYNC` at promotion, and the `// … ASYNC on DSQL` comments
above `asset_user_created` and `transaction_user_date` are the only place that conversion is
still recorded.

> **Incomplete as executed (D99, 2026-08-27).** Promotion rewrites an index line TWICE —
> `ASYNC` in AND `USING btree` out, which DSQL rejects outright — and the quoted comments
> were rewritten to name both halves, so the `// … ASYNC on DSQL` text above no longer
> exists. `infra/src/user-schema.test.ts`'s header is a second place the conversion is
> recorded. Annotated here and in `2026-08-26-drizzle-schema-source.md` together: both
> closed plans carried the same half-rule, and annotating one would have made the policy
> unreadable.

- [ ] **Step 5: Index the new reference doc**

`docs/README.md`'s Reference table gains a row for `w7-migration-translations.md`. An index that
does not list a file is how a body becomes unreachable.

- [ ] **Step 6: Full gate and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
git add -A
git commit -m "docs: the schema header's knowledge moves to where it belongs"
```

---

## Deferred, deliberately

Spec § 5 also has `ledger.md`'s column tables generated from the schema — the third copy. That
needs the fact-generator from spec step 2, which does not exist yet, so it is ordered after it
rather than forgotten. Until then `ledger.md` stays hand-written and is the one remaining
transcription of the model.

## Done when

- `model-parity.test.ts` fails on a nullability, enum, palette-bound or key-order divergence, and each failure names its own assertion.
- Every one of the six migration translations is findable from `docs/README.md`.
- `infra/schema/user.ts` carries no comment that restates its own code.
- The full gate is green.
