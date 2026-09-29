export interface AuthEnvironment {
  /** The API, where `/auth/*` and `/v1/applications` live, as an origin or a same-origin prefix. */
  relay: string;
  /** Public: every ID token's `iss` carries it. SRP signs with the part after `_`. */
  userPoolId: string;
  /** THE ORIGIN COGNITO SENDS A BROWSER BACK TO — Google's code and a sign-out alike — because the
   *  app client lists this one alone, whichever host asked. None where it lists none. */
  site?: string;
}

const DEV: AuthEnvironment = {
  relay: 'https://api.dev.quirenote.com',
  userPoolId: 'eu-north-1_0L7sKH034',
  site: 'https://dev.quirenote.com',
};
const PROD: AuthEnvironment = {
  relay: 'https://api.quirenote.com',
  userPoolId: 'eu-north-1_WQ5G479B8',
  site: 'https://quirenote.com',
};

// KEYED BY HOST: the relay admits a caller from these hosts alone (CORS, `Sec-Fetch-Site`, the
// passkey relying party), so the host serving the page is its environment and cannot disagree.
export const ENVIRONMENTS: Readonly<Record<string, AuthEnvironment>> = {
  'dev.quirenote.com': DEV,
  'quirenote.com': PROD,
  'www.quirenote.com': PROD,
  // The dev server's proxy makes the dev relay same-origin (`vite.config.ts`).
  localhost: { relay: '/relay', userPoolId: DEV.userPoolId },
};

export function environmentFor(hostname: string): AuthEnvironment | undefined {
  return Object.hasOwn(ENVIRONMENTS, hostname) ? ENVIRONMENTS[hostname] : undefined;
}
