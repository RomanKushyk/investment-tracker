// Siteverify decides; this module only asks it, and every answer it cannot read as a pass is not a
// pass. Fetch and the secret are injected, so each case is the exact request and the exact verdict.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchConsole } from './__fixtures__/console';
import {
  MAX_TOKEN,
  SECRET_MS,
  SITEVERIFY,
  SSM_CONFIG,
  type BotCheckConfig,
  cachedSecret,
  readParameterWith,
  verifyWith,
} from './bot-check';

// The client's construction and what it is sent, recorded; nothing reaches AWS.
const ssmSent = vi.hoisted(() => [] as { input: unknown; options: { abortSignal?: unknown } }[]);
vi.mock('@aws-sdk/client-ssm', async (actual) => {
  const real = await actual<typeof import('@aws-sdk/client-ssm')>();
  return {
    ...real,
    SSMClient: vi.fn(function () {
      return {
        send: async (command: { input: unknown }, options: { abortSignal?: unknown }) => {
          ssmSent.push({ input: command.input, options });
          return { Parameter: { Value: 'test-secret-value' } };
        },
      };
    }),
  };
});

const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const SECRET = 'test-secret-value';
const IP = '198.51.100.7';

type Sent = { url: string; init: RequestInit; body: Record<string, unknown> };

/** A siteverify that answers `reply` (or throws it), recording what it was sent. */
const siteverify = (reply: unknown | Error, status = 200) => {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (reply instanceof Error) throw reply;
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
  });
  return { fetch, sent };
};

const config = (over: Partial<BotCheckConfig> = {}): BotCheckConfig => ({
  secret: vi.fn(async () => SECRET),
  forget: vi.fn(),
  hostnames: ['dev.quirenote.com', 'localhost'],
  ...over,
});

const PASSED = { success: true, action: 'apply', hostname: 'dev.quirenote.com', 'error-codes': [] };

describe('a token is only ever judged by siteverify', () => {
  // The accepting twin first: every refusal below is green against a check refusing everything.
  it('passes a token siteverify accepts for this action and host', async () => {
    const { fetch } = siteverify(PASSED);
    await expect(verifyWith(fetch, () => config(), 'apply')(TOKEN, IP)).resolves.toBe('passed');
  });

  it('posts the secret, the token and the caller address to siteverify, with a deadline', async () => {
    const { fetch, sent } = siteverify(PASSED);
    await verifyWith(fetch, () => config(), 'apply')(TOKEN, IP);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(SITEVERIFY);
    expect(sent[0].init.method).toBe('POST');
    expect(sent[0].body).toEqual({ secret: SECRET, response: TOKEN, remoteip: IP });
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  // `remoteip` is optional at siteverify; an absent address is sent as absent, never as "".
  it('sends no remoteip when the event carries none', async () => {
    const { fetch, sent } = siteverify(PASSED);
    await verifyWith(fetch, () => config(), 'apply')(TOKEN, undefined);
    expect(sent[0].body).toEqual({ secret: SECRET, response: TOKEN });
  });

  // Cloudflare's own validator refuses these without a call: a call would spend a request on a
  // token that cannot be one.
  for (const [what, token] of [
    ['an empty token', ''],
    ['a token past the 2048 characters siteverify reads', 'x'.repeat(MAX_TOKEN + 1)],
  ] as const) {
    it(`refuses ${what} without asking siteverify or reading the secret`, async () => {
      const { fetch } = siteverify(PASSED);
      const held = config();
      await expect(verifyWith(fetch, () => held, 'apply')(token, IP)).resolves.toBe('refused');
      expect(fetch).not.toHaveBeenCalled();
      expect(held.secret).not.toHaveBeenCalled();
    });
  }

  it('asks siteverify about a token of exactly 2048 characters', async () => {
    const { fetch } = siteverify(PASSED);
    await verifyWith(fetch, () => config(), 'apply')('x'.repeat(MAX_TOKEN), IP);
    expect(fetch).toHaveBeenCalledOnce();
  });

  for (const codes of [['invalid-input-response'], ['timeout-or-duplicate'], []]) {
    it(`refuses a token siteverify fails with ${JSON.stringify(codes)}`, async () => {
      const { fetch } = siteverify({ success: false, 'error-codes': codes });
      await expect(verifyWith(fetch, () => config(), 'apply')(TOKEN, IP)).resolves.toBe('refused');
    });
  }

  // "Validate the action and hostname when specified": a token solved for another form, or on a
  // host this environment does not serve, is not this form's.
  it('refuses a passed token solved for another action', async () => {
    const { fetch } = siteverify({ ...PASSED, action: 'sign-in' });
    await expect(verifyWith(fetch, () => config(), 'apply')(TOKEN, IP)).resolves.toBe('refused');
  });

  it('refuses a passed token solved on a host this environment does not serve', async () => {
    const { fetch } = siteverify({ ...PASSED, hostname: 'quirenote.com' });
    await expect(verifyWith(fetch, () => config(), 'apply')(TOKEN, IP)).resolves.toBe('refused');
  });

  it('refuses a success that names no action or host', async () => {
    const { fetch } = siteverify({ success: true });
    await expect(verifyWith(fetch, () => config(), 'apply')(TOKEN, IP)).resolves.toBe('refused');
  });
});

describe('a siteverify that cannot answer fails closed, and says so apart from a refusal', () => {
  const cases: [string, unknown | Error, number?][] = [
    ['no answer at all', new TypeError('fetch failed')],
    [
      'its deadline',
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
    ],
    ['a body that is not JSON', '<html>bad gateway</html>', 502],
    ['a JSON body that is not an object', '[]'],
    ['its own internal error', { success: false, 'error-codes': ['internal-error'] }],
    ['a refusal of our secret', { success: false, 'error-codes': ['invalid-input-secret'] }],
    ['a refusal of a missing secret', { success: false, 'error-codes': ['missing-input-secret'] }],
    ['a refusal of the request itself', { success: false, 'error-codes': ['bad-request'] }],
  ];
  for (const [what, reply, status] of cases) {
    it(`answers unavailable on ${what}`, async () => {
      const { fetch } = siteverify(reply, status);
      const watched = watchConsole();
      try {
        await expect(verifyWith(fetch, () => config(), 'apply')(TOKEN, IP)).resolves.toBe(
          'unavailable',
        );
        expect(watched.lines()).toHaveLength(1);
      } finally {
        watched.restore();
      }
    });
  }

  it('answers unavailable when this environment names no parameter or host', async () => {
    const { fetch } = siteverify(PASSED);
    const watched = watchConsole();
    try {
      await expect(verifyWith(fetch, () => undefined, 'apply')(TOKEN, IP)).resolves.toBe(
        'unavailable',
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      watched.restore();
    }
  });

  it('answers unavailable when the secret cannot be read, and asks siteverify nothing', async () => {
    const { fetch } = siteverify(PASSED);
    const unreadable = config({ secret: vi.fn(async () => Promise.reject(new Error('denied'))) });
    const watched = watchConsole();
    try {
      await expect(verifyWith(fetch, () => unreadable, 'apply')(TOKEN, IP)).resolves.toBe(
        'unavailable',
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      watched.restore();
    }
  });

  // A rotation ends the old secret's two-hour overlap; a kept copy would refuse every visitor until
  // the environment is recycled.
  it('forgets the secret siteverify called invalid, and keeps one it accepted', async () => {
    const held = config();
    const watched = watchConsole();
    try {
      await verifyWith(siteverify(PASSED).fetch, () => held, 'apply')(TOKEN, IP);
      expect(held.forget).not.toHaveBeenCalled();
      const refused = { success: false, 'error-codes': ['invalid-input-secret'] };
      await verifyWith(siteverify(refused).fetch, () => held, 'apply')(TOKEN, IP);
      expect(held.forget).toHaveBeenCalledOnce();
    } finally {
      watched.restore();
    }
  });
});

describe('a bot check logs its outcome, never what it was handed', () => {
  const replies: unknown[] = [
    { success: false, 'error-codes': ['invalid-input-response'] },
    { ...PASSED, hostname: 'elsewhere.example' },
    { success: false, 'error-codes': ['internal-error'] },
    new Error(`refused ${TOKEN} from ${IP} with ${SECRET}`),
  ];
  for (const reply of replies) {
    it(`names no token, address or secret on ${JSON.stringify(String(reply))}`, async () => {
      const watched = watchConsole();
      try {
        await verifyWith(siteverify(reply).fetch, () => config(), 'apply')(TOKEN, IP);
        const lines = watched.lines();
        expect(lines).toHaveLength(1);
        for (const secret of [TOKEN, IP, SECRET, 'elsewhere.example'])
          expect(lines[0]).not.toContain(secret);
      } finally {
        watched.restore();
      }
    });
  }

  it('logs nothing for a pass', async () => {
    const watched = watchConsole();
    try {
      await verifyWith(siteverify(PASSED).fetch, () => config(), 'apply')(TOKEN, IP);
      expect(watched.lines()).toEqual([]);
    } finally {
      watched.restore();
    }
  });
});

describe('the secret is read once per environment', () => {
  it('reads once and serves every call after from the first read', async () => {
    const read = vi.fn(async () => SECRET);
    const held = cachedSecret(read);
    await expect(held.secret()).resolves.toBe(SECRET);
    await expect(held.secret()).resolves.toBe(SECRET);
    expect(read).toHaveBeenCalledOnce();
  });

  // A throttled read kept would poison the environment until it is recycled.
  it('keeps no failed read', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('ThrottlingException'))
      .mockResolvedValue(SECRET);
    const held = cachedSecret(read);
    await expect(held.secret()).rejects.toThrow('ThrottlingException');
    await expect(held.secret()).resolves.toBe(SECRET);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads again after it is told to forget', async () => {
    const read = vi.fn(async () => SECRET);
    const held = cachedSecret(read);
    await held.secret();
    held.forget();
    await held.secret();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('the secret is read from SSM inside its own deadline', () => {
  it('asks for the one parameter, decrypted, with a deadline on the call', async () => {
    const send = vi.fn(async () => ({ Parameter: { Value: SECRET } }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await expect(
      readParameterWith(async () => send)('/quirenote/dev/turnstile-secret'),
    ).resolves.toBe(SECRET);
    const [[input, options]] = send.mock.calls as unknown as [[unknown, { abortSignal?: unknown }]];
    expect(input).toEqual({
      Name: '/quirenote/dev/turnstile-secret',
      WithDecryption: true,
    });
    // THE READ'S OWN DEADLINE, the one the function's budget is counted with.
    expect(timeout).toHaveBeenCalledWith(SECRET_MS);
    expect(options.abortSignal).toBe(timeout.mock.results[0]?.value);
    timeout.mockRestore();
  });

  it('refuses a parameter that holds no value', async () => {
    const send = vi.fn(async () => ({ Parameter: {} }));
    await expect(readParameterWith(async () => send)('/p')).rejects.toThrow();
  });

  // THE SDK LOADS ON THE FIRST READ, so its load is not the read's: the deadline starts once the
  // client is in hand.
  it('starts the deadline once the client is in hand', async () => {
    let connected: (send: () => Promise<{ Parameter: { Value: string } }>) => void = () => {};
    const connecting = new Promise<() => Promise<{ Parameter: { Value: string } }>>((resolve) => {
      connected = resolve;
    });
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const reading = readParameterWith(() => connecting)('/p');
    await Promise.resolve();
    expect(timeout).not.toHaveBeenCalled();
    connected(async () => ({ Parameter: { Value: SECRET } }));
    await expect(reading).resolves.toBe(SECRET);
    expect(timeout).toHaveBeenCalledWith(SECRET_MS);
    timeout.mockRestore();
  });

  /** This module afresh, with the SDK's mock and its records cleared. */
  const fresh = async () => {
    vi.resetModules();
    ssmSent.length = 0;
    const sdk = await import('@aws-sdk/client-ssm');
    vi.mocked(sdk.SSMClient).mockClear();
    vi.stubEnv('BOT_CHECK_PARAMETER', '/quirenote/dev/turnstile-secret');
    vi.stubEnv('BOT_CHECK_HOSTNAMES', 'localhost');
    const module = await import('./bot-check');
    return { held: module.fromEnvironment()(), built: vi.mocked(sdk.SSMClient) };
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // THE CLIENT IS BUILT ON THE FIRST READ, never at import: the relay's other routes never read it.
  // Twice at most, not the SDK's default of three with backoff.
  it('builds its client on the first read, once, trying twice at most', async () => {
    const { held, built } = await fresh();
    expect(built).not.toHaveBeenCalled();
    await expect(held?.secret()).resolves.toBe(SECRET);
    held?.forget();
    await expect(held?.secret()).resolves.toBe(SECRET);
    expect(SSM_CONFIG.maxAttempts).toBe(2);
    expect(built.mock.calls).toEqual([[SSM_CONFIG]]);
    expect(ssmSent.map((sent) => sent.input)).toEqual([
      { Name: '/quirenote/dev/turnstile-secret', WithDecryption: true },
      { Name: '/quirenote/dev/turnstile-secret', WithDecryption: true },
    ]);
    for (const sent of ssmSent) expect(sent.options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  // A FAILED LOAD IS NOT KEPT, as a failed read is not.
  it('builds the client again after its construction failed', async () => {
    const { held, built } = await fresh();
    built.mockImplementationOnce(function () {
      throw new Error('the client could not be built');
    });
    await expect(held?.secret()).rejects.toThrow('the client could not be built');
    await expect(held?.secret()).resolves.toBe(SECRET);
    expect(built).toHaveBeenCalledTimes(2);
  });
});
