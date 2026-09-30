import { describe, expect, it, vi } from 'vitest';

import { type PasskeyDeps, addPasskey, hasPasskey } from './passkey';
import { createRelay } from './relay';

const BASE = 'https://api.test';
const OPTIONS = { challenge: 'c', rp: { id: 'dev.quirenote.com', name: 'quirenote' } };
const CREDENTIAL = { id: 'cred', response: { attestationObject: 'a' } };
/** The offer is still on screen when Start answers. */
const HERE = () => true;
/** The account the tab's ID token names. */
const ACCOUNT = 'user-1';

type Sent = { url: string; init: RequestInit };

/** The relay, answering each call in turn; what was asked reads back as the path and the body. */
function relayAnswering(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const answer = answers.shift() ?? new Response('{}', { status: 500 });
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const asked = () =>
    sent.map((s) => [
      s.url.slice(BASE.length),
      s.init.body === undefined ? undefined : JSON.parse(String(s.init.body)),
    ]);
  return { relay: createRelay({ base: BASE, fetch }), fetch, sent, asked };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const refused = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status });

function deps(
  answers: (Response | Error)[],
  { signedIn = true, register }: { signedIn?: boolean; register?: PasskeyDeps['register'] } = {},
) {
  const relay = relayAnswering(...answers);
  const d: PasskeyDeps = {
    relay: relay.relay,
    account: vi.fn(async () => (signedIn ? ACCOUNT : undefined)),
    register: register ?? vi.fn(async () => CREDENTIAL),
  };
  return { d, ...relay };
}

// THE PAGE HOLDS NO ACCESS TOKEN (*Auth model*): each passkey call goes to the relay, naming the
// account the tab shows, and none reaches Cognito's endpoint.
describe('the passkey calls', () => {
  it('go to the relay, each with its cookies and the header it asks for, and nowhere else', async () => {
    const { d, sent } = deps([
      ok({ passkey: false }),
      ok({ options: OPTIONS }),
      ok({ status: 'registered' }),
    ]);
    await hasPasskey(d);
    await addPasskey(d, HERE);
    expect(sent.map((s) => s.url)).toEqual([
      `${BASE}/auth/passkey/list`,
      `${BASE}/auth/passkey/start`,
      `${BASE}/auth/passkey/complete`,
    ]);
    for (const { init } of sent) {
      expect(init.credentials).toBe('include');
      expect((init.headers as Record<string, string>)['x-csrf']).toBe('1');
    }
  });
});

describe('whether the account has a passkey', () => {
  it.each([
    [{ passkey: false }, false],
    [{ passkey: true }, true],
    [{}, undefined],
    [{ passkey: 'yes' }, undefined],
  ])('reads %j as %s', async (body, expected) => {
    const { d, asked } = deps([ok(body)]);
    expect(await hasPasskey(d)).toBe(expected);
    expect(asked()).toEqual([['/auth/passkey/list', { sub: ACCOUNT }]]);
  });

  it('does not know when the relay cannot say, or nobody is signed in to ask for', async () => {
    expect(await hasPasskey(deps([refused(401, 'not_authorized')]).d)).toBeUndefined();
    expect(await hasPasskey(deps([refused(500, 'internal')]).d)).toBeUndefined();
    expect(await hasPasskey(deps([new TypeError('offline')]).d)).toBeUndefined();
    const none = deps([], { signedIn: false });
    expect(await hasPasskey(none.d)).toBeUndefined();
    expect(none.fetch).not.toHaveBeenCalled();
  });
});

describe('adding a passkey', () => {
  it('starts, opens the OS dialog with Cognito’s options, and completes with what it made', async () => {
    const register = vi.fn(async (options: unknown) => {
      expect(options).toEqual(OPTIONS);
      return CREDENTIAL;
    });
    const { d, asked } = deps([ok({ options: OPTIONS }), ok({ status: 'registered' })], {
      register,
    });

    expect(await addPasskey(d, HERE)).toBe('created');

    expect(register).toHaveBeenCalledOnce();
    expect(asked()).toEqual([
      ['/auth/passkey/start', { sub: ACCOUNT }],
      ['/auth/passkey/complete', { sub: ACCOUNT, credential: CREDENTIAL }],
    ]);
  });

  // SAFARI BEFORE 17.4 OPENS THE DIALOG ONLY AFTER ONE FETCH AND NO OTHER WAIT, so while the session
  // is fresh Start is the only request before it.
  it('sends Start alone before the dialog opens', async () => {
    let before = -1;
    const { d, fetch } = deps([ok({ options: OPTIONS }), ok({ status: 'registered' })], {
      register: vi.fn(async () => {
        before = fetch.mock.calls.length;
        return CREDENTIAL;
      }),
    });
    await addPasskey(d, HERE);
    expect(before).toBe(1);
  });

  // Cancelled, timed out, or nowhere to store one: WebAuthn does not say which, and nothing was made.
  it('reads a dialog that did not finish as not created, and completes nothing', async () => {
    const register = vi.fn(async () => {
      throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
    });
    const { d, asked } = deps([ok({ options: OPTIONS })], { register });
    expect(await addPasskey(d, HERE)).toBe('notCreated');
    expect(asked()).toHaveLength(1);
  });

  it.each([
    ['a start the token no longer admits', 'failed', [refused(401, 'not_authorized')]],
    ['a refused start', 'failed', [refused(400, 'invalid_request')]],
    ['a throttled start', 'failed', [refused(429, 'too_many_requests')]],
    ['a start with no network', 'offline', [new TypeError('offline')]],
    ['a refused completion', 'failed', [ok({ options: OPTIONS }), refused(400, 'invalid_request')]],
    ['a completion that fails', 'failed', [ok({ options: OPTIONS }), refused(500, 'internal')]],
    [
      'a completion with no network',
      'offline',
      [ok({ options: OPTIONS }), new TypeError('offline')],
    ],
  ])('reads %s as %s', async (_, expected, answers) => {
    const { d } = deps(answers);
    expect(await addPasskey(d, HERE)).toBe(expected);
  });

  // The offer can be left while Start is in flight; its answer must not open a dialog over the app.
  it('opens no dialog once the step has been left, and completes nothing', async () => {
    const { d, asked, fetch } = deps([ok({ options: OPTIONS }), ok({ status: 'registered' })]);
    // Still on screen when the press sent Start; left by the time it answers.
    expect(await addPasskey(d, () => fetch.mock.calls.length === 0)).toBe('notCreated');
    expect(d.register).not.toHaveBeenCalled();
    expect(asked()).toHaveLength(1);
  });

  it('opens no dialog for a start that carries no options', async () => {
    const { d, asked } = deps([ok({}), ok({ status: 'registered' })]);
    expect(await addPasskey(d, HERE)).toBe('failed');
    expect(d.register).not.toHaveBeenCalled();
    expect(asked()).toHaveLength(1);
  });

  it('asks nothing when nobody is signed in', async () => {
    const { d, fetch } = deps([], { signedIn: false });
    expect(await addPasskey(d, HERE)).toBe('failed');
    expect(fetch).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
  });
});
