export type RelayRoute = 'start' | 'respond' | 'refresh' | 'sign-out';

export interface Tokens {
  idToken: string;
  accessToken: string;
  /** Seconds. */
  expiresIn: number;
}

export interface Challenge {
  challenge: string;
  session: string;
  parameters: Record<string, string>;
  availableChallenges?: string[];
}

/** `invalid` is a 400, `throttled` API Gateway's 429; `failed` is any answer the app cannot act on. */
export type Refusal = 'notAuthorized' | 'invalid' | 'throttled' | 'offline' | 'failed';

export type RelayAnswer =
  | { kind: 'tokens'; tokens: Tokens }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'signedOut' }
  | { kind: 'refused'; reason: Refusal };

export type RelayCall = (route: RelayRoute, body?: unknown) => Promise<RelayAnswer>;

const REFUSED: Record<number, Refusal> = { 400: 'invalid', 401: 'notAuthorized', 429: 'throttled' };

// API Gateway's ceiling for an HTTP API's answer: past it none can come, and the cross-tab lock is
// held until one does.
const ANSWER_MS = 30_000;

function read(body: unknown): RelayAnswer {
  if (typeof body !== 'object' || body === null) return { kind: 'refused', reason: 'failed' };
  const b = body as Record<string, unknown>;
  if (
    typeof b.idToken === 'string' &&
    typeof b.accessToken === 'string' &&
    typeof b.expiresIn === 'number' &&
    b.expiresIn > 0
  ) {
    return {
      kind: 'tokens',
      tokens: { idToken: b.idToken, accessToken: b.accessToken, expiresIn: b.expiresIn },
    };
  }
  if (
    typeof b.challenge === 'string' &&
    typeof b.session === 'string' &&
    typeof b.parameters === 'object' &&
    b.parameters !== null
  ) {
    return { kind: 'challenge', challenge: b as unknown as Challenge };
  }
  if (b.status === 'signed_out') return { kind: 'signedOut' };
  return { kind: 'refused', reason: 'failed' };
}

/** The relay (#162). `credentials: 'include'` carries its cookies, which JavaScript never sees;
 *  `x-csrf` is the header it refuses a request without. */
export function createRelay({
  base,
  fetch,
}: {
  base: string | undefined;
  fetch: typeof globalThis.fetch;
}): RelayCall {
  return async (route, body) => {
    if (base === undefined) return { kind: 'refused', reason: 'failed' };
    const init: RequestInit =
      body === undefined
        ? { method: 'POST', credentials: 'include', headers: { 'x-csrf': '1' } }
        : {
            method: 'POST',
            credentials: 'include',
            headers: { 'x-csrf': '1', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANSWER_MS);
    try {
      const response = await fetch(`${base}/auth/${route}`, { ...init, signal: controller.signal });
      if (response.status !== 200) {
        return { kind: 'refused', reason: REFUSED[response.status] ?? 'failed' };
      }
      return read(await response.json().catch(() => undefined));
    } catch {
      return { kind: 'refused', reason: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  };
}
