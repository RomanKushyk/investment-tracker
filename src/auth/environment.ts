export interface AuthEnvironment {
  /** The API, where `/auth/*` and `/v1/applications` live, as an origin or a same-origin prefix. */
  relay: string;
  /** Public: every ID token's `iss` carries it. SRP signs with the part after `_`. */
  userPoolId: string;
}

const DEV: AuthEnvironment = {
  relay: 'https://api.dev.quirenote.com',
  userPoolId: 'eu-north-1_0L7sKH034',
};
const PROD: AuthEnvironment = {
  relay: 'https://api.quirenote.com',
  userPoolId: 'eu-north-1_WQ5G479B8',
};

// KEYED BY HOST: the relay admits a caller from these hosts alone (CORS, `Sec-Fetch-Site`, the
// passkey relying party), so the host serving the page is its environment and cannot disagree.
export const ENVIRONMENTS: Readonly<Record<string, AuthEnvironment>> = {
  'dev.quirenote.com': DEV,
  'quirenote.com': PROD,
  'www.quirenote.com': PROD,
  // The dev server's proxy makes the dev relay same-origin (`vite.config.ts`).
  localhost: { ...DEV, relay: '/relay' },
};

export function environmentFor(hostname: string): AuthEnvironment | undefined {
  return Object.hasOwn(ENVIRONMENTS, hostname) ? ENVIRONMENTS[hostname] : undefined;
}
