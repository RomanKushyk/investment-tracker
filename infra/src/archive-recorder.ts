// Writes how an archive operation ended, for the state machine that ran it: the capture's own
// result, or why it failed. It finishes a run still going and inside its deadline, and nothing
// else: a finish is never stamped past the deadline a read applies. [*Cloud target*]
import { connect } from './dsql';
import { canonicalUuid } from './http';
import type { SqlClient } from './migrate';

/** What the state machine hands over: the capture's output, or the error its task caught. */
export type Outcome =
  | { operationId: string; result: unknown }
  | { operationId: string; error: { Error?: string; Cause?: string } };

/** A message is the reason a person reads, never a trace. */
const MESSAGE_LENGTH = 1000;

const SUCCEEDED = `UPDATE archive_operation
                      SET state = 'succeeded', result = $2, finished_at = now()
                    WHERE id = $1 AND state = 'running' AND now() <= deadline_at
                RETURNING id`;

const FAILED = `UPDATE archive_operation
                   SET state = 'failed', error_reason = 'capture_failed', error_message = $2,
                       finished_at = now()
                 WHERE id = $1 AND state = 'running' AND now() <= deadline_at
             RETURNING id`;

/** A Lambda's thrown error arrives as JSON in `Cause`, its message beside its trace; a timeout or
 *  a service error arrives as a name and plain text. */
const messageOf = ({ Error: name, Cause: cause }: { Error?: string; Cause?: string }): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cause ?? '');
  } catch {
    return [name, cause].filter(Boolean).join(': ').slice(0, MESSAGE_LENGTH);
  }
  const message = (parsed as { errorMessage?: unknown } | null)?.errorMessage;
  return (typeof message === 'string' ? message : (name ?? 'Error')).slice(0, MESSAGE_LENGTH);
};

export async function record(client: SqlClient, outcome: Outcome): Promise<void> {
  const id = canonicalUuid(outcome.operationId);
  // Raised, not recorded: the state machine sends one of the two, and anything else is a broken
  // definition the execution's failure should show.
  if (id === undefined || 'result' in outcome === 'error' in outcome) {
    throw new Error('archive-recorder: an outcome the state machine never sends');
  }
  const { rows } =
    'result' in outcome
      ? await client.query(SUCCEEDED, [id, JSON.stringify(outcome.result)])
      : await client.query(FAILED, [id, messageOf(outcome.error)]);
  if (rows.length === 0) {
    console.error(
      `archive-recorder: ${id} was already finished or past its deadline, and stays as it reads`,
    );
  }
}

export async function handler(outcome: Outcome): Promise<void> {
  const client = await connect();
  try {
    await record(client, outcome);
  } finally {
    await client
      .end()
      .catch((err: unknown) => console.error('archive-recorder disconnect failed', err));
  }
}
