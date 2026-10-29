import type { RelayCall } from './relay';
import type { Session, SessionStatus } from './session';

/** What a refused Google flow hands `/sign-in` as router state, so it says so under the button. */
export const GOOGLE_FAILED = { googleFailed: true } as const;

/** Below the address form: nothing until the relay has answered or the load went unanswered; then
 *  the link, and the pair while Google is on or the page is back from Google. */
export function belowTheForm(
  status: SessionStatus,
  google: boolean | undefined,
  backFromGoogle: boolean,
): { link: boolean; google: boolean } {
  const settled = status !== 'unknown' || backFromGoogle;
  return { link: settled, google: settled && (backFromGoogle || google === true) };
}

/** True only for the state a refused Google flow navigates with. */
export function arrivedGoogleFailed(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'googleFailed' in state &&
    state.googleFailed === true
  );
}

/** The authorize URL the relay bound to this browser, or why there is none. `sub` names the account
 *  a re-authentication is for, which the relay asks Google to sign in again. */
export async function beginGoogle(
  relay: RelayCall,
  sub?: string,
): Promise<{ url: string } | { refused: 'offline' | 'failed' }> {
  const answer = await (sub === undefined ? relay('google/begin') : relay('google/begin', { sub }));
  if (answer.kind === 'authorize') return { url: answer.url };
  return {
    refused: answer.kind === 'refused' && answer.reason === 'offline' ? 'offline' : 'failed',
  };
}

/** What `/profile` is handed back from a re-authentication through Google: its step confirmed, or
 *  refused at Google. Router state, used up on arrival, so a reload opens nothing. */
export const REAUTHENTICATED = { reauthenticated: 'confirmed' } as const;
export const REAUTHENTICATION_REFUSED = { reauthenticated: 'refused' } as const;

export function arrivedReauthentication(state: unknown): 'confirmed' | 'refused' | undefined {
  if (typeof state !== 'object' || state === null || !('reauthenticated' in state))
    return undefined;
  const { reauthenticated } = state;
  return reauthenticated === 'confirmed' || reauthenticated === 'refused'
    ? reauthenticated
    : undefined;
}

// A RE-AUTHENTICATION THIS TAB BEGAN, across Google's redirect: the tab's own storage carries it,
// never the URL, so a pasted callback is a sign-in's (`re-authentication.dc.html` T10).
export const REAUTHENTICATING = 'quirenote-reauthenticating';
type Tab = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function carryReauthentication(tab: Tab | undefined): void {
  try {
    tab?.setItem(REAUTHENTICATING, '1');
  } catch {
    // Storage refused: the return reads as a sign-in's, which lands signed in on `/`.
  }
}

export function reauthenticating(tab: Tab | undefined): boolean {
  try {
    return tab?.getItem(REAUTHENTICATING) === '1';
  } catch {
    return false;
  }
}

export function forgetReauthentication(tab: Tab | undefined): void {
  try {
    tab?.removeItem(REAUTHENTICATING);
  } catch {
    // Nothing was kept where nothing can be.
  }
}

// A CODE IS SPENT ON ITS FIRST EXCHANGE, and StrictMode runs an effect twice in development: one
// exchange per code, whoever asks.
const completing = new Map<string, Promise<boolean>>();

/** Hands Cognito's code and state to the relay; true once signed in. A refusal Cognito sends back
 *  (`error`, the pre-sign-up trigger's English in `error_description`) is never read. */
export function completeGoogle(
  search: string,
  session: Pick<Session, 'complete'>,
): Promise<boolean> {
  const params = new URLSearchParams(search);
  const code = params.get('code');
  const state = params.get('state');
  if (params.has('error') || !code || !state) return Promise.resolve(false);
  let done = completing.get(code);
  if (done === undefined) {
    done = session.complete({ code, state }).then((answer) => answer.kind === 'tokens');
    completing.set(code, done);
  }
  return done;
}
