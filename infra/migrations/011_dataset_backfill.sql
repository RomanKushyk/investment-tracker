-- 011 — every user who holds an account gets a dataset, and points at it (W7, #390)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE ACCOUNT DECIDES WHO, because it is what provisioning writes: a pending
-- application owns nothing and gets nothing, which is what lets approval delete
-- that row to rekey it (`infra/src/provision.ts`).
--
-- EACH STATEMENT MAY RUN TWICE. The runner re-sends a statement whose ledger row
-- a crash left open, and the switch that follows this file repeats both, before
-- any import exists, to catch up a user provisioned in between; so each leaves alone
-- what it already did.
INSERT INTO dataset (user_id, id, created_at)
SELECT u.user_id, gen_random_uuid(), now()
  FROM app_user u
 WHERE EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.user_id)
   AND NOT EXISTS (SELECT 1 FROM dataset d WHERE d.user_id = u.user_id);
--> statement-breakpoint
-- One dataset per such user exists at this point: nothing else creates one yet. A
-- row with none is not written, since every write counts against the row ceiling.
UPDATE app_user
   SET dataset_id = (SELECT d.id FROM dataset d WHERE d.user_id = app_user.user_id)
 WHERE dataset_id IS NULL
   AND EXISTS (SELECT 1 FROM dataset d WHERE d.user_id = app_user.user_id);
