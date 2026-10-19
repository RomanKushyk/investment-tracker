// Cloudflare Turnstile, verified server-side: "The client-side widget alone does not protect your
// forms." Siteverify decides; anything this module cannot read as a pass is not one (*Auth model*).
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import { json } from './http';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Siteverify's own bound on a token. */
export const MAX_TOKEN = 2048;
/** THE FUNCTION HAS 5 S for the secret's first read, siteverify, the connection and the insert: past
 *  it, API Gateway answers with a shape of its own. */
export const ANSWER_MS = 2500;
export const SECRET_MS = 1000;

/** THE REFUSAL ITSELF, one constant for missing, malformed, refused and replayed alike: the form
 *  resets the widget for each, and a stranger learns nothing from which it was. */
export const BOT_CHECK_FAILED = json(403, '{"error":"bot_check_failed"}');

/** `unavailable` is ours or Cloudflare's failure, never the caller's, and admits nobody. */
export type Verdict = 'passed' | 'refused' | 'unavailable';
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
const ssm = new SSMClient(SSM_CONFIG);

type Send = (
  command: GetParameterCommand,
  options: { abortSignal: AbortSignal },
) => Promise<{ Parameter?: { Value?: string } }>;

/** THE DEPLOY WRITES THE PARAMETER from the environment's GitHub secret; CloudFormation cannot
 *  create a SecureString, and the function reads it here rather than holding it in its config. */
export const readParameterWith =
  (send: Send) =>
  async (name: string): Promise<string> => {
    const { Parameter } = await send(
      new GetParameterCommand({ Name: name, WithDecryption: true }),
      { abortSignal: AbortSignal.timeout(SECRET_MS) },
    );
    if (!Parameter?.Value) throw new Error('the parameter holds no value');
    return Parameter.Value;
  };
const readParameter = readParameterWith((command, options) => ssm.send(command, options));

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
