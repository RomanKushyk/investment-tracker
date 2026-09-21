-- 008 — the demo owns an account (W7)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- WHY A LATER FILE AND NOT AN EDIT OF 005. NOT THE LEDGER: keying by statement
-- content hash is what makes APPENDING to an applied file the supported shape —
-- the existing statement hashes the same, is skipped, and only the new one runs.
-- `006` states that rule and `ensureLedger` repeats it. What does break is
-- WIDENING a statement already sent, which is why `007` is a file of its own.
-- The reason here is plainer: `005` is the demo's IDENTITY, asserted to hold that
-- one statement and no account (`migrate.test.ts`), and this row is a different
-- change — so it takes a file, and a ledger entry, of its own.
--
-- WHY THE DEMO NEEDS ONE AT ALL. `transaction.account_id` is NOT NULL against
-- `account(user_id, id)`, so a user row without an account is not an empty
-- portfolio — it is a portfolio that cannot be written. Every other path writes
-- the account in the same transaction as the user row; this identity's row was
-- written by a migration, so its account is written by one too.
--
-- THE ID IS PINNED, like the user's and for the same reason — a DSQL primary key
-- is immutable, so changing it is a DELETE and an INSERT of everything under it —
-- and for one more: a literal lets `ON CONFLICT` name the PRIMARY KEY, which
-- `infra/docs/dsql-constraints.md` measured, rather than the secondary unique
-- index `account_user_provider_uq`, which it did not. Both the id and the
-- address are pinned in `infra/src/demo-user.ts` and asserted against this file.
--
-- `inzhur` / `Inzhur` ARE NOT A VOCABULARY. `provider` carries no CHECK, because
-- `infra/schema/user.ts` forbids a constraint naming a specific holding and a
-- CHECK added after the table exists is `NOT VALID` for life, DSQL refusing
-- `VALIDATE CONSTRAINT`, so a widened vocabulary would be a rule the rows
-- already there were never held to. The value matches what
-- `infra/src/provision.ts` writes for everyone else; the one rule the column
-- carries is that a user holds each provider once.
--
-- ONE STATEMENT, AND A SECOND WOULD NEED DRIZZLE'S BREAKPOINT MARKER BEFORE IT.
-- The runner splits on that marker, sends each piece as its own query and keys the
-- ledger by that piece's hash. Two statements written here without one become a
-- single query under a single hash — one ledger row standing for two writes.

INSERT INTO account (user_id, id, provider, name, created_at)
     VALUES ('00000000-0000-4000-8000-00000000de70',
             '00000000-0000-4000-8000-00000000acc0', 'inzhur', 'Inzhur', now())
ON CONFLICT (user_id, id) DO NOTHING;
