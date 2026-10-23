// Siteverify decides; this module only asks it, and every answer it cannot read as a pass is not a
// pass. Fetch and the secret are injected, so each case is the exact request and the exact verdict.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchConsole } from './__fixtures__/console';
import {
  MAX_TOKEN,
  SECRET_MS,
  SITEVERIFY,
  SSM_CONFIG,
  BYPASS_FLOOR,
  BYPASS_HEADER,
  BYPASS_TTL_MS,
  type BotCheckConfig,
  type Verdict,
  cachedSecret,
  keptFor,
  readParameterWith,
  verifyWith,
  withBypass,
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

// THE DEV API'S TEST BYPASS (*Auth model*): a header matching a secret the server holds passes the
// relay's check without siteverify; any other header is refused; none leaves siteverify to decide.
describe('a bypass header decides on dev, and only where this environment holds a bypass', () => {
  const BYPASS = 'the-dev-bypass-value-of-forty-characters';
  const stored = (read: () => Promise<string> = async () => BYPASS) => vi.fn(read);
  const siteverifying = () => vi.fn(async (): Promise<Verdict> => 'refused');

  it('names its header', () => {
    expect(BYPASS_HEADER).toBe('x-bot-check-bypass');
  });

  it('passes a matching header without asking siteverify', async () => {
    const verify = siteverifying();
    const watched = watchConsole();
    try {
      await expect(withBypass(verify, stored())(TOKEN, IP, BYPASS)).resolves.toBe('passed');
      expect(verify).not.toHaveBeenCalled();
    } finally {
      watched.restore();
    }
  });

  // A secret saved with its line ending still matches the value a header carries, which has none.
  it('matches a stored value whatever whitespace surrounds it', async () => {
    const watched = watchConsole();
    try {
      const padded = stored(async () => ` ${BYPASS}\n`);
      await expect(withBypass(siteverifying(), padded)(TOKEN, IP, BYPASS)).resolves.toBe('passed');
    } finally {
      watched.restore();
    }
  });

  it('refuses a header that does not match, whatever its length', async () => {
    const verify = siteverifying();
    const watched = watchConsole();
    try {
      for (const wrong of ['', 'x', `${BYPASS}x`, BYPASS.slice(0, -1), BYPASS.toUpperCase()])
        await expect([wrong, await withBypass(verify, stored())(TOKEN, IP, wrong)]).toEqual([
          wrong,
          'refused',
        ]);
      expect(verify).not.toHaveBeenCalled();
    } finally {
      watched.restore();
    }
  });

  // NEVER KEPT: a rotation revokes the old value on the next request, not when the environment recycles.
  it('reads the stored value again for every header', async () => {
    let value = BYPASS;
    const read = stored(async () => value);
    const check = withBypass(siteverifying(), read);
    const watched = watchConsole();
    try {
      await expect(check(TOKEN, IP, BYPASS)).resolves.toBe('passed');
      value = 'the-rotated-bypass-of-forty-characters!!';
      await expect(check(TOKEN, IP, BYPASS)).resolves.toBe('refused');
      await expect(check(TOKEN, IP, 'the-rotated-bypass-of-forty-characters!!')).resolves.toBe(
        'passed',
      );
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      watched.restore();
    }
  });

  // A FLOOR OF 32 CHARACTERS, over 128 bits as base64url: a blank or short stored value is a broken
  // configuration, and an empty header must never match one.
  it('admits nobody when the stored value is blank or shorter than 32 characters', async () => {
    const verify = siteverifying();
    const watched = watchConsole();
    try {
      for (const [weak, presented] of [
        ['\n', ''],
        ['   ', ''],
        ['x'.repeat(31), 'x'.repeat(31)],
      ])
        await expect([
          weak,
          await withBypass(
            verify,
            stored(async () => weak),
          )(TOKEN, IP, presented),
        ]).toEqual([weak, 'unavailable']);
      expect(BYPASS_FLOOR).toBe(32);
      await expect(
        withBypass(
          verify,
          stored(async () => 'x'.repeat(32)),
        )(TOKEN, IP, 'x'.repeat(32)),
      ).resolves.toBe('passed');
      expect(verify).not.toHaveBeenCalled();
    } finally {
      watched.restore();
    }
  });

  it('leaves a request without the header to siteverify, as it was handed', async () => {
    const verify = vi.fn(async (): Promise<Verdict> => 'passed');
    const read = stored();
    await expect(withBypass(verify, read)(TOKEN, IP, undefined)).resolves.toBe('passed');
    expect(verify.mock.calls).toEqual([[TOKEN, IP]]);
    expect(read).not.toHaveBeenCalled();
  });

  // ASVS 5.0 13.4.2: no debug path in production. Without the parameter there is no bypass at all.
  it('ignores the header where this environment holds no bypass', async () => {
    const verify = siteverifying();
    await expect(withBypass(verify, undefined)(TOKEN, IP, BYPASS)).resolves.toBe('refused');
    expect(verify.mock.calls).toEqual([[TOKEN, IP]]);
  });

  it('fails closed when the bypass cannot be read, and asks siteverify nothing', async () => {
    const verify = siteverifying();
    const watched = watchConsole();
    try {
      const unreadable = stored(async () => Promise.reject(new Error(`denied ${BYPASS}`)));
      await expect(withBypass(verify, unreadable)(TOKEN, IP, BYPASS)).resolves.toBe('unavailable');
      expect(verify).not.toHaveBeenCalled();
    } finally {
      watched.restore();
    }
  });

  it('logs one line for each outcome it decides, naming no value, token or address', async () => {
    const cases: [string, () => Promise<string>][] = [
      [BYPASS, async () => BYPASS],
      ['wrong-value', async () => BYPASS],
      [BYPASS, async () => Promise.reject(new Error(`denied ${BYPASS}`))],
    ];
    const said: string[] = [];
    for (const [presented, read] of cases) {
      const watched = watchConsole();
      try {
        await withBypass(siteverifying(), stored(read))(TOKEN, IP, presented);
        const lines = watched.lines();
        expect(lines).toHaveLength(1);
        for (const secret of [BYPASS, 'wrong-value', TOKEN, IP])
          expect(lines[0]).not.toContain(secret);
        said.push(lines[0] ?? '');
      } finally {
        watched.restore();
      }
    }
    expect(said[0]).toBe('bot check: bypassed');
  });

  // The relay's composition, read off this environment as the siteverify check is.
  it('is held only where this environment names its parameter', async () => {
    vi.resetModules();
    vi.stubEnv('BOT_CHECK_BYPASS_PARAMETER', '');
    try {
      const absent = await import('./bot-check');
      expect(absent.bypassFromEnvironment()).toBeUndefined();
      vi.resetModules();
      ssmSent.length = 0;
      vi.stubEnv('BOT_CHECK_BYPASS_PARAMETER', '/quirenote/dev/bot-check-bypass');
      const present = await import('./bot-check');
      const read = present.bypassFromEnvironment();
      await expect(read?.()).resolves.toBe('test-secret-value');
      expect(ssmSent.map((sent) => sent.input)).toEqual([
        { Name: '/quirenote/dev/bot-check-bypass', WithDecryption: true },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  // KEPT FIVE MINUTES, as AWS's Parameters and Secrets extension keeps a parameter by default: a junk
  // header costs one read per environment per window, and a rotation lands within it.
  describe('the stored value is kept for its window', () => {
    it('reads once inside the window, and again after it', async () => {
      let at = 0;
      const read = vi.fn(async () => 'v');
      const kept = keptFor(read, BYPASS_TTL_MS, () => at);
      expect(BYPASS_TTL_MS).toBe(300_000);
      await kept();
      at = BYPASS_TTL_MS - 1;
      await kept();
      expect(read).toHaveBeenCalledOnce();
      at = BYPASS_TTL_MS;
      await kept();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('keeps no failed read', async () => {
      const read = vi.fn<() => Promise<string>>();
      read.mockRejectedValueOnce(new Error('throttled')).mockResolvedValue('v');
      const kept = keptFor(read, BYPASS_TTL_MS, () => 0);
      await expect(kept()).rejects.toThrow('throttled');
      await expect(kept()).resolves.toBe('v');
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('is how this environment holds its parameter', async () => {
      vi.resetModules();
      ssmSent.length = 0;
      vi.stubEnv('BOT_CHECK_BYPASS_PARAMETER', '/quirenote/dev/bot-check-bypass');
      try {
        let at = 0;
        const read = (await import('./bot-check')).bypassFromEnvironment(() => at);
        await read?.();
        await read?.();
        expect(ssmSent).toHaveLength(1);
        at = BYPASS_TTL_MS;
        await read?.();
        expect(ssmSent).toHaveLength(2);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
