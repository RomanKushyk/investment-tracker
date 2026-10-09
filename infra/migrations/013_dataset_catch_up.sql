-- 013 — the dataset backfill again, for anyone provisioned before the switch (W7, #390)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- `011`'S TWO STATEMENTS, BYTE FOR BYTE: the code is live before the schema, so a
-- user provisioned between `011` and the switch's deploy holds an account and no
-- dataset, and this gives them one. A new file because the ledger keys by file and
-- statement, so the same statements here run again; each leaves alone what it did.
INSERT INTO dataset (user_id, id, created_at)
SELECT u.user_id, gen_random_uuid(), now()
  FROM app_user u
 WHERE EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.user_id)
   AND NOT EXISTS (SELECT 1 FROM dataset d WHERE d.user_id = u.user_id);
--> statement-breakpoint
-- Provisioning writes a dataset and its pointer together, so a user whose pointer is
-- NULL holds at most one. A row with none is not written: every write counts against
-- the row ceiling.
UPDATE app_user
   SET dataset_id = (SELECT d.id FROM dataset d WHERE d.user_id = app_user.user_id)
 WHERE dataset_id IS NULL
   AND EXISTS (SELECT 1 FROM dataset d WHERE d.user_id = app_user.user_id);
