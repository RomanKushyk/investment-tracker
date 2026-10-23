export interface AuthEnvironment {
  /** The API, where `/auth/*` and `/v1/applications` live, as an origin or a same-origin prefix. */
  relay: string;
  /** Public: every ID token's `iss` carries it. SRP signs with the part after `_`. */
  userPoolId: string;
  /** THE ORIGIN COGNITO SENDS A BROWSER BACK TO — Google's code and a sign-out alike — because the
   *  app client lists this one alone, whichever host asked. None where it lists none. */
  site?: string;
  /** Public: "a public identifier you place in your HTML". Each environment has a Turnstile widget
   *  of its own, listing the hosts that serve it. */
  botCheckSitekey: string;
}

const DEV: AuthEnvironment = {
  relay: 'https://api.dev.quirenote.com',
  userPoolId: 'eu-north-1_0L7sKH034',
  site: 'https://dev.quirenote.com',
  botCheckSitekey: '0x4AAAAAAFbqEE5cnpFtV4wO',
};
const PROD: AuthEnvironment = {
  relay: 'https://api.quirenote.com',
  userPoolId: 'eu-north-1_WQ5G479B8',
  site: 'https://quirenote.com',
  botCheckSitekey: '0x4AAAAAAFbqFIdLC4t2qwVx',
};

// KEYED BY HOST: the relay admits a caller from these hosts alone (CORS, `Sec-Fetch-Site`, the
// passkey relying party), so the host serving the page is its environment and cannot disagree.
export const ENVIRONMENTS: Readonly<Record<string, AuthEnvironment>> = {
  'dev.quirenote.com': DEV,
  'quirenote.com': PROD,
  'www.quirenote.com': PROD,
  // The dev server's proxy makes the dev relay same-origin (`vite.config.ts`); dev's widget lists
  // `localhost`, so its token passes dev's siteverify.
  localhost: { relay: '/relay', userPoolId: DEV.userPoolId, botCheckSitekey: DEV.botCheckSitekey },
};

export function environmentFor(hostname: string): AuthEnvironment | undefined {
  return Object.hasOwn(ENVIRONMENTS, hostname) ? ENVIRONMENTS[hostname] : undefined;
}

/** Cloudflare's always-pass test sitekey, which an automated browser passes; dev's siteverify
 *  refuses its token, so the dev API admits it only with the proxy's bypass header (*Auth model*). */
export const TEST_SITEKEY = '1x00000000000000000000AA';

/** The widget this page renders: the test one on the dev server when `?botcheck=test` asks. A
 *  production build carries no such switch. */
export function botCheckSitekeyFor(hostname: string, search: string): string | undefined {
  if (
    import.meta.env.DEV &&
    hostname === 'localhost' &&
    new URLSearchParams(search).get('botcheck') === 'test'
  )
    return TEST_SITEKEY;
  return environmentFor(hostname)?.botCheckSitekey;
}
