export type RelayRoute =
  | 'start'
  | 'respond'
  | 'refresh'
  | 'sign-out'
  | 'google/begin'
  | 'google/complete'
  | 'passkey/list'
  | 'passkey/start'
  | 'passkey/complete';

/** THE ID TOKEN ALONE: the relay keeps the access token, which also authorizes `DeleteUser`, and
 *  makes the passkey calls with it (*Auth model*). */
export interface Tokens {
  idToken: string;
  /** Seconds. */
  expiresIn: number;
}

export interface Challenge {
  challenge: string;
  session: string;
  parameters: Record<string, string>;
  availableChallenges?: string[];
}

/** 400s: `invalid`, or a new password the pool's rule or history refuses; `botCheck`, the start's
 *  403 for its token; `googleSession`, a passkey call's 403 for a token without the scope, which a
 *  Google sign-in's is; `throttled`, any 429; `failed`, all else. */
export type Refusal =
  | 'notAuthorized'
  | 'botCheck'
  | 'googleSession'
  | 'invalid'
  | 'invalidPassword'
  | 'reusedPassword'
  | 'throttled'
  | 'offline'
  | 'failed';

/** `google` is a refresh's word on whether Google is on; `logout`, Cognito's logout endpoint, which
 *  a sign-out names while it is. The passkey calls answer the account's passkeys, the OS dialog's
 *  options, and a registration done. */
export type RelayAnswer =
  | { kind: 'tokens'; tokens: Tokens; google?: boolean }
  | { kind: 'challenge'; challenge: Challenge }
  | { kind: 'signedOut'; logout?: string }
  | { kind: 'authorize'; url: string }
  | { kind: 'passkeys'; passkeys: Passkey[] }
  | { kind: 'options'; options: Record<string, unknown> }
  | { kind: 'registered' }
  | { kind: 'refused'; reason: Refusal; google?: boolean };

export type RelayCall = (route: RelayRoute, body?: unknown) => Promise<RelayAnswer>;

const REFUSED: Record<number, Refusal> = { 429: 'throttled' };
/** The 400s the relay names; any other is `invalid`. */
const NAMED = new Map<unknown, Refusal>([
  ['invalid_password', 'invalidPassword'],
  ['reused_password', 'reusedPassword'],
]);
/** The 403s the relay names; any other is `failed`. */
const FORBIDDEN = new Map<unknown, Refusal>([
  ['bot_check_failed', 'botCheck'],
  ['insufficient_scope', 'googleSession'],
]);

/** A passkey as the relay lists it: Cognito's name for it, which may be empty, and its Kyiv day. */
export interface Passkey {
  name: string;
  createdAt: string;
}

// A day the calendar has: `Date` rolls 2026-02-30 over to March, so the date must come back as sent.
const isDay = (d: unknown): d is string => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

const isPasskey = (p: unknown): p is Passkey => {
  const { name, createdAt } = (p ?? {}) as Record<string, unknown>;
  return typeof name === 'string' && isDay(createdAt);
};

/** The `error` a refusal's body names, or nothing. */
const errorOf = async (response: Response): Promise<unknown> => {
  const body: unknown = await response.json().catch(() => undefined);
  return (body as { error?: unknown } | null | undefined)?.error;
};

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
  if (typeof b.idToken === 'string' && typeof b.expiresIn === 'number' && b.expiresIn > 0) {
    return {
      kind: 'tokens',
      tokens: { idToken: b.idToken, expiresIn: b.expiresIn },
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
  // Whole or not at all: a list missing one it could not read would miscount.
  if (Array.isArray(b.passkeys) && b.passkeys.every(isPasskey)) {
    return { kind: 'passkeys', passkeys: b.passkeys };
  }
  if (typeof b.options === 'object' && b.options !== null && !Array.isArray(b.options)) {
    return { kind: 'options', options: b.options as Record<string, unknown> };
  }
  if (b.status === 'registered') return { kind: 'registered' };
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
        return { kind: 'refused', reason: NAMED.get(await errorOf(response)) ?? 'invalid' };
      }
      // A refresh's refusal is what a signed-out page reads whether Google is on from.
      if (response.status === 401) {
        const body: unknown = await response.json().catch(() => undefined);
        return { kind: 'refused', reason: 'notAuthorized', ...googleIn(body) };
      }
      if (response.status === 403) {
        return { kind: 'refused', reason: FORBIDDEN.get(await errorOf(response)) ?? 'failed' };
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
