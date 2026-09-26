import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { ENVIRONMENTS, environmentFor } from './environment';

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

// THE HOST IS THE ENVIRONMENT because the relay admits no other: CORS, `Sec-Fetch-Site` and the
// passkey relying party are all keyed to these names in the template, so the table is read against it.
describe.each([
  { env: 'dev', cors: devCors, domain: devDomain, rp: devRp },
  { env: 'prod', cors: prodCors, domain: prodDomain, rp: prodRp },
])('the $env hosts', ({ cors, domain, rp }) => {
  const hosts = Object.keys(ENVIRONMENTS).filter(
    (host) => host !== 'localhost' && ENVIRONMENTS[host]?.relay === `https://${domain}`,
  );

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
});

describe('the dev server', () => {
  it('signs into the dev pool, through its proxy to the dev relay', () => {
    const local = environmentFor('localhost');
    expect(local?.userPoolId).toBe(environmentFor('dev.quirenote.com')?.userPoolId);
    expect(local?.relay.startsWith('/')).toBe(true);
  });
});

describe('a host with no environment', () => {
  it('has none, so sign-in is refused rather than sent somewhere', () => {
    expect(environmentFor('dev.d17m4jf400my6.amplifyapp.com')).toBeUndefined();
  });
});
