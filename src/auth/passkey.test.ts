import { describe, expect, it, vi } from 'vitest';

import { type PasskeyDeps, addPasskey, createCognito, hasPasskey } from './passkey';

const OPTIONS = { challenge: 'c', rp: { id: 'dev.quirenote.com', name: 'quirenote' } };
const CREDENTIAL = { id: 'cred', response: { attestationObject: 'a' } };
/** The offer is still on screen when Start answers. */
const HERE = () => true;

type Sent = { url: string; init: RequestInit };

/** Cognito's endpoint, answering each operation in turn. */
function endpoint(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const answer = answers.shift() ?? new Response('{}', { status: 500 });
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const operations = () =>
    sent.map((s) => [
      (s.init.headers as Record<string, string>)['x-amz-target'],
      JSON.parse(String(s.init.body)),
    ]);
  return { fetch, sent, operations };
}

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
// Cognito's JSON protocol names the refusal in `__type`.
const refusal = (type: string) =>
  new Response(JSON.stringify({ __type: type, message: 'no' }), { status: 400 });

function deps(
  answers: (Response | Error)[],
  { token = 'access.1', register }: { token?: string; register?: PasskeyDeps['register'] } = {},
) {
  const cognito = endpoint(...answers);
  const d: PasskeyDeps = {
    cognito: createCognito({ region: 'eu-north-1', fetch: cognito.fetch }),
    getAccessToken: vi.fn(async () => token || undefined),
    register: register ?? vi.fn(async () => CREDENTIAL),
  };
  return { d, ...cognito };
}

describe('a Cognito call', () => {
  // Amplify JS's own transport: an unsigned JSON POST naming the operation, never cached.
  it('posts the operation to the region endpoint as Amplify JS does', async () => {
    const { fetch, sent } = endpoint(ok({ a: 1 }));
    const cognito = createCognito({ region: 'eu-north-1', fetch });
    expect(await cognito('ListWebAuthnCredentials', { AccessToken: 't' })).toEqual({
      kind: 'ok',
      body: { a: 1 },
    });
    expect(sent).toEqual([
      {
        url: 'https://cognito-idp.eu-north-1.amazonaws.com/',
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target': 'AWSCognitoIdentityProviderService.ListWebAuthnCredentials',
            'cache-control': 'no-store',
          },
          body: '{"AccessToken":"t"}',
          signal: expect.any(AbortSignal),
        },
      },
    ]);
  });

  // A signed-in page waits on the list before it leaves, so a stalled answer must end, and at the
  // same bound as every relay call.
  it('gives up on an answer that has not come in 30 seconds, as offline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'AbortError')),
            ),
          ),
      );
      let settled: unknown;
      void createCognito({ region: 'eu-north-1', fetch })('X', {}).then((a) => (settled = a));
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toEqual({ kind: 'refused', reason: 'offline' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads an empty 200, as CompleteWebAuthnRegistration answers, as done', async () => {
    const { fetch } = endpoint(new Response('', { status: 200 }));
    expect(await createCognito({ region: 'eu-north-1', fetch })('X', {})).toEqual({
      kind: 'ok',
      body: {},
    });
  });

  it.each([
    ['a refusal', refusal('NotAuthorizedException'), 'failed'],
    ['a fault', new Response('', { status: 500 }), 'failed'],
    ['no network', new TypeError('Failed to fetch'), 'offline'],
  ])('reads %s as %s', async (_, answer, reason) => {
    const { fetch } = endpoint(answer);
    expect(await createCognito({ region: 'eu-north-1', fetch })('X', {})).toEqual({
      kind: 'refused',
      reason,
    });
  });

  it('sends nothing where the host has no pool', async () => {
    const { fetch } = endpoint();
    expect(await createCognito({ region: undefined, fetch })('X', {})).toEqual({
      kind: 'refused',
      reason: 'failed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('whether the account has a passkey', () => {
  it.each([
    [{ Credentials: [] }, false],
    [{ Credentials: [{ CredentialId: 'x' }] }, true],
    [{}, undefined],
    [{ Credentials: 'x' }, undefined],
  ])('reads %j as %s', async (body, expected) => {
    const { d, operations } = deps([ok(body)]);
    expect(await hasPasskey(d)).toBe(expected);
    expect(operations()).toEqual([
      [
        'AWSCognitoIdentityProviderService.ListWebAuthnCredentials',
        { AccessToken: 'access.1', MaxResults: 1 },
      ],
    ]);
  });

  it('does not know when Cognito cannot say, or there is no token to ask with', async () => {
    expect(await hasPasskey(deps([refusal('InternalErrorException')]).d)).toBeUndefined();
    expect(await hasPasskey(deps([new TypeError('offline')]).d)).toBeUndefined();
    const none = deps([], { token: '' });
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
    const { d, operations } = deps([ok({ CredentialCreationOptions: OPTIONS }), ok()], {
      register,
    });

    expect(await addPasskey(d, HERE)).toBe('created');

    expect(register).toHaveBeenCalledOnce();
    expect(operations()).toEqual([
      ['AWSCognitoIdentityProviderService.StartWebAuthnRegistration', { AccessToken: 'access.1' }],
      [
        'AWSCognitoIdentityProviderService.CompleteWebAuthnRegistration',
        { AccessToken: 'access.1', Credential: CREDENTIAL },
      ],
    ]);
  });

  // Cancelled, timed out, or nowhere to store one: WebAuthn does not say which, and nothing was made.
  it('reads a dialog that did not finish as not created, and completes nothing', async () => {
    const register = vi.fn(async () => {
      throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
    });
    const { d, operations } = deps([ok({ CredentialCreationOptions: OPTIONS })], { register });
    expect(await addPasskey(d, HERE)).toBe('notCreated');
    expect(operations()).toHaveLength(1);
  });

  it.each([
    ['a refused start', [refusal('WebAuthnNotEnabledException')], 'failed'],
    ['a start with no network', [new TypeError('offline')], 'offline'],
    [
      'a refused completion',
      [ok({ CredentialCreationOptions: OPTIONS }), refusal('WebAuthnOriginNotAllowedException')],
      'failed',
    ],
    [
      'a completion with no network',
      [ok({ CredentialCreationOptions: OPTIONS }), new TypeError('offline')],
      'offline',
    ],
  ])('reads %s as %s', async (_, answers, expected) => {
    const { d } = deps(answers);
    expect(await addPasskey(d, HERE)).toBe(expected);
  });

  // The offer can be left while Start is in flight; its answer must not open a dialog over the app.
  it('opens no dialog once the step has been left, and completes nothing', async () => {
    const { d, operations, fetch } = deps([ok({ CredentialCreationOptions: OPTIONS }), ok()]);
    // Still on screen when the press sent Start; left by the time it answers.
    expect(await addPasskey(d, () => fetch.mock.calls.length === 0)).toBe('notCreated');
    expect(d.register).not.toHaveBeenCalled();
    expect(operations()).toHaveLength(1);
  });

  it('opens no dialog for a start that carries no options', async () => {
    const { d, operations } = deps([ok({}), ok()]);
    expect(await addPasskey(d, HERE)).toBe('failed');
    expect(d.register).not.toHaveBeenCalled();
    expect(operations()).toHaveLength(1);
  });

  it('asks nothing without an access token', async () => {
    const { d, fetch } = deps([], { token: '' });
    expect(await addPasskey(d, HERE)).toBe('failed');
    expect(fetch).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
  });
});
