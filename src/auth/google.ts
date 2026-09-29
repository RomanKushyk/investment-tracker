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

/** The authorize URL the relay bound to this browser, or why there is none. */
export async function beginGoogle(
  relay: RelayCall,
): Promise<{ url: string } | { refused: 'offline' | 'failed' }> {
  const answer = await relay('google/begin');
  if (answer.kind === 'authorize') return { url: answer.url };
  return {
    refused: answer.kind === 'refused' && answer.reason === 'offline' ? 'offline' : 'failed',
  };
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
