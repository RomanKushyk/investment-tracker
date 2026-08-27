# Drizzle as the schema's single source — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `infra/migrations/drafts/003_user_schema.sql` stops being hand-written and becomes generated from a Drizzle schema, with a test that fails if anyone edits the generated file.

**Architecture:** One source (`infra/schema/user.ts`), one derivation (the SQL). Detecting drift against the app's model and relocating the old header's knowledge are the sibling plan, [`2026-08-26-schema-parity-and-knowledge.md`](2026-08-26-schema-parity-and-knowledge.md), which depends on this one.

**Tech Stack:** `drizzle-orm` + `drizzle-kit` (root devDependencies, beside `@electric-sql/pglite`), vitest.

**Spec:** [`../specs/2026-08-26-verifiable-documentation-design.md`](../specs/2026-08-26-verifiable-documentation-design.md) § 5.

**Why first:** W7's gate opens **2026-09-02**. After it the primary keys are immutable and a wrong one is a DROP/CREATE of live user data. Everything else in the spec is reversible; this is not.

## Global Constraints

- ~~**Aurora DSQL has no foreign keys.** `REFERENCES` is absent from the grammar. Never add one.~~ **Wrong since 2026-08-26 — one day before this plan's own date — discovered 2026-08-27 (D99):** DSQL accepts and enforces composite foreign keys. The schema this plan produced still declares none, which is now a choice — `docs/plans/PLAN-OPEN.md` O34.
- **`CREATE INDEX ASYNC` is DSQL-only** and a syntax error on stock Postgres. Secondary indexes stay plain `CREATE INDEX` in generated output; the `ASYNC` form is hand-authored at promotion, not generated — `--custom` writes stateful `meta/` files this branch keeps out of the repo. **Incomplete as written (D99):** promotion must ALSO strip the `USING btree` drizzle-kit emits, which DSQL rejects outright — inserting `ASYNC` alone still gives a statement the cluster refuses.
- **One DDL statement per transaction, never mixed with DML.** `breakpoints: true` emits `--> statement-breakpoint` for this.
- **Every per-user table leads its primary key with `user_id`.** DSQL's key is index-organised; the order is the access path and it is immutable.
- **UNIQUE constraints are inline** in the table definition, never a later `CREATE UNIQUE INDEX`.
- **The 42 tests in `infra/src/user-schema.test.ts` are the schema's behavioural specification.** They must pass unchanged against the generated SQL. If they fail, the schema is wrong — never edit the test to fit the output.
- Gate per commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`.
- Branch `infra/drizzle-schema-source`, squash-merge, `/code-review` before merge (D76).

---

### Task 1: Drizzle schema that reproduces the current DDL

**Files:**
- Create: `infra/schema/user.ts`
- Create: `infra/drizzle.config.ts`
- Modify: `package.json`, `pnpm-lock.yaml`
- Regenerate: `infra/migrations/drafts/003_user_schema.sql`

**Interfaces:**
- Produces: `appUser`, `account`, `asset`, `transaction`, `userPrice` — exported `pgTable` values from `infra/schema/user.ts`. The sibling plan's Task 1 imports `asset` and `transaction`.

- [ ] **Step 1: Add the dependencies**

```bash
pnpm add -D drizzle-orm drizzle-kit
```

- [ ] **Step 2: Write the config**

`infra/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './infra/schema/user.ts',
  out: './infra/migrations/drafts',
  // DSQL allows one DDL per transaction. Drizzle emits
  // `--> statement-breakpoint` between statements for exactly this.
  breakpoints: true,
});
```

- [ ] **Step 3: Record the baseline the generated schema must hit**

Run: `pnpm vitest run infra/src/user-schema.test.ts`
Expected: PASS, 42 tests.

- [ ] **Step 4: Write the schema**

Translate each table from `infra/migrations/drafts/003_user_schema.sql`. `app_user` is the
pattern — every column, CHECK and UNIQUE in the SQL gets a counterpart, keeping the SQL's exact
constraint names so the review diff stays readable:

```ts
import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const appUser = pgTable('app_user', {
  userId: uuid('user_id').notNull(),
  email: text().notNull(),
  status: text().notNull(),
  role: text().notNull(),
  dataVersion: bigint('data_version', { mode: 'number' }).notNull().default(0),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
}, (t) => [
  primaryKey({ columns: [t.userId] }),
  unique('app_user_email_uq').on(t.email),
  check('app_user_status_ck', sql`${t.status} IN ('pending', 'active', 'rejected')`),
  check('app_user_role_ck', sql`${t.role} IN ('user', 'super_admin')`),
  check('app_user_decided_ck',
    sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL AND ${t.decidedBy} IS NULL)`),
]);
```

`account`, `asset`, `transaction` and `userPrice` follow in the same shape. All four lead their
primary key with `userId`; `userPrice`'s is
`primaryKey({ columns: [t.userId, t.assetId, t.asOf] })`. `asset.colorSlot` is
`smallint('color_slot').notNull()`; every money and quantity column is `numeric()`, never a
float.

- [ ] **Step 5: Generate, replacing the hand-written file**

```bash
rm infra/migrations/drafts/003_user_schema.sql
pnpm drizzle-kit generate --config=infra/drizzle.config.ts --name=user_schema
mv infra/migrations/drafts/0000_user_schema.sql infra/migrations/drafts/003_user_schema.sql
```

Do not hand-edit the emitted SQL. If it is wrong, the schema is wrong.

- [ ] **Step 6: Run the behavioural suite against the generated schema**

Run: `pnpm vitest run infra/src/user-schema.test.ts`
Expected: PASS, 42 tests, unedited.

A failure names the constraint the Drizzle definition is missing. Fix `infra/schema/user.ts`,
regenerate, run again.

- [ ] **Step 7: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`
Expected: all pass, 864 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml infra/schema/user.ts infra/drizzle.config.ts infra/migrations/drafts/003_user_schema.sql
git commit -m "infra: the user schema is defined in Drizzle and the SQL is generated from it"
```

---

### Task 2: The generated SQL cannot be hand-edited

**Files:**
- Create: `infra/src/schema-generated.test.ts`

**Interfaces:**
- Consumes: `infra/drizzle.config.ts` and the committed `003_user_schema.sql` from Task 1.

- [ ] **Step 1: Write the test**

```ts
// The committed SQL is an artifact, not a source. A hand edit is silently
// discarded by the next `drizzle-kit generate`, so it must fail here instead,
// where someone sees it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('regenerating the schema reproduces the committed SQL', () => {
  const out = mkdtempSync(join(tmpdir(), 'drizzle-'));
  execFileSync(
    'pnpm',
    ['drizzle-kit', 'generate', '--config=infra/drizzle.config.ts', `--out=${out}`, '--name=user_schema'],
    { stdio: 'pipe', shell: process.platform === 'win32' },
  );
  const fresh = readFileSync(join(out, '0000_user_schema.sql'), 'utf8');
  const committed = readFileSync('infra/migrations/drafts/003_user_schema.sql', 'utf8');
  expect(fresh.trim()).toBe(committed.trim());
});
```

- [ ] **Step 2: Run it on a clean tree**

Run: `pnpm vitest run infra/src/schema-generated.test.ts`
Expected: PASS.

- [ ] **Step 3: Feed it a defect**

```bash
echo "-- stray edit" >> infra/migrations/drafts/003_user_schema.sql
pnpm vitest run infra/src/schema-generated.test.ts   # expect FAIL
git checkout -- infra/migrations/drafts/003_user_schema.sql
```

A guard never fed a defect is a guard nobody knows the shape of; this repository has already
shipped one that went blind and stayed green.

- [ ] **Step 4: Commit**

```bash
git add infra/src/schema-generated.test.ts
git commit -m "infra: the generated schema fails the suite if it is hand-edited"
```

---

## Done when

- `infra/schema/user.ts` is the only place a column, constraint or key is declared.
- `003_user_schema.sql` is generated, and appending one line to it fails the suite.
- `user-schema.test.ts` passes 42 tests, unedited.
- The full gate is green at 865 tests.

Then continue with [`2026-08-26-schema-parity-and-knowledge.md`](2026-08-26-schema-parity-and-knowledge.md).
