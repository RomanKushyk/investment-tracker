import { answerOf, type Answer } from '../auth/access';
import type { HeldAnswer } from '../auth/app';
import { environmentFor } from '../auth/environment';
import { ANSWER_MS } from '../auth/relay';
import type { Session } from '../auth/session';

/** The first segment of each route every user may call. `/admin/*` also answers `forbidden` to an
 *  active user who is not a super-admin, so only these may show a refusal in place of the screen. */
export const DATA_ROOTS = ['view', 'mutations', 'state', 'imports', 'settings'] as const;

export interface Call {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The route as the API spells it, with its query string. */
  path: string;
  /** JSON text, sent as it stands, so a digest of it holds for the bytes on the wire. */
  body?: string;
  headers?: Readonly<Record<string, string>>;
  /** One logical write: it goes under one `Idempotency-Key`, the same on every attempt. */
  keyed?: boolean;
}

/** What a call came to. `conflict` is a 412: the caller re-reads the tag and decides, since the
 *  precondition is doing its work. `answer` is one of the four 403s, shown in place of the route
 *  when the route is a user's own and no sign-out began meanwhile. `failed` is any other answer, the
 *  status and body as they came, for the caller that knows its route. `stale` is a `derivation-id`
 *  that differs from this build's: reported, never acted on. */
export type Reply =
  | {
      kind: 'ok';
      status: number;
      body: unknown;
      etag?: string;
      derivationId?: string;
      stale: boolean;
    }
  | { kind: 'answer'; answer: Answer }
  | { kind: 'conflict' }
  | { kind: 'inFlight' }
  | { kind: 'keyReused' }
  | { kind: 'invalidOp'; index: number; issues: unknown[] }
  | { kind: 'tooLarge' }
  | { kind: 'preconditionRequired' }
  | { kind: 'unauthorized' }
  | { kind: 'throttled' }
  | { kind: 'offline' }
  | { kind: 'failed'; status?: number; body?: unknown };

export type Transport = (call: Call) => Promise<Reply>;

export interface TransportDeps {
  /** `location.hostname`: the host serving the page names the API it calls, as it names the relay. */
  hostname: string;
  fetch: typeof globalThis.fetch;
  session: Pick<
    Session,
    'getIdToken' | 'address' | 'signOuts' | 'signingOut' | 'status' | 'unanswered'
  >;
  showAnswer: (held: HeldAnswer) => void;
  /** This build's `__DERIVATION_ID__`. */
  derivationId: string;
}

// Full jitter over a window that doubles, from the half second in which the API's two requests
// per second refill one token (*Auth model*).
const RETRIES = 4;
const BASE_MS = 500;
const backoff = (retry: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.random() * BASE_MS * 2 ** retry));

interface Seen {
  status: number;
  headers: Headers;
  body: unknown;
}

const errorOf = (body: unknown) =>
  typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;

// A 409 for a write still running under its key: sent again unchanged, it finds the stored answer.
const running = ({ status, body }: Seen) => status === 409 && errorOf(body) === 'request_in_flight';

/** The data routes of the API (`/view`, `/mutations`, `/state`, `/imports`, `/settings`), called as
 *  the signed-in user. The ID token rides as a bearer and no cookie does: the relay's is its own. */
export function createTransport({
  hostname,
  fetch,
  session,
  showAnswer,
  derivationId,
}: TransportDeps): Transport {
  const base = environmentFor(hostname)?.relay;

  /** Undefined where the network failed or no answer came in `ANSWER_MS`, the answer's body being
   *  part of it. */
  async function attempt(call: Call, idToken: string, key?: string): Promise<Seen | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANSWER_MS);
    try {
      // A `Headers` folds a name's case, so a caller's `Content-Type` stands in place of the default.
      const headers = new Headers(call.headers);
      if (call.body !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      headers.set('authorization', `Bearer ${idToken}`);
      if (key !== undefined) headers.set('idempotency-key', key);
      const response = await fetch(`${base}${call.path}`, {
        method: call.method,
        credentials: 'omit',
        signal: controller.signal,
        headers,
        ...(call.body === undefined ? {} : { body: call.body }),
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined;
      }
      return { status: response.status, headers: response.headers, body };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  function read(call: Call, { status, headers, body }: Seen, signOuts: number): Reply {
    if (status >= 200 && status < 300) {
      const served = headers.get('derivation-id') ?? undefined;
      return {
        kind: 'ok',
        status,
        body,
        etag: headers.get('etag') ?? undefined,
        derivationId: served,
        stale: served !== undefined && served !== derivationId,
      };
    }
    const error = errorOf(body);
    if (status === 403) {
      const answer = answerOf(status, body);
      if (answer === undefined) return { kind: 'failed', status, body };
      const mine = DATA_ROOTS.some((root) => root === call.path.split(/[/?]/)[1]);
      if (mine && session.signOuts() === signOuts) {
        showAnswer({ answer, email: session.address() });
      }
      return { kind: 'answer', answer };
    }
    if (status === 401) return { kind: 'unauthorized' };
    if (status === 412) return { kind: 'conflict' };
    if (status === 413) return { kind: 'tooLarge' };
    if (status === 428) return { kind: 'preconditionRequired' };
    if (status === 429) return { kind: 'throttled' };
    if (status === 409 && error === 'request_in_flight') return { kind: 'inFlight' };
    if (status === 422 && error === 'key_reused') return { kind: 'keyReused' };
    if (status === 422 && error === 'invalid_op') {
      const { index, issues } = body as { index?: unknown; issues?: unknown };
      if (typeof index === 'number' && Array.isArray(issues)) {
        return { kind: 'invalidOp', index, issues };
      }
    }
    return { kind: 'failed', status, body };
  }

  return async (call) => {
    // Read before anything is awaited: an answer is for the page as it was when the call began.
    const signOuts = session.signOuts();
    if (base === undefined) return { kind: 'failed' };
    // The pair held while a sign-out runs is the account's that is leaving.
    if (session.signingOut()) return { kind: 'unauthorized' };
    const key = call.keyed ? crypto.randomUUID() : undefined;
    for (let retry = 0; ; retry += 1) {
      const idToken = await session.getIdToken();
      // A sign-out since the call began ends it: this token may be another account's.
      if (session.signOuts() !== signOuts) return { kind: 'unauthorized' };
      // Signed out, there is no token to wait for; a refresh the network lost is a lost connection.
      if (idToken === undefined && session.status() !== 'signedIn' && !session.unanswered()) {
        return { kind: 'unauthorized' };
      }
      const seen = idToken === undefined ? undefined : await attempt(call, idToken, key);
      if ((seen === undefined || seen.status === 429 || running(seen)) && retry < RETRIES) {
        await backoff(retry);
        continue;
      }
      return seen === undefined ? { kind: 'offline' } : read(call, seen, signOuts);
    }
  };
}
