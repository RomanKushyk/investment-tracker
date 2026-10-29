import { canonicalAddress } from '@quirenote/core/address';
import { TERMS_VERSION } from '@quirenote/core/terms';

import { ANSWER_MS } from './relay';

/** `throttled` is API Gateway's 429 on the route; `botCheck` the route's refusal of the token;
 *  `termsOutdated` its 400 for a terms version other than its own; `failed` is any answer the app
 *  cannot act on. */
export type ApplyRefusal =
  | 'emailMissing'
  | 'emailInvalid'
  | 'termsOutdated'
  | 'botCheck'
  | 'throttled'
  | 'offline'
  | 'failed';

export type ApplyOutcome =
  { kind: 'recorded'; email: string } | { kind: 'refused'; reason: ApplyRefusal };

const refused = (reason: ApplyRefusal): ApplyOutcome => ({ kind: 'refused', reason });

// A 400 is the address rule this side already checked, unless it names the terms: then this form and
// the route hold different versions, which a reload settles once both have deployed; until then a
// form or route built before the terms reads the other's 400 as the address. The rest of the body
// is the token, whose refusal is the 403.
const REFUSED: Record<number, ApplyRefusal> = { 400: 'emailInvalid', 429: 'throttled' };

const refusalCode = (body: unknown) =>
  typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;

/** The address rule alone, which the form runs before it waits for a token. */
export function addressRefusal(typed: string): 'emailMissing' | 'emailInvalid' | undefined {
  if (!typed.trim()) return 'emailMissing';
  return canonicalAddress(typed) ? undefined : 'emailInvalid';
}

/** `POST /applications`. Its 202 is one constant for every address, so all it can tell is that
 *  the application was recorded. No cookie: the route reads none, and through the dev server's
 *  proxy the relay's refresh cookie is same-origin and would ride along. */
export function createApply({
  base,
  fetch,
}: {
  base: string | undefined;
  fetch: typeof globalThis.fetch;
}) {
  return async (typed: string, botCheck: string): Promise<ApplyOutcome> => {
    const email = canonicalAddress(typed);
    if (!email) return refused(addressRefusal(typed) ?? 'emailInvalid');
    if (base === undefined) return refused('failed');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANSWER_MS);
    try {
      const response = await fetch(`${base}/applications`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, botCheck, termsVersion: TERMS_VERSION }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => undefined);
      const code = refusalCode(body);
      if (response.status === 403)
        return refused(code === 'bot_check_failed' ? 'botCheck' : 'failed');
      if (response.status === 400 && code === 'terms_outdated') return refused('termsOutdated');
      if (response.status !== 202) return refused(REFUSED[response.status] ?? 'failed');
      const received =
        typeof body === 'object' && body !== null && 'status' in body && body.status === 'received';
      return received ? { kind: 'recorded', email } : refused('failed');
    } catch {
      return refused('offline');
    } finally {
      clearTimeout(timer);
    }
  };
}
