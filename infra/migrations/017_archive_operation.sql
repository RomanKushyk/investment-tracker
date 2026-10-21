-- 017 — the archive operations a super-admin starts, one row per start (W7, #475)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE EXPAND HALF: nothing writes the table yet, the code being live before the schema
-- (*User schema and deletes*).
--
-- One row is one start of a capture mode: who started it and when, the parameters it was started
-- with, and the outcome the recorder writes once the run ends. A run still `running` past its
-- deadline is answered as failed by the read, so `deadline_exceeded` is never stored, and a finish
-- stamped past the deadline is refused. Every writer stamps with the cluster's own `now()`, so the
-- order rules compare one clock. What `parameters` and `result` hold is the writer's, the JSON it
-- serialises, not the column's. No user owns a row, so the key is a random id, as
-- `price_capture`'s is; `started_by` is an audit note, as `app_user.decided_by` is, and no key
-- names it. No second index: the list reads a small table, and a rehearsal then waits on no index
-- job.
--
-- EVERY RULE IS HERE: DSQL takes a NOT NULL only at create time, and a later CHECK or key only
-- `NOT VALID`. TEXT, NOT `jsonb`, for the parameters and the result: a column's type is an
-- alteration DSQL cannot make later.
--
-- HAND-WRITTEN, as `010` is: `003` is generated and frozen.
CREATE TABLE "archive_operation" (
	"id" uuid NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"mode" text NOT NULL,
	"parameters" text NOT NULL,
	"state" text NOT NULL,
	"finished_at" timestamp with time zone,
	"result" text,
	"error_reason" text,
	"error_message" text,
	CONSTRAINT "archive_operation_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "archive_operation_mode_ck" CHECK ("archive_operation"."mode" IN ('observe', 'importFundHistory')),
	CONSTRAINT "archive_operation_state_ck" CHECK ("archive_operation"."state" IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "archive_operation_deadline_ck" CHECK ("archive_operation"."deadline_at" > "archive_operation"."started_at"),
	CONSTRAINT "archive_operation_finished_ck" CHECK (("archive_operation"."state" = 'running') = ("archive_operation"."finished_at" IS NULL)),
	CONSTRAINT "archive_operation_finish_order_ck" CHECK ("archive_operation"."finished_at" >= "archive_operation"."started_at"),
	CONSTRAINT "archive_operation_finish_deadline_ck" CHECK ("archive_operation"."finished_at" <= "archive_operation"."deadline_at"),
	CONSTRAINT "archive_operation_result_ck" CHECK (("archive_operation"."state" = 'succeeded') = ("archive_operation"."result" IS NOT NULL)),
	CONSTRAINT "archive_operation_error_ck" CHECK (("archive_operation"."state" = 'failed') = ("archive_operation"."error_reason" IS NOT NULL)),
	CONSTRAINT "archive_operation_message_ck" CHECK ("archive_operation"."error_message" IS NULL OR "archive_operation"."error_reason" IS NOT NULL),
	CONSTRAINT "archive_operation_reason_ck" CHECK ("archive_operation"."error_reason" IN ('start_failed', 'capture_failed'))
);
