import type { RelayAnswer, RelayCall, Tokens } from './relay';

export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut';
export type Locks = Pick<LockManager, 'request'>;
/** A finished sign-out, and Cognito's logout endpoint while Google is on. */
export type SignedOut = { logout?: string };
/** Sign-out everywhere's outcome: every session over, this one's too; a sign-in too old to act on,
 *  which a new one renews; or nothing ended, and the same sign-in may ask again. */
export type Everywhere =
  ({ kind: 'signedOut' } & SignedOut) | { kind: 'reauthenticate' } | { kind: 'failed' };

export interface Session {
  status(): SessionStatus;
  /** The address the ID token names, for a label; undefined when it names none. */
  address(): string | undefined;
  /** True while the status is a signed-out the relay never gave: the load went unanswered. */
  unanswered(): boolean;
  /** Whether Google is on, as the last refresh answer said; undefined until one has. */
  google(): boolean | undefined;
  subscribe(listener: () => void): () => void;
  /** Asks the relay until it has answered: the refresh cookie is HttpOnly, so asking is the only
   *  way to know, and the first answer settles it for the page's life. */
  restore(): Promise<void>;
  /** Every `/auth/respond` goes through here, so none can run outside the lock. */
  respond(body: unknown): Promise<RelayAnswer>;
  /** Google's code and state, back from Cognito; it writes the cookies, so it takes the lock too. */
  complete(body: unknown): Promise<RelayAnswer>;
  /** `false` when the relay could not revoke, which keeps both cookies for a retry. */
  signOut(): Promise<false | SignedOut>;
  /** Ends every session the account holds, this browser's last, for the account this tab shows. A
   *  sign-out to every reader, counted and told as one. */
  signOutEverywhere(): Promise<Everywhere>;
  /** How many sign-outs this page has begun, counted when one begins and not when the relay answers:
   *  a reader that saw a different count when it asked has an answer from before one. */
  signOuts(): number;
  /** True from when a sign-out begins until the relay answers it: the pair held meanwhile is the
   *  account's that is leaving. Subscribers are told at both edges, a failed one's too. */
  signingOut(): boolean;
  /** How many times a signed-in answer has named another account than the one held, with no
   *  sign-out between: the cookie another tab replaced. Counted as the answer lands, so a reader that
   *  saw a different count when it asked holds what is the earlier account's. */
  accountChanges(): number;
  getIdToken(): Promise<string | undefined>;
  /** The `sub` of the same pair: each passkey call names it, so the relay acts only for the account
   *  this tab shows. */
  getAccount(): Promise<string | undefined>;
}

// ONE LOCK FOR EVERY CALL THAT WRITES THE COOKIES, held until the answer lands: without it two tabs
// fork the refresh family, or a late refresh overwrites a new sign-in (*Auth model*).
const LOCK = 'quirenote-auth';
const EARLY_MS = 60_000;

// READ, NEVER VERIFIED: a claim labels a row or names an account, and the API verifies every token it
// is sent. The ID token is the client's to read (OIDC Core §2); its payload is base64url JSON.
function claimOf(idToken: string, name: 'email' | 'sub'): string | undefined {
  try {
    const payload = (idToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const claim: unknown = (JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)[
      name
    ];
    return typeof claim === 'string' && claim !== '' ? claim : undefined;
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
  let google: boolean | undefined;
  let refreshing: Promise<void> | undefined;
  let leaving: Promise<false | SignedOut> | undefined;
  let everywhere: Promise<Everywhere> | undefined;
  let begun = 0;
  // The `sub` the last signed-in answer named, forgotten at a sign-out, which empties the page.
  let account: string | undefined;
  let changes = 0;
  // A signed-out status the relay never gave: the next reader asks again.
  let unanswered = false;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };

  // `answered` is set before anyone is told: a subscriber reads it along with the status.
  const set = (next: SessionStatus, tokens?: Tokens, answered = true) => {
    held = tokens && { ...tokens, until: now() + tokens.expiresIn * 1000 };
    address = tokens && claimOf(tokens.idToken, 'email');
    status = next;
    unanswered = !answered;
    const sub = tokens && claimOf(tokens.idToken, 'sub');
    if (tokens === undefined) account = undefined;
    else if (sub !== undefined) {
      if (account !== undefined && sub !== account) changes += 1;
      account = sub;
    }
    tell();
  };

  const locked = async <T>(call: () => Promise<T>): Promise<T> => await locks.request(LOCK, call);

  const refresh = () =>
    (refreshing ??= locked(async () => {
      const answer = await relay('refresh');
      // Before `set`, which tells the subscribers: they read it along with the status.
      if ((answer.kind === 'tokens' || answer.kind === 'refused') && answer.google !== undefined) {
        google = answer.google;
      }
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

  const freshAccount = async () => {
    const pair = await fresh();
    return pair && claimOf(pair.idToken, 'sub');
  };

  return {
    status: () => status,
    address: () => address,
    unanswered: () => unanswered,
    google: () => google,
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
    complete: (body) =>
      locked(async () => {
        const answer = await relay('google/complete', body);
        if (answer.kind === 'tokens') set('signedIn', answer.tokens);
        return answer;
      }),
    // Shared while one runs, as a refresh is: one sign-out, however many controls are pressed.
    // Told at both edges: a control mounted mid-run reads the store, and a failure changes no status.
    signOut() {
      if (leaving === undefined) {
        begun += 1;
        leaving = locked(async () => {
          const answer = await relay('sign-out');
          if (answer.kind !== 'signedOut') return false;
          set('signedOut');
          return answer.logout === undefined ? {} : { logout: answer.logout };
        }).finally(() => {
          leaving = undefined;
          tell();
        });
        tell();
      }
      return leaving;
    },
    // Shared and told as a sign-out is. The account is read before the lock, whose refresh takes it.
    signOutEverywhere() {
      if (everywhere === undefined) {
        begun += 1;
        // The relay ended this session meanwhile, so the page is signed out already.
        const ended = (): Everywhere =>
          status === 'signedOut' && !unanswered ? { kind: 'signedOut' } : { kind: 'failed' };
        everywhere = (async (): Promise<Everywhere> => {
          const before = changes;
          const sub = await freshAccount();
          // The press's own refresh brought another account: the proof was the earlier one's.
          if (changes !== before) return { kind: 'failed' };
          if (sub === undefined) return ended();
          const outcome = await locked(async (): Promise<Everywhere | 'ask'> => {
            const answer = await relay('sign-out/global', { sub });
            if (answer.kind === 'refused' && answer.reason === 'reauthenticate') {
              return { kind: 'reauthenticate' };
            }
            const refused = answer.kind === 'refused' && answer.reason === 'notAuthorized';
            // A plain refusal names no cause: no access token beside a refresh cookie, or another
            // account's.
            if (refused && answer.google === undefined) return 'ask';
            // One that says whether Google is on is a session already over here, its cookies
            // cleared: a token Cognito refused, or a browser no cookie can serve.
            if (answer.kind !== 'signedOut' && !refused) return { kind: 'failed' };
            set('signedOut');
            return answer.logout === undefined
              ? { kind: 'signedOut' }
              : { kind: 'signedOut', logout: answer.logout };
          });
          if (outcome !== 'ask') return outcome;
          // A plain refusal: the refresh cookie may be dead while the pair here is fresh; one
          // refresh says.
          await refresh();
          return ended();
        })().finally(() => {
          everywhere = undefined;
          tell();
        });
        tell();
      }
      return everywhere;
    },
    signOuts: () => begun,
    signingOut: () => leaving !== undefined || everywhere !== undefined,
    accountChanges: () => changes,
    getIdToken: async () => (await fresh())?.idToken,
    getAccount: freshAccount,
  };
}
