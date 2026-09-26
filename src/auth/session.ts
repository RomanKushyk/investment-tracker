import type { RelayAnswer, RelayCall, Tokens } from './relay';

export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut';
export type Locks = Pick<LockManager, 'request'>;

export interface Session {
  status(): SessionStatus;
  subscribe(listener: () => void): () => void;
  /** One refresh: the refresh cookie is HttpOnly, so asking the relay is the only way to know. */
  restore(): Promise<void>;
  /** Every `/auth/respond` goes through here, so none can run outside the lock. */
  respond(body: unknown): Promise<RelayAnswer>;
  /** `false` when the relay could not revoke, which keeps both cookies for a retry. */
  signOut(): Promise<boolean>;
  getIdToken(): Promise<string | undefined>;
}

// ONE LOCK FOR EVERY CALL THAT WRITES THE COOKIES, held until the answer lands: without it two tabs
// fork the refresh family, or a late refresh overwrites a new sign-in (*Auth model*).
const LOCK = 'quirenote-auth';
const EARLY_MS = 60_000;

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
  let refreshing: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  const set = (next: SessionStatus, tokens?: Tokens) => {
    held = tokens && { ...tokens, until: now() + tokens.expiresIn * 1000 };
    status = next;
    for (const listener of listeners) listener();
  };

  const locked = async <T>(call: () => Promise<T>): Promise<T> => await locks.request(LOCK, call);

  const refresh = () =>
    (refreshing ??= locked(async () => {
      const answer = await relay('refresh');
      if (answer.kind === 'tokens') set('signedIn', answer.tokens);
      else if (answer.kind === 'refused' && answer.reason === 'notAuthorized') set('signedOut');
      // Offline or failed says nothing about the cookie; only an unanswered load turns signed out.
      else if (status === 'unknown') set('signedOut');
    }).finally(() => (refreshing = undefined)));

  return {
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore: refresh,
    respond: (body) =>
      locked(async () => {
        const answer = await relay('respond', body);
        if (answer.kind === 'tokens') set('signedIn', answer.tokens);
        return answer;
      }),
    signOut: () =>
      locked(async () => {
        const answer = await relay('sign-out');
        if (answer.kind !== 'signedOut') return false;
        set('signedOut');
        return true;
      }),
    async getIdToken() {
      if (held && held.until - now() >= EARLY_MS) return held.idToken;
      if (status !== 'signedOut') await refresh();
      // A refresh that could not run leaves the old token behind; past its expiry it is no answer.
      return held && held.until > now() ? held.idToken : undefined;
    },
  };
}
