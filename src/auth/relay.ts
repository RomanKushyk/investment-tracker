export type RelayRoute =
  'start' | 'respond' | 'refresh' | 'sign-out' | 'google/begin' | 'google/complete';

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

/** 400s: `invalid`, and a new password refused by the pool's rule (`invalidPassword`) or history
 *  (`reusedPassword`); `throttled` is a 429, API Gateway's or the lockout's; `failed` all else. */
export type Refusal =
  | 'notAuthorized'
  | 'invalid'
  | 'invalidPassword'
  | 'reusedPassword'
  | 'throttled'
  | 'offline'
  | 'failed';

/** `google` is a refresh's word on whether Google is on; `logout`, Cognito's logout endpoint, which
 *  a sign-out names while it is. */
export type RelayAnswer =
  | { kind: 'tokens'; tokens: Tokens; google?: boolean }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'signedOut'; logout?: string }
  | { kind: 'authorize'; url: string }
  | { kind: 'refused'; reason: Refusal; google?: boolean };

export type RelayCall = (route: RelayRoute, body?: unknown) => Promise<RelayAnswer>;

const REFUSED: Record<number, Refusal> = { 429: 'throttled' };
/** The 400s the relay names; any other is `invalid`. */
const NAMED = new Map<unknown, Refusal>([
  ['invalid_password', 'invalidPassword'],
  ['reused_password', 'reusedPassword'],
]);

// API Gateway's ceiling for an HTTP API's answer: past it none can come, and the cross-tab lock is
// held until one does.
export const ANSWER_MS = 30_000;

/** The flag where a body carries one as a boolean, and nothing otherwise. */
function googleIn(body: unknown): { google?: boolean } {
  const google = (body as { google?: unknown } | null | undefined)?.google;
  return typeof google === 'boolean' ? { google } : {};
}

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
      ...googleIn(b),
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
  if (b.status === 'signed_out') {
    return typeof b.logout === 'string'
      ? { kind: 'signedOut', logout: b.logout }
      : { kind: 'signedOut' };
  }
  if (typeof b.authorize === 'string' && b.authorize !== '') {
    return { kind: 'authorize', url: b.authorize };
  }
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
    // No relay here, so no refresh cookie either: a refresh is answered, everything else fails.
    if (base === undefined) {
      return { kind: 'refused', reason: route === 'refresh' ? 'notAuthorized' : 'failed' };
    }
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
      if (response.status === 400) {
        const body: unknown = await response.json().catch(() => undefined);
        const named = (body as { error?: unknown } | null | undefined)?.error;
        return { kind: 'refused', reason: NAMED.get(named) ?? 'invalid' };
      }
      // A refresh's refusal is what a signed-out page reads whether Google is on from.
      if (response.status === 401) {
        const body: unknown = await response.json().catch(() => undefined);
        return { kind: 'refused', reason: 'notAuthorized', ...googleIn(body) };
      }
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
