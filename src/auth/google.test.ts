import { describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_FAILED,
  arrivedGoogleFailed,
  beginGoogle,
  belowTheForm,
  completeGoogle,
} from './google';
import type { RelayAnswer, RelayCall } from './relay';

const TOKENS: RelayAnswer = {
  kind: 'tokens',
  tokens: { idToken: 'i', expiresIn: 3600 },
};

describe('beginning a Google sign-in', () => {
  const answering = (answer: RelayAnswer) => vi.fn<RelayCall>(async () => answer);

  it('asks the relay for the authorize URL, and hands it back to leave for', async () => {
    const url = 'https://auth.test/oauth2/authorize?state=s';
    const relay = answering({ kind: 'authorize', url });
    expect(await beginGoogle(relay)).toEqual({ url });
    expect(relay).toHaveBeenCalledWith('google/begin');
  });

  it('reads no connection as offline, and every other answer as a failure', async () => {
    expect(await beginGoogle(answering({ kind: 'refused', reason: 'offline' }))).toEqual({
      refused: 'offline',
    });
    for (const answer of [
      { kind: 'refused', reason: 'failed' },
      { kind: 'refused', reason: 'throttled' },
      TOKENS,
    ] as RelayAnswer[]) {
      expect(await beginGoogle(answering(answer))).toEqual({ refused: 'failed' });
    }
  });
});

describe('coming back from Google', () => {
  const session = (answer: RelayAnswer = TOKENS) => ({ complete: vi.fn(async () => answer) });

  it('hands the code and the state to the relay, and is signed in by its tokens', async () => {
    const s = session();
    expect(await completeGoogle('?code=c1&state=s1', s)).toBe(true);
    expect(s.complete).toHaveBeenCalledWith({ code: 'c1', state: 's1' });
  });

  it('is refused when the relay refuses the code', async () => {
    expect(
      await completeGoogle(
        '?code=c2&state=s2',
        session({ kind: 'refused', reason: 'notAuthorized' }),
      ),
    ).toBe(false);
  });

  // COGNITO SENDS A REFUSAL BACK AS `error` AND `error_description` — the pre-sign-up trigger's
  // English among them — and none of it is ever read, let alone shown.
  it.each([
    '?error=access_denied&error_description=PreSignUp+failed+with+error+Registration+is+by+application.',
    '?error=server_error&state=s3',
    '?state=s4',
    '?code=c5',
    '',
    '?error=access_denied&code=c10&state=s10',
  ])('asks the relay nothing for %j', async (search) => {
    const s = session();
    expect(await completeGoogle(search, s)).toBe(false);
    expect(s.complete).not.toHaveBeenCalled();
  });

  // A CODE IS SPENT ON ITS FIRST EXCHANGE, and StrictMode runs an effect twice in development.
  it('hands one code to the relay once, however often the page asks', async () => {
    const s = session();
    const both = await Promise.all([
      completeGoogle('?code=c6&state=s6', s),
      completeGoogle('?code=c6&state=s6', s),
    ]);
    expect(both).toEqual([true, true]);
    expect(s.complete).toHaveBeenCalledTimes(1);
  });
});

// CRITERION 4: without Google the card runs from «Продовжити» straight to its link, and what stands
// below the form waits for the relay's answer (*Interaction rules*).
describe('what stands below the address form', () => {
  it('is nothing until the relay has answered', () => {
    for (const google of [true, false, undefined]) {
      expect(belowTheForm('unknown', google, false)).toEqual({ link: false, google: false });
    }
  });

  it('is the link, and the Google pair while the relay says Google is on', () => {
    expect(belowTheForm('signedOut', true, false)).toEqual({ link: true, google: true });
    expect(belowTheForm('signedOut', false, false)).toEqual({ link: true, google: false });
    // Unanswered: no flag came, so no Google.
    expect(belowTheForm('signedOut', undefined, false)).toEqual({ link: true, google: false });
  });

  it('is both on a page back from Google, whatever the relay has said yet', () => {
    for (const status of ['unknown', 'signedOut'] as const) {
      for (const google of [true, false, undefined]) {
        expect(belowTheForm(status, google, true)).toEqual({ link: true, google: true });
      }
    }
  });
});

describe('the fact a refused Google flow hands `/sign-in`', () => {
  it('is read from the state it navigates with, and from nothing else', () => {
    expect(arrivedGoogleFailed(GOOGLE_FAILED)).toBe(true);
    for (const other of [
      undefined,
      null,
      {},
      { googleFailed: 'true' },
      { signedOut: true },
      true,
    ]) {
      expect(arrivedGoogleFailed(other), JSON.stringify(other)).toBe(false);
    }
  });
});
