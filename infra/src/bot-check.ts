// Cloudflare Turnstile, verified server-side: "The client-side widget alone does not protect your
// forms." Siteverify decides; anything this module cannot read as a pass is not one (*Auth model*).
import { createHash, timingSafeEqual } from 'node:crypto';

import { INTERNAL, type ApiResult, json } from './http';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Siteverify's own bound on a token. */
export const MAX_TOKEN = 2048;
/** The token as each route's body publishes it; one outside it is refused as the 403, not a 400. */
export const TOKEN = { type: 'string', minLength: 1, maxLength: MAX_TOKEN } as const;
/** A token that is not text reads as empty, which the check refuses. */
export const tokenOf = (value: unknown): string => (typeof value === 'string' ? value : '');
/** THE CALLER'S TIMEOUT holds the secret's first read, siteverify and its own work: past it, API
 *  Gateway answers with a shape of its own. */
export const ANSWER_MS = 2500;
export const SECRET_MS = 1000;

/** THE REFUSAL ITSELF, one constant for missing, malformed, refused and replayed alike: the form
 *  resets the widget for each, and a stranger learns nothing from which it was. */
export const BOT_CHECK_FAILED = json(403, '{"error":"bot_check_failed"}');

/** `unavailable` is ours or Cloudflare's failure, never the caller's, and admits nobody. */
export type Verdict = 'passed' | 'refused' | 'unavailable';

/** What a route answers for a verdict, or nothing for a pass. FAIL CLOSED: a check that could not
 *  run admits nobody. */
export const refusalOf = (verdict: Verdict): ApiResult | undefined =>
  verdict === 'passed' ? undefined : verdict === 'refused' ? BOT_CHECK_FAILED : INTERNAL;
export type Verify = (token: string, remoteip: string | undefined) => Promise<Verdict>;

export type BotCheckConfig = {
  secret: () => Promise<string>;
  /** Drops a secret siteverify called invalid, so a rotation is read on the next request. */
  forget: () => void;
  /** The hosts this environment's widget is served on, which a pass must name. */
  hostnames: readonly string[];
};

/** Codes that blame our request, not the token: a pass is impossible until we change. */
const OURS = new Set(['missing-input-secret', 'invalid-input-secret', 'bad-request']);

const nameOf = (err: unknown) => (err instanceof Error ? err.name : typeof err);

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const verifyWith =
  (
    fetch: (url: string, init: RequestInit) => Promise<Response>,
    config: () => BotCheckConfig | undefined,
    action: string,
  ): Verify =>
  async (token, remoteip) => {
    // Cloudflare's own validator turns these away without a call.
    if (token.length === 0 || token.length > MAX_TOKEN) return 'refused';

    const held = config();
    if (held === undefined) {
      console.error('bot check: BOT_CHECK_PARAMETER or BOT_CHECK_HOSTNAMES is not set');
      return 'unavailable';
    }
    let secret: string;
    try {
      secret = await held.secret();
    } catch (err) {
      console.error('bot check: the secret could not be read', nameOf(err));
      return 'unavailable';
    }

    let answer: unknown;
    try {
      const response = await fetch(SITEVERIFY, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, response: token, ...(remoteip ? { remoteip } : {}) }),
        signal: AbortSignal.timeout(ANSWER_MS),
      });
      answer = await response.json();
    } catch (err) {
      console.error('bot check: siteverify gave no answer', nameOf(err));
      return 'unavailable';
    }
    if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
      console.error('bot check: siteverify answered something other than an object');
      return 'unavailable';
    }

    const { success, action: solvedFor, hostname } = answer as Record<string, unknown>;
    const codes = stringsOf((answer as Record<string, unknown>)['error-codes']);
    if (codes.some((code) => OURS.has(code))) {
      if (codes.includes('invalid-input-secret')) held.forget();
      console.error('bot check: siteverify refused our request', { codes });
      return 'unavailable';
    }
    if (codes.includes('internal-error')) {
      console.error('bot check: siteverify failed', { codes });
      return 'unavailable';
    }
    if (success !== true) {
      console.warn('bot check: refused', { codes });
      return 'refused';
    }
    // "Validate the action and hostname when specified"; logged as matches, since a stranger's
    // hostname is the stranger's text.
    const actionMatches = solvedFor === action;
    const hostMatches = typeof hostname === 'string' && held.hostnames.includes(hostname);
    if (!actionMatches || !hostMatches) {
      console.warn('bot check: refused', { actionMatches, hostMatches });
      return 'refused';
    }
    return 'passed';
  };

/** One read per execution environment; A FAILED READ IS NOT KEPT, or one throttle would poison the
 *  environment until it is recycled. */
export const cachedSecret = (read: () => Promise<string>) => {
  let kept: Promise<string> | undefined;
  return {
    secret: () => {
      if (kept) return kept;
      const reading = read();
      kept = reading;
      reading.catch(() => {
        if (kept === reading) kept = undefined;
      });
      return reading;
    },
    forget: () => {
      kept = undefined;
    },
  };
};

/** Two tries inside the read's deadline, not the SDK's default of three with backoff. */
export const SSM_CONFIG = { maxAttempts: 2 };

type Send = (
  input: { Name: string; WithDecryption: true },
  options: { abortSignal: AbortSignal },
) => Promise<{ Parameter?: { Value?: string } }>;

/** THE DEPLOY WRITES THE PARAMETER from the environment's GitHub secret; CloudFormation cannot
 *  create a SecureString. The deadline starts once the client is in hand: its load is not the read. */
export const readParameterWith =
  (connect: () => Promise<Send>) =>
  async (name: string): Promise<string> => {
    const send = await connect();
    const { Parameter } = await send(
      { Name: name, WithDecryption: true },
      { abortSignal: AbortSignal.timeout(SECRET_MS) },
    );
    if (!Parameter?.Value) throw new Error('the parameter holds no value');
    return Parameter.Value;
  };

/** THE SDK RUNS ON THE FIRST READ, which the relay's other routes never make: the bundle carries it,
 *  but only its evaluation waits. A failed load is not kept, as a failed read is not. */
let ssm: Promise<Send> | undefined;
const connect = (): Promise<Send> => {
  if (ssm) return ssm;
  const loading = import('@aws-sdk/client-ssm').then(({ SSMClient, GetParameterCommand }): Send => {
    const client = new SSMClient(SSM_CONFIG);
    return (input, options) => client.send(new GetParameterCommand(input), options);
  });
  ssm = loading;
  loading.catch(() => {
    if (ssm === loading) ssm = undefined;
  });
  return loading;
};
const readParameter = readParameterWith(connect);

/** This environment's configuration, read on the first token that needs it. */
export const fromEnvironment = (): (() => BotCheckConfig | undefined) => {
  let made: BotCheckConfig | undefined;
  return () => {
    if (made) return made;
    const name = process.env.BOT_CHECK_PARAMETER;
    const hostnames = (process.env.BOT_CHECK_HOSTNAMES ?? '').split(',').filter(Boolean);
    if (!name || hostnames.length === 0) return undefined;
    made = { ...cachedSecret(() => readParameter(name)), hostnames };
    return made;
  };
};

/** THE DEV API'S TEST BYPASS (*Auth model*), which the dev server's proxy adds: a credential gated
 *  by a secret this environment holds, never by what the caller says about itself. */
export const BYPASS_HEADER = 'x-bot-check-bypass';

/** The relay's check: the bypass header, when this environment holds a bypass, else siteverify. */
export type Check = (
  token: string,
  remoteip: string | undefined,
  bypass?: string | undefined,
) => Promise<Verdict>;

/** Over 128 bits as base64url; a blank or short stored value is a broken configuration. */
export const BYPASS_FLOOR = 32;

/** Equal-length digests, so the comparison takes the same time whatever either value is. */
const digest = (value: string) => createHash('sha256').update(value).digest();

export const withBypass =
  (verify: Verify, read: (() => Promise<string>) | undefined): Check =>
  async (token, remoteip, presented) => {
    // NO BYPASS IN PRODUCTION (ASVS 5.0 13.4.2): without the parameter the header is not read.
    if (presented === undefined || read === undefined) return verify(token, remoteip);
    let expected: string;
    try {
      // Trimmed as the proxy trims its file: a secret saved with its line ending still matches.
      expected = (await read()).trim();
    } catch (err) {
      console.error('bot check: the bypass could not be read', nameOf(err));
      return 'unavailable';
    }
    // FAIL CLOSED: an empty header must never match a value that trimmed to nothing.
    if (expected.length < BYPASS_FLOOR) {
      console.error('bot check: the stored bypass is shorter than its floor');
      return 'unavailable';
    }
    if (!timingSafeEqual(digest(presented), digest(expected))) {
      console.warn('bot check: bypass refused');
      return 'refused';
    }
    console.info('bot check: bypassed');
    return 'passed';
  };

/** AWS's Parameters and Secrets extension's default TTL: a junk header costs one read per window,
 *  and a rotation revokes the old value within it. */
export const BYPASS_TTL_MS = 300_000;

/** `read`'s answer, kept for `ttl`; A FAILED READ IS NOT KEPT, as `cachedSecret`'s is not. */
export const keptFor = (read: () => Promise<string>, ttl: number, now: () => number) => {
  let kept: { value: Promise<string>; at: number } | undefined;
  return (): Promise<string> => {
    if (kept && now() - kept.at < ttl) return kept.value;
    const entry = { value: read(), at: now() };
    kept = entry;
    entry.value.catch(() => {
      if (kept === entry) kept = undefined;
    });
    return entry.value;
  };
};

/** This environment's bypass, or none where it names no parameter. */
export const bypassFromEnvironment = (
  now: () => number = Date.now,
): (() => Promise<string>) | undefined => {
  const name = process.env.BOT_CHECK_BYPASS_PARAMETER;
  return name ? keptFor(() => readParameter(name), BYPASS_TTL_MS, now) : undefined;
};
