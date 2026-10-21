// `GET /admin/archive/diagnosis`: the capture function's `diagnose` read, for the super-admin.
// The capture lives in the archive stack, so this route invokes it synchronously and answers its
// result unchanged.
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import {
  FORBIDDEN,
  NO_APPLICATION,
  PENDING,
  REJECTED,
  authorize,
  superAdminOnly,
} from './authorize';
import { connect } from './dsql';
import {
  INTERNAL,
  type ApiEvent,
  type ApiResult,
  type Declared,
  derived,
  json,
  respond,
} from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';

export const DIAGNOSIS_ROUTE = 'GET /admin/archive/diagnosis';

/** The one event that selects diagnose. Anything else — `{}`, a typo, an `asOf` — runs the
 *  scheduled capture, which writes, so the route sends this literal and nothing it was given. */
const DIAGNOSE = '{"diagnose":true}';

/** The invoke as the SDK types it, narrowed to what this route sends and reads. */
export type CaptureClient = {
  invoke(input: {
    FunctionName: string;
    Payload: string;
  }): Promise<{ FunctionError?: string; Payload?: Uint8Array }>;
};

/** The capture's own body, which the archive stack's code defines and this route does not. */
const DIAGNOSED = derived({
  statusCode: 200,
  name: 'diagnosis',
  headers: [],
  example: {
    mode: 'diagnose',
    size: { rows: '<rows>', payload_bytes: '<bytes>', total_bytes: '<bytes>' },
    bySource: [{ source: 'nbu', n: '<rows>', bytes: '<bytes>' }],
    observations: [
      {
        instrument_ref: 'UA4000236475',
        basis: 'fair',
        source: 'nbu',
        n: '<rows>',
        before_capture: '<rows>',
        gaps: 0,
      },
    ],
    sample: [],
    instruments: [],
    plans: { observeNbu: ['<plan line>'] },
  },
});
/** RFC 9110 §15.6.3: the capture answered with an error, or could not be invoked. */
const CAPTURE_FAILED = json(502, '{"error":"capture_failed"}');
/** RFC 9110 §15.6.5: the capture did not answer inside the request timeout below. */
const CAPTURE_TIMEOUT = json(504, '{"error":"capture_timeout"}');

/** What the route can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `archive-admin.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [DIAGNOSIS_ROUTE]: [
    DIAGNOSED,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    CAPTURE_FAILED,
    CAPTURE_TIMEOUT,
    INTERNAL,
  ],
};

export async function diagnosis(
  client: SqlClient,
  capture: CaptureClient,
  event: ApiEvent,
): Promise<ApiResult> {
  // THE GATE FIRST: nothing is invoked for a caller the row does not admit.
  let gate;
  try {
    gate = superAdminOnly(await authorize(client, event));
  } catch (err) {
    console.error('archive-admin: the gate failed', loggable(err));
    return INTERNAL;
  }
  if ('refusal' in gate) return gate.refusal;

  const FunctionName = process.env.CAPTURE_FUNCTION_NAME;
  if (!FunctionName) {
    console.error('archive-admin: CAPTURE_FUNCTION_NAME is not set on this function');
    return INTERNAL;
  }

  let answer;
  try {
    answer = await capture.invoke({ FunctionName, Payload: DIAGNOSE });
  } catch (err) {
    const name = (err as { name?: unknown }).name;
    console.error(`archive-admin: the invoke failed (${String(name)})`);
    return name === 'TimeoutError' ? CAPTURE_TIMEOUT : CAPTURE_FAILED;
  }
  // A thrown handler is a 200 with `FunctionError` set; its payload is the error, not a result.
  if (answer.FunctionError !== undefined || answer.Payload === undefined) {
    console.error(`archive-admin: diagnose answered ${answer.FunctionError ?? 'no payload'}`);
    return CAPTURE_FAILED;
  }
  return respond(DIAGNOSED, {}, new TextDecoder().decode(answer.Payload));
}

// No retry: diagnose is a read the caller repeats, and a second attempt would outrun the API's
// 30 s. The handler only warns at `requestTimeout` unless told to throw.
const lambda = new LambdaClient({
  maxAttempts: 1,
  requestHandler: { requestTimeout: 25_000, throwOnRequestTimeout: true },
});
const sdk: CaptureClient = {
  invoke: (input) => lambda.send(new InvokeCommand(input)),
};

export async function handler(event: ApiEvent): Promise<ApiResult> {
  const client = await connect().catch((err: unknown) => {
    console.error('archive-admin connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    return await diagnosis(client, sdk, event);
  } finally {
    await client
      .end()
      .catch((err: unknown) => console.error('archive-admin disconnect failed', err));
  }
}
