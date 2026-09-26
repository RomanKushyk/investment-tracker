/** The four 403s `infra/src/authorize.ts` gives a signed-in caller; none is a 401, since a sign-in
 *  would succeed and change nothing. An admin route also answers `forbidden` to an active user who is
 *  not a super-admin, so only a route every user may call is read this way. */
export type Answer = 'pending' | 'rejected' | 'noApplication' | 'forbidden';

// A Map, not an object: `constructor` and `toString` are keys every object literal answers to.
const ANSWERS = new Map<unknown, Answer>([
  ['pending', 'pending'],
  ['rejected', 'rejected'],
  ['no_application', 'noApplication'],
  ['forbidden', 'forbidden'],
]);

/** The answer a response carries, or `undefined` for any other refusal: the relay's own 403
 *  refuses a request, not a caller. */
export function answerOf(status: number, body: unknown): Answer | undefined {
  if (status !== 403 || typeof body !== 'object' || body === null || !('error' in body)) {
    return undefined;
  }
  return ANSWERS.get(body.error);
}
