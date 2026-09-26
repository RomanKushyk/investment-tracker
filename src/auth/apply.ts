import { canonicalAddress } from '@quirenote/core/address';

import { ANSWER_MS } from './relay';

/** `throttled` is API Gateway's 429 on the route; `failed` is any answer the app cannot act on. */
export type ApplyRefusal = 'emailMissing' | 'emailInvalid' | 'throttled' | 'offline' | 'failed';

export type ApplyOutcome =
  { kind: 'recorded'; email: string } | { kind: 'refused'; reason: ApplyRefusal };

const refused = (reason: ApplyRefusal): ApplyOutcome => ({ kind: 'refused', reason });

// A 400 can only be the address rule this side already checked: the body holds nothing else.
const REFUSED: Record<number, ApplyRefusal> = { 400: 'emailInvalid', 429: 'throttled' };

/** `POST /v1/applications`. Its 202 is one constant for every address, so all it can tell is that
 *  the application was recorded. No cookie: the route reads none, and through the dev server's
 *  proxy the relay's refresh cookie is same-origin and would ride along. */
export function createApply({
  base,
  fetch,
}: {
  base: string | undefined;
  fetch: typeof globalThis.fetch;
}) {
  return async (typed: string): Promise<ApplyOutcome> => {
    if (!typed.trim()) return refused('emailMissing');
    const email = canonicalAddress(typed);
    if (!email) return refused('emailInvalid');
    if (base === undefined) return refused('failed');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANSWER_MS);
    try {
      const response = await fetch(`${base}/v1/applications`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: controller.signal,
      });
      if (response.status !== 202) return refused(REFUSED[response.status] ?? 'failed');
      const body: unknown = await response.json().catch(() => undefined);
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
