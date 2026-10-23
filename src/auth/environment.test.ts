import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { ENVIRONMENTS, TEST_SITEKEY, botCheckSitekeyFor, environmentFor } from './environment';

type Arms = [string, string, string];
type Cors = { AllowOrigins: string[] };
const template = parseDocument(
  readFileSync(new URL('../../infra/template-user.yaml', import.meta.url), 'utf8'),
).toJS() as {
  Resources: Record<string, { Properties?: Record<string, unknown> }>;
};
const api = template.Resources.PublicApi?.Properties ?? {};
const [, prodCors, devCors] = api.CorsConfiguration as [string, Cors, Cors];
const [, prodDomain, devDomain] = (api.Domain as { DomainName: Arms }).DomainName;
const [, prodRp, devRp] = template.Resources.UserPool?.Properties?.WebAuthnRelyingPartyID as Arms;
const client = template.Resources.UserPoolClient?.Properties ?? {};
const applications = template.Resources.ApplicationsFunction?.Properties ?? {};
const [, prodBotHosts, devBotHosts] = (
  applications.Environment as { Variables: { BOT_CHECK_HOSTNAMES: Arms } }
).Variables.BOT_CHECK_HOSTNAMES;
const relay = template.Resources.AuthRelayFunction?.Properties ?? {};
const [, prodRelayBotHosts, devRelayBotHosts] =
  (relay.Environment as { Variables: { BOT_CHECK_HOSTNAMES?: Arms } }).Variables
    .BOT_CHECK_HOSTNAMES ?? [];
const [[, prodCallback, devCallback]] = client.CallbackURLs as Arms[];
const logouts = client.LogoutURLs as Arms[];
const [prodLogouts, devLogouts] = [logouts.map((arms) => arms[1]), logouts.map((arms) => arms[2])];
/** Where a sign-out leaves for: `/sign-in`, or `/apply` from the no-application answer. */
const LEFT_FOR = ['/sign-in', '/apply'];

// THE HOST IS THE ENVIRONMENT because the relay admits no other: CORS, `Sec-Fetch-Site` and the
// passkey relying party are all keyed to these names in the template, so the table is read against it.
describe.each([
  {
    env: 'dev',
    cors: devCors,
    domain: devDomain,
    rp: devRp,
    callback: devCallback,
    signedOut: devLogouts,
    botHosts: devBotHosts,
    relayBotHosts: devRelayBotHosts,
  },
  {
    env: 'prod',
    cors: prodCors,
    domain: prodDomain,
    rp: prodRp,
    callback: prodCallback,
    signedOut: prodLogouts,
    botHosts: prodBotHosts,
    relayBotHosts: prodRelayBotHosts,
  },
])('the $env hosts', ({ cors, domain, rp, callback, signedOut, botHosts, relayBotHosts }) => {
  const hosts = Object.keys(ENVIRONMENTS).filter(
    (host) => host !== 'localhost' && ENVIRONMENTS[host]?.relay === `https://${domain}`,
  );

  // A PASS NAMES THE HOST IT WAS SOLVED ON, and each function admits only the hosts it is handed:
  // every host rendering this environment's widget, the dev server's included, and no other.
  it('share one bot-check widget, whose hosts are the ones both functions admit', () => {
    const sitekeys = new Set(hosts.map((host) => ENVIRONMENTS[host]?.botCheckSitekey));
    expect(sitekeys.size).toBe(1);
    const [sitekey] = sitekeys;
    const rendering = Object.keys(ENVIRONMENTS).filter(
      (host) => ENVIRONMENTS[host]?.botCheckSitekey === sitekey,
    );
    expect(botHosts.split(',').sort()).toEqual(rendering.sort());
    expect(relayBotHosts).toBe(botHosts);
  });

  it('are all ones the relay answers with credentials', () => {
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) expect(cors.AllowOrigins).toContain(`https://${host}`);
  });

  it('are all inside the passkey relying party', () => {
    for (const host of hosts) expect(host === rp || host.endsWith(`.${rp}`)).toBe(true);
  });

  it('share one pool', () => {
    expect(new Set(hosts.map((host) => ENVIRONMENTS[host]?.userPoolId)).size).toBe(1);
  });

  // COGNITO SENDS A BROWSER ONLY TO URLS THE CLIENT LISTS: Google's code to the callback, a logout
  // to "an authorized sign-out URL". The site is the one the client lists, whichever host asked.
  it('share the one site Cognito returns Google and every sign-out to', () => {
    const sites = new Set(hosts.map((host) => ENVIRONMENTS[host]?.site));
    expect(sites.size).toBe(1);
    const [site] = sites;
    expect(`${site}/auth/callback`).toBe(callback);
    expect(LEFT_FOR.map((to) => `${site}${to}`)).toEqual(signedOut);
  });
});

describe('the dev server', () => {
  it('signs into the dev pool, through its proxy to the dev relay', () => {
    const local = environmentFor('localhost');
    expect(local?.userPoolId).toBe(environmentFor('dev.quirenote.com')?.userPoolId);
    expect(local?.relay.startsWith('/')).toBe(true);
  });

  // NO SITE, SO NO LOGOUT: Cognito lists no localhost URL to send a browser back to.
  it('has no site Cognito returns to, so a sign-out there stays in the app', () => {
    expect(environmentFor('localhost')?.site).toBeUndefined();
  });

  // AN AUTOMATED BROWSER FAILS THE REAL WIDGET, so `?botcheck=test` renders Cloudflare's
  // always-pass key there; the dev relay admits its token only with the proxy's bypass header.
  it('renders the always-pass test widget when asked, and dev’s own otherwise', () => {
    expect(TEST_SITEKEY).toBe('1x00000000000000000000AA');
    expect(botCheckSitekeyFor('localhost', '?botcheck=test')).toBe(TEST_SITEKEY);
    expect(botCheckSitekeyFor('localhost', '?next=%2F&botcheck=test')).toBe(TEST_SITEKEY);
    const dev = environmentFor('dev.quirenote.com')?.botCheckSitekey;
    for (const search of ['', '?botcheck=real', '?botcheck=', '?botcheck=TEST'])
      expect([search, botCheckSitekeyFor('localhost', search)]).toEqual([search, dev]);
  });
});

// A DEV-SERVER SWITCH: the production bundle carries no test widget, on any host.
describe('a production build asked for the test widget on localhost', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps dev’s own', () => {
    vi.stubEnv('DEV', false);
    expect(botCheckSitekeyFor('localhost', '?botcheck=test')).toBe(
      environmentFor('dev.quirenote.com')?.botCheckSitekey,
    );
  });
});

describe('a deployed host asked for the test widget', () => {
  it.each(['dev.quirenote.com', 'quirenote.com', 'www.quirenote.com'])(
    '%s keeps its own',
    (host) => {
      expect(botCheckSitekeyFor(host, '?botcheck=test')).toBe(
        environmentFor(host)?.botCheckSitekey,
      );
      expect(botCheckSitekeyFor(host, '?botcheck=test')).not.toBe(TEST_SITEKEY);
    },
  );

  it('has none where the host has no environment', () => {
    expect(botCheckSitekeyFor('example.com', '?botcheck=test')).toBeUndefined();
  });
});

describe('a host with no environment', () => {
  it('has none, so sign-in is refused rather than sent somewhere', () => {
    expect(environmentFor('dev.d17m4jf400my6.amplifyapp.com')).toBeUndefined();
  });
});
