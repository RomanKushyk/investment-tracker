// The recorder writes how an archive operation ended: the capture's own result, or the reason it
// failed. It finishes a run still going, and nothing else.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { record } from './archive-recorder';
import { MIGRATIONS, statementsOf as statements } from './migrate';

const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const ID = '00000000-0000-4000-8000-0000000000a1';
const ADMIN = '9f1e2d3c-0000-4000-8000-00000000ad11';

let db: PGlite;

/** A run as the start route leaves it; `deadline` replaces its SQL deadline. */
const running = (deadline = `now() + interval '21 minutes'`) =>
  db.query(
    `INSERT INTO archive_operation (id, started_by, started_at, deadline_at, mode, parameters, state)
     VALUES ($1, $2, now() - interval '1 minute', ${deadline}, 'observe', '{}', 'running')`,
    [ID, ADMIN],
  );

const stored = async () =>
  (
    await db.query<Record<string, unknown>>(
      `SELECT state, result, error_reason, error_message, finished_at IS NOT NULL AS finished
         FROM archive_operation WHERE id = $1`,
      [ID],
    )
  ).rows[0];

/** A capture that threw, as the Lambda task's error output carries it. */
const thrown = (errorMessage: string) => ({
  Error: 'Error',
  Cause: JSON.stringify({
    errorType: 'Error',
    errorMessage,
    trace: ['Error: ' + errorMessage, '    at importFundHistory (/var/task/capture.js:1:1)'],
  }),
});

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8'))))
    await db.exec(stmt);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a run that ended is recorded as the capture left it', () => {
  it('stores the capture’s result whole on a success', async () => {
    await running();
    const result = { mode: 'observe', written: 3, complete: true, nextFrom: null };
    await record(db, { operationId: ID, result });
    expect(await stored()).toEqual({
      state: 'succeeded',
      result: JSON.stringify(result),
      error_reason: null,
      error_message: null,
      finished: true,
    });
  });

  it('stores the capture’s own message on a failure, and never its stack', async () => {
    await running();
    await record(db, { operationId: ID, error: thrown('unknown fund ref: x') });
    expect(await stored()).toEqual({
      state: 'failed',
      result: null,
      error_reason: 'capture_failed',
      error_message: 'unknown fund ref: x',
      finished: true,
    });
  });

  it('stores the error’s name when its cause carries no message, as a task timeout’s does', async () => {
    await running();
    await record(db, {
      operationId: ID,
      error: { Error: 'States.Timeout', Cause: 'The task timed out.' },
    });
    expect(await stored()).toMatchObject({
      state: 'failed',
      error_reason: 'capture_failed',
      error_message: 'States.Timeout: The task timed out.',
    });
  });

  it('bounds a message to what a row is meant to hold', async () => {
    await running();
    await record(db, { operationId: ID, error: thrown('x'.repeat(5000)) });
    expect(String((await stored()).error_message)).toHaveLength(1000);
  });
});

describe('only a run still going is finished', () => {
  it('leaves a finished run as it ended', async () => {
    await running();
    await record(db, { operationId: ID, result: { written: 1 } });
    await record(db, { operationId: ID, error: thrown('late') });
    expect(await stored()).toMatchObject({ state: 'succeeded', result: '{"written":1}' });
  });

  it('leaves a run past its deadline to read as failed, without raising', async () => {
    await running(`now() - interval '1 second'`);
    await record(db, { operationId: ID, result: { written: 1 } });
    expect(await stored()).toMatchObject({ state: 'running', finished: false });
  });

  it('records nothing for an operation it does not know, without raising', async () => {
    await record(db, { operationId: ID, result: { written: 1 } });
    expect(await stored()).toBeUndefined();
  });
});

describe('an input the state machine never sends is refused', () => {
  it.each([
    ['no operation id', { result: {} }],
    ['an id that is not a uuid', { operationId: '42', result: {} }],
    ['neither a result nor an error', { operationId: ID }],
    ['both a result and an error', { operationId: ID, result: {}, error: thrown('x') }],
  ])('raises on %s', async (_, input) => {
    await running();
    await expect(record(db, input as never)).rejects.toThrow();
    expect(await stored()).toMatchObject({ state: 'running' });
  });
});
