import type { RelayAnswer, RelayCall, Tokens } from './relay';

export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut';
export type Locks = Pick<LockManager, 'request'>;

export interface Session {
  status(): SessionStatus;
  /** The address the ID token names, for a label; undefined when it names none. */
  address(): string | undefined;
  /** True while the status is a signed-out the relay never gave: the load went unanswered. */
  unanswered(): boolean;
  subscribe(listener: () => void): () => void;
  /** Asks the relay until it has answered: the refresh cookie is HttpOnly, so asking is the only
   *  way to know, and the first answer settles it for the page's life. */
  restore(): Promise<void>;
  /** Every `/auth/respond` goes through here, so none can run outside the lock. */
  respond(body: unknown): Promise<RelayAnswer>;
  /** `false` when the relay could not revoke, which keeps both cookies for a retry. */
  signOut(): Promise<boolean>;
  getIdToken(): Promise<string | undefined>;
  /** Of the same pair as the ID token; it authorizes the user's own Cognito calls. */
  getAccessToken(): Promise<string | undefined>;
}

// ONE LOCK FOR EVERY CALL THAT WRITES THE COOKIES, held until the answer lands: without it two tabs
// fork the refresh family, or a late refresh overwrites a new sign-in (*Auth model*).
const LOCK = 'quirenote-auth';
const EARLY_MS = 60_000;

// READ, NEVER VERIFIED: it only labels a row, and the API verifies every token it is sent. The ID
// token is the client's to read (OIDC Core §2); its payload is base64url JSON, UTF-8 inside.
function addressOf(idToken: string): string | undefined {
  try {
    const payload = (idToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const email: unknown = (JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown })
      .email;
    return typeof email === 'string' && email !== '' ? email : undefined;
  } catch {
    return undefined;
  }
}

export function createSession({
  relay,
  locks,
  now = Date.now,
}: {
  relay: RelayCall;
  locks: Locks;
  now?: () => number;
}): Session {
  let status: SessionStatus = 'unknown';
  let held: (Tokens & { until: number }) | undefined;
  let address: string | undefined;
  let refreshing: Promise<void> | undefined;
  let leaving: Promise<boolean> | undefined;
  // A signed-out status the relay never gave: the next reader asks again.
  let unanswered = false;
  const listeners = new Set<() => void>();

  // `answered` is set before anyone is told: a subscriber reads it along with the status.
  const set = (next: SessionStatus, tokens?: Tokens, answered = true) => {
    held = tokens && { ...tokens, until: now() + tokens.expiresIn * 1000 };
    address = tokens && addressOf(tokens.idToken);
    status = next;
    unanswered = !answered;
    for (const listener of listeners) listener();
  };

  const locked = async <T>(call: () => Promise<T>): Promise<T> => await locks.request(LOCK, call);

  const refresh = () =>
    (refreshing ??= locked(async () => {
      const answer = await relay('refresh');
      if (answer.kind === 'tokens') set('signedIn', answer.tokens);
      else if (answer.kind === 'refused' && answer.reason === 'notAuthorized') set('signedOut');
      // Offline or failed says nothing about the cookie; only an unanswered load turns signed out,
      // and it settles nothing.
      else if (status === 'unknown') set('signedOut', undefined, false);
    }).finally(() => (refreshing = undefined)));

  const fresh = async () => {
    if (held && held.until - now() >= EARLY_MS) return held;
    if (status !== 'signedOut' || unanswered) await refresh();
    // A refresh that could not run leaves the old pair behind; past its expiry it is no answer.
    return held && held.until > now() ? held : undefined;
  };

  return {
    status: () => status,
    address: () => address,
    unanswered: () => unanswered,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Every reader may ask: until the relay answers each reaches it, sharing one in flight; after,
    // none does.
    restore: () => (status === 'unknown' || unanswered ? refresh() : Promise.resolve()),
    respond: (body) =>
      locked(async () => {
        const answer = await relay('respond', body);
        if (answer.kind === 'tokens') set('signedIn', answer.tokens);
        return answer;
      }),
    // Shared while one runs, as a refresh is: one sign-out, however many controls are pressed.
    signOut: () =>
      (leaving ??= locked(async () => {
        const answer = await relay('sign-out');
        if (answer.kind !== 'signedOut') return false;
        set('signedOut');
        return true;
      }).finally(() => (leaving = undefined))),
    getIdToken: async () => (await fresh())?.idToken,
    getAccessToken: async () => (await fresh())?.accessToken,
  };
}
