import { describe, expect, it, vi } from 'vitest';

import vectors from './__fixtures__/srp-vectors.json';
import {
  type RelayAnswer,
  type RelayCall,
  type RelayRoute,
  type Refusal,
  createRelay,
} from './relay';
import { type Locks, createSession } from './session';
import { type SignInDeps, setNewPassword, signInWithAddress, signInWithPassword } from './sign-in';

const EMAIL = 'someone@example.com';
const PASSWORD = 'Correct-Horse-9!';
const v = vectors[0]!;

const TOKENS: RelayAnswer = {
  kind: 'tokens',
  tokens: { idToken: 'id', expiresIn: 3600 },
};
const challenge = (name: string, parameters: Record<string, string> = {}, available?: string[]) =>
  ({
    kind: 'challenge',
    challenge: {
      challenge: name,
      session: `session-${name}`,
      parameters,
      ...(available && { availableChallenges: available }),
    },
  }) as RelayAnswer;
const refused = (reason: Refusal) => ({ kind: 'refused', reason }) as RelayAnswer;

const VERIFIER = challenge('PASSWORD_VERIFIER', {
  USERNAME: v.userId,
  USER_ID_FOR_SRP: v.userId,
  SRP_B: v.srpB,
  SALT: v.salt,
  SECRET_BLOCK: v.secretBlock,
});
// The dev pool's own answer, which names the user nowhere: the name to answer as is the verifier's.
const NEW_PASSWORD = challenge('NEW_PASSWORD_REQUIRED', {
  requiredAttributes: '[]',
  userAttributes: '{"email_verified":"true","email":"someone@example.com"}',
});
const PASSKEY = challenge(
  'WEB_AUTHN',
  {
    CREDENTIAL_REQUEST_OPTIONS:
      '{"challenge":"abc","rpId":"dev.quirenote.com","allowCredentials":[]}',
  },
  ['PASSWORD_SRP', 'PASSWORD', 'WEB_AUTHN'],
);

/** A lock that records whether it is held, so each relay call can say where it ran. */
function heldLocks() {
  let held = false;
  const locks = {
    request: async (_: string, callback: () => Promise<unknown>) => {
      held = true;
      try {
        return await callback();
      } finally {
        held = false;
      }
    },
  } as unknown as Locks;
  return { locks, held: () => held };
}

function world(
  answers: Partial<Record<RelayRoute, RelayAnswer[]>>,
  authenticate?: SignInDeps['authenticate'],
  hasPasskey?: SignInDeps['hasPasskey'],
) {
  const { locks, held } = heldLocks();
  const calls: { route: RelayRoute; body: unknown; locked: boolean }[] = [];
  const relay: RelayCall = async (route, body) => {
    calls.push({ route, body, locked: held() });
    return answers[route]?.shift() ?? refused('failed');
  };
  const deps: SignInDeps = {
    relay,
    session: createSession({ relay, locks }),
    poolName: v.poolName,
    authenticate: authenticate ?? vi.fn(async () => ({ id: 'credential' })),
    hasPasskey: hasPasskey ?? vi.fn(async () => true),
  };
  return { deps, calls };
}

describe('the address step', () => {
  it('refuses an empty or malformed address before any request', async () => {
    const { deps, calls } = world({});
    expect(await signInWithAddress('  ', deps, vi.fn())).toEqual({
      kind: 'refused',
      reason: 'emailMissing',
    });
    expect(await signInWithAddress('імʼя@пошта.укр', deps, vi.fn())).toEqual({
      kind: 'refused',
      reason: 'emailInvalid',
    });
    expect(calls).toEqual([]);
  });

  it('asks for a passkey first, for the address as the relay will fold it', async () => {
    const { deps, calls } = world({
      start: [challenge('SELECT_CHALLENGE', {}, ['PASSWORD_SRP', 'PASSWORD'])],
    });
    await signInWithAddress(' Someone@Example.com ', deps, vi.fn());
    expect(calls[0]?.body).toEqual({ USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' });
  });

  it('goes straight to the password step on a SELECT_CHALLENGE without WEB_AUTHN', async () => {
    const authenticate = vi.fn();
    const onPasskey = vi.fn();
    const { deps } = world(
      { start: [challenge('SELECT_CHALLENGE', {}, ['PASSWORD_SRP', 'PASSWORD'])] },
      authenticate,
    );
    expect(await signInWithAddress(EMAIL, deps, onPasskey)).toEqual({
      kind: 'password',
      email: EMAIL,
    });
    expect(onPasskey).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  // The relay checks no address pattern and asks for no password here, so neither a 400 nor a
  // 401 at this step may blame the address's letters or a password.
  it.each([
    ['invalid', 'failed'],
    ['throttled', 'tooMany'],
    ['offline', 'offline'],
    ['failed', 'failed'],
    ['notAuthorized', 'failed'],
  ] as const)('reads a %s start as %s', async (reason, expected) => {
    const { deps } = world({ start: [refused(reason)] });
    expect(await signInWithAddress(EMAIL, deps, vi.fn())).toEqual({
      kind: 'refused',
      reason: expected,
    });
  });
});

describe('the passkey step', () => {
  it('opens the sheet straight after the answer and signs in with what it returns', async () => {
    const order: string[] = [];
    const authenticate = vi.fn(async (options: unknown) => {
      order.push('sheet');
      expect(options).toEqual({
        challenge: 'abc',
        rpId: 'dev.quirenote.com',
        allowCredentials: [],
      });
      return { id: 'credential' };
    });
    const { deps, calls } = world({ start: [PASSKEY], respond: [TOKENS] }, authenticate);

    const outcome = await signInWithAddress(EMAIL, deps, () => {
      order.push('step');
    });

    // It has just used a passkey, so there is nothing to offer and nothing to ask.
    expect(outcome).toEqual({ kind: 'signedIn', offerPasskey: false });
    expect(deps.hasPasskey).not.toHaveBeenCalled();
    expect(order).toEqual(['step', 'sheet']);
    expect(calls.map((c) => c.route)).toEqual(['start', 'respond']);
    expect(calls[1]?.body).toEqual({
      challenge: 'WEB_AUTHN',
      session: 'session-WEB_AUTHN',
      responses: { USERNAME: EMAIL, CREDENTIAL: '{"id":"credential"}' },
    });
    expect(deps.session.status()).toBe('signedIn');
  });

  it('reads a cancelled or credential-less sheet as not finished, and asks the relay nothing', async () => {
    const authenticate = vi.fn(async () => {
      throw Object.assign(new Error('The operation either timed out or was not allowed.'), {
        name: 'NotAllowedError',
      });
    });
    const { deps, calls } = world({ start: [PASSKEY] }, authenticate);
    expect(await signInWithAddress(EMAIL, deps, vi.fn())).toEqual({
      kind: 'refused',
      reason: 'notFinished',
    });
    expect(calls.map((c) => c.route)).toEqual(['start']);
  });

  it('reads a passkey challenge without usable options as a failure, and shows no passkey step', async () => {
    const authenticate = vi.fn();
    const onPasskey = vi.fn();
    const broken = challenge('WEB_AUTHN', { CREDENTIAL_REQUEST_OPTIONS: '{not json' });
    const { deps } = world({ start: [broken, challenge('WEB_AUTHN')] }, authenticate);
    for (let i = 0; i < 2; i++) {
      expect(await signInWithAddress(EMAIL, deps, onPasskey)).toEqual({
        kind: 'refused',
        reason: 'failed',
      });
    }
    expect(onPasskey).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('answers as the USERNAME Cognito names, where it names one, as Amplify does', async () => {
    const named = challenge('WEB_AUTHN', {
      USERNAME: v.userId,
      CREDENTIAL_REQUEST_OPTIONS: '{"challenge":"abc"}',
    });
    const { deps, calls } = world({ start: [named], respond: [TOKENS] });
    await signInWithAddress(EMAIL, deps, vi.fn());
    expect((calls[1]?.body as { responses: { USERNAME: string } }).responses.USERNAME).toBe(
      v.userId,
    );
  });

  it('opens no sheet for a step the user has already left', async () => {
    const authenticate = vi.fn();
    const { deps, calls } = world({ start: [PASSKEY] }, authenticate);
    expect(await signInWithAddress(EMAIL, deps, () => false)).toEqual({
      kind: 'refused',
      reason: 'notFinished',
    });
    expect(authenticate).not.toHaveBeenCalled();
    expect(calls.map((c) => c.route)).toEqual(['start']);
  });

  it('reads a refused credential as not finished too', async () => {
    const { deps } = world({ start: [PASSKEY], respond: [refused('notAuthorized')] });
    expect(await signInWithAddress(EMAIL, deps, vi.fn())).toEqual({
      kind: 'refused',
      reason: 'notFinished',
    });
  });
});

describe('the password step', () => {
  it('starts afresh over SRP and answers the verifier as USER_ID_FOR_SRP', async () => {
    const { deps, calls } = world({ start: [VERIFIER], respond: [TOKENS] });

    expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
      kind: 'signedIn',
      offerPasskey: false,
    });

    const [start, respond] = calls;
    expect(start?.body).toMatchObject({ USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP' });
    expect((start?.body as { SRP_A: string }).SRP_A).toMatch(/^[0-9a-f]+$/);
    expect(respond?.body).toMatchObject({
      challenge: 'PASSWORD_VERIFIER',
      session: 'session-PASSWORD_VERIFIER',
      responses: {
        USERNAME: v.userId,
        PASSWORD_CLAIM_SECRET_BLOCK: v.secretBlock,
        PASSWORD_CLAIM_SIGNATURE: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/),
        TIMESTAMP: expect.stringMatching(/^\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} UTC \d{4}$/),
      },
    });
  });

  it('runs only the calls that write the cookies inside the lock', async () => {
    const { deps, calls } = world({ start: [VERIFIER], respond: [TOKENS] });
    await signInWithPassword(EMAIL, PASSWORD, deps);
    expect(calls.map(({ route, locked }) => [route, locked])).toEqual([
      ['start', false],
      ['respond', true],
    ]);
  });

  it('never sends the password, in any encoding, in any part of any request', async () => {
    const sent: string[] = [];
    const answers = [VERIFIER, TOKENS];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.stringify([String(url), init]));
      const answer = answers.shift();
      const body =
        answer?.kind === 'challenge'
          ? answer.challenge
          : answer?.kind === 'tokens'
            ? answer.tokens
            : {};
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const relay = createRelay({ base: 'https://api.test', fetch });
    const { locks } = heldLocks();
    const deps: SignInDeps = {
      relay,
      session: createSession({ relay, locks }),
      poolName: v.poolName,
      authenticate: vi.fn(),
      hasPasskey: vi.fn(async () => true),
    };

    expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
      kind: 'signedIn',
      offerPasskey: false,
    });

    const bytes = new TextEncoder().encode(PASSWORD);
    const base64 = btoa(String.fromCharCode(...bytes));
    const forms = [
      PASSWORD,
      encodeURIComponent(PASSWORD),
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
      base64,
      base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ];
    expect(sent).toHaveLength(2);
    for (const request of sent) for (const form of forms) expect(request).not.toContain(form);
  });

  it('refuses an empty password before any request', async () => {
    const { deps, calls } = world({});
    expect(await signInWithPassword(EMAIL, '', deps)).toEqual({
      kind: 'refused',
      reason: 'passwordMissing',
    });
    expect(calls).toEqual([]);
  });

  // An address with no account gets a verifier challenge like a real one (COGNITO-POOL-PARAMS.md),
  // so only the verifier refuses it, with the same 401 as a wrong password.
  it.each([
    ['a wrong password', { start: [VERIFIER], respond: [refused('notAuthorized')] }],
    ['an address with no account', { start: [VERIFIER], respond: [refused('notAuthorized')] }],
    ['a refused start', { start: [refused('notAuthorized')] }],
  ])('gives %s the same sentence', async (_, answers) => {
    const { deps } = world(answers);
    expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
      kind: 'refused',
      reason: 'wrong',
    });
  });

  it.each([
    ['throttled', 'tooMany'],
    ['offline', 'offline'],
    ['failed', 'failed'],
    ['invalid', 'failed'],
    ['invalidPassword', 'failed'],
    ['reusedPassword', 'failed'],
  ] as const)('reads a %s verifier answer as %s', async (reason, expected) => {
    const { deps } = world({ start: [VERIFIER], respond: [refused(reason)] });
    expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
      kind: 'refused',
      reason: expected,
    });
  });

  // Cognito's lockout refuses the password step's START, before any password is checked.
  it('reads a locked-out start as too many attempts', async () => {
    const { deps } = world({ start: [refused('throttled')] });
    expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
      kind: 'refused',
      reason: 'tooMany',
    });
  });

  it('hands a temporary password on to the first sign-in, signing nobody in', async () => {
    const { deps } = world({ start: [VERIFIER], respond: [NEW_PASSWORD] });
    expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
      kind: 'newPassword',
      email: EMAIL,
    });
    expect(deps.session.status()).toBe('unknown');
    expect(deps.hasPasskey).not.toHaveBeenCalled();
  });

  // Amplify UI's Authenticator asks the same after a sign-in: `listWebAuthnCredentials`, and a
  // prompt only when it is empty.
  it('offers a passkey only when Cognito lists none, asked once the tokens have landed', async () => {
    for (const [listed, offerPasskey] of [
      [false, true],
      [true, false],
      [undefined, false],
    ] as const) {
      const hasPasskey = vi.fn(async () => {
        expect(deps.session.status()).toBe('signedIn');
        return listed;
      });
      const { deps } = world({ start: [VERIFIER], respond: [TOKENS] }, undefined, hasPasskey);
      expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
        kind: 'signedIn',
        offerPasskey,
      });
      expect(hasPasskey).toHaveBeenCalledOnce();
    }
  });

  // «Не зараз» is remembered nowhere: the offer returns on every password sign-in until one exists.
  it('offers again on the next password sign-in of an account that still has none', async () => {
    const { deps } = world(
      { start: [VERIFIER, VERIFIER], respond: [TOKENS, TOKENS] },
      undefined,
      vi.fn(async () => false),
    );
    for (let i = 0; i < 2; i++) {
      expect(await signInWithPassword(EMAIL, PASSWORD, deps)).toEqual({
        kind: 'signedIn',
        offerPasskey: true,
      });
    }
  });

  it('asks nothing about passkeys after a refused password', async () => {
    const { deps } = world({ start: [VERIFIER], respond: [refused('notAuthorized')] });
    await signInWithPassword(EMAIL, PASSWORD, deps);
    expect(deps.hasPasskey).not.toHaveBeenCalled();
  });

  it('refuses without a request where the host has no pool', async () => {
    const { deps, calls } = world({});
    expect(await signInWithPassword(EMAIL, PASSWORD, { ...deps, poolName: undefined })).toEqual({
      kind: 'refused',
      reason: 'failed',
    });
    expect(calls).toEqual([]);
  });
});

describe('the first sign-in', () => {
  const TEMPORARY = 'Tmp-Invite-7x!';
  const CHOSEN = 'My-Own-Pass-8!';

  it('refuses an empty new password against the rule, before any request', async () => {
    const { deps, calls } = world({});
    expect(await setNewPassword(EMAIL, TEMPORARY, '', deps)).toEqual({
      kind: 'refused',
      reason: 'rule',
    });
    expect(calls).toEqual([]);
  });

  // The challenge's session lives three minutes, as the address step's does, so each submit proves
  // the temporary password again over SRP and answers the session that proof returns.
  it('starts afresh with the temporary password and answers NEW_PASSWORD_REQUIRED', async () => {
    const { deps, calls } = world({ start: [VERIFIER], respond: [NEW_PASSWORD, TOKENS] });

    expect(await setNewPassword(EMAIL, TEMPORARY, CHOSEN, deps)).toEqual({
      kind: 'signedIn',
      offerPasskey: true,
    });

    expect(calls.map(({ route, locked }) => [route, locked])).toEqual([
      ['start', false],
      ['respond', true],
      ['respond', true],
    ]);
    expect(calls[0]?.body).toMatchObject({ USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP' });
    expect(calls[2]?.body).toEqual({
      challenge: 'NEW_PASSWORD_REQUIRED',
      session: 'session-NEW_PASSWORD_REQUIRED',
      responses: { USERNAME: v.userId, NEW_PASSWORD: CHOSEN },
    });
    expect(deps.session.status()).toBe('signedIn');
    // An account minted by approval has never held an access token, so it cannot hold a passkey.
    expect(deps.hasPasskey).not.toHaveBeenCalled();
  });

  it('never sends the temporary password, in any encoding', async () => {
    const { deps, calls } = world({ start: [VERIFIER], respond: [NEW_PASSWORD, TOKENS] });
    await setNewPassword(EMAIL, TEMPORARY, CHOSEN, deps);
    const sent = JSON.stringify(calls);
    const bytes = new TextEncoder().encode(TEMPORARY);
    const base64 = btoa(String.fromCharCode(...bytes));
    for (const form of [
      TEMPORARY,
      encodeURIComponent(TEMPORARY),
      Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
      base64,
      base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ]) {
      expect(sent).not.toContain(form);
    }
  });

  it.each([
    ['invalidPassword', 'rule'],
    // The pool's history: the temporary password given back as the new one.
    ['reusedPassword', 'reused'],
    ['throttled', 'tooMany'],
    ['offline', 'offline'],
    ['notAuthorized', 'wrong'],
    ['invalid', 'failed'],
    ['failed', 'failed'],
  ] as const)('reads a %s answer to the new password as %s', async (reason, expected) => {
    const { deps } = world({ start: [VERIFIER], respond: [NEW_PASSWORD, refused(reason)] });
    expect(await setNewPassword(EMAIL, TEMPORARY, CHOSEN, deps)).toEqual({
      kind: 'refused',
      reason: expected,
    });
    expect(deps.session.status()).toBe('unknown');
  });

  it.each([
    ['a refused start', { start: [refused('throttled')] }, 'tooMany'],
    ['a refused proof', { start: [VERIFIER], respond: [refused('notAuthorized')] }, 'wrong'],
    ['a proof answering another challenge', { start: [VERIFIER], respond: [VERIFIER] }, 'failed'],
  ])('reads %s as its sentence, and sends no new password', async (_, answers, expected) => {
    const { deps, calls } = world(answers);
    expect(await setNewPassword(EMAIL, TEMPORARY, CHOSEN, deps)).toEqual({
      kind: 'refused',
      reason: expected,
    });
    expect(JSON.stringify(calls)).not.toContain(CHOSEN);
  });
});
