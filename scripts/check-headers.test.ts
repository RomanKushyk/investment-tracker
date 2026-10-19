import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from '../src/repo-root';
import {
  FORBIDDEN,
  PATHS,
  authorization,
  expected,
  hashMismatches,
  inlineScriptHashes,
  mismatches,
  parsePolicy,
} from './check-headers.ts';

const SOURCE = readFileSync(join(REPO, 'public/customHttp.yml'), 'utf8');

const yaml = (entries: { pattern: string; headers: [string, string][] }[]) =>
  'customHeaders:\n' +
  entries
    .map(
      (e) =>
        `  - pattern: '${e.pattern}'\n    headers:\n` +
        e.headers.map(([k, v]) => `      - key: '${k}'\n        value: '${v}'\n`).join(''),
    )
    .join('');

describe('the expected headers come from the file Amplify reads', () => {
  it('applies `**` and the exact path in file order, a later entry winning', () => {
    const source = yaml([
      { pattern: '**', headers: [['Referrer-Policy', 'strict-origin-when-cross-origin']] },
      { pattern: '/assets/**', headers: [['Cache-Control', 'immutable']] },
      { pattern: '/auth/callback', headers: [['Referrer-Policy', 'no-referrer']] },
    ]);
    expect(expected(source, '/sign-in')).toEqual({
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    expect(expected(source, '/auth/callback')).toEqual({ 'referrer-policy': 'no-referrer' });
  });

  it('holds `/` to the `/index.html` entry, which Amplify serves it under', () => {
    const source = yaml([{ pattern: '/index.html', headers: [['Cache-Control', 'no-cache']] }]);
    expect(expected(source, '/')).toEqual({ 'cache-control': 'no-cache' });
    expect(expected(source, '/sign-in')).toEqual({});
  });

  it('refuses a glob it cannot evaluate on a header it would have to hold', () => {
    const source = yaml([{ pattern: '/auth/*', headers: [['X-Frame-Options', 'DENY']] }]);
    expect(() => expected(source, '/auth/callback')).toThrow(/\/auth\/\*/);
  });

  it('the real file yields the fitted set on every probed path', () => {
    expect(PATHS).toEqual(['/', '/sign-in', '/auth/callback']);
    for (const path of PATHS) {
      const got = expected(SOURCE, path);
      expect(got['strict-transport-security']).toBe('max-age=604800; includeSubDomains');
      expect(got['x-content-type-options']).toBe('nosniff');
      expect(got['x-frame-options']).toBe('DENY');
      expect(got['cross-origin-opener-policy']).toBe('same-origin');
      expect(got['referrer-policy']).toBe(
        path === '/auth/callback' ? 'no-referrer' : 'strict-origin-when-cross-origin',
      );
      // Passkey sign-in and registration are WebAuthn; `()` would refuse both.
      expect(got['permissions-policy']).toContain('publickey-credentials-get=(self)');
      expect(got['permissions-policy']).toContain('publickey-credentials-create=(self)');
      expect(got['permissions-policy']).toContain('camera=()');
    }
  });

  it('the real file sets no forbidden header and keeps the three cache rules', () => {
    const doc = parseDocument(SOURCE).toJS() as {
      customHeaders: { pattern: string; headers: { key: string }[] }[];
    };
    const keys = doc.customHeaders.flatMap((e) => e.headers.map((h) => h.key.toLowerCase()));
    expect(FORBIDDEN).toEqual(['clear-site-data', 'x-xss-protection']);
    expect(keys.filter((k) => FORBIDDEN.includes(k))).toEqual([]);
    // The file overrides the console wholesale, so the cache rules must travel with it.
    const cache = doc.customHeaders.filter((e) => e.headers.some((h) => h.key === 'Cache-Control'));
    expect(cache.map((e) => e.pattern)).toEqual(['/index.html', '/assets/**', '/api-docs.html']);
  });
});

describe('a response is compared header by header', () => {
  const want = { 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' };

  it('passes a response that carries every header', () => {
    const got = new Headers({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
    expect(mismatches(want, got)).toEqual([]);
  });

  it('names a missing header, a wrong value and a forbidden one', () => {
    const got = new Headers({
      'X-Frame-Options': 'SAMEORIGIN',
      'X-XSS-Protection': '1; mode=block',
    });
    expect(mismatches(want, got)).toEqual([
      'x-frame-options: wanted "DENY", got "SAMEORIGIN"',
      'x-content-type-options: missing',
      'x-xss-protection: must be absent, got "1; mode=block"',
    ]);
  });
});

describe('the deploy reads the headers back', () => {
  type Step = { name?: string; run?: string; env?: Record<string, string> };
  type Job = {
    needs?: string;
    permissions?: Record<string, string>;
    environment?: { name?: string };
    steps: Step[];
  };
  const jobs = () =>
    (
      parseDocument(
        readFileSync(join(REPO, '.github/workflows/deploy-frontend.yml'), 'utf8'),
      ).toJS() as { jobs: Record<string, Job> }
    ).jobs;
  const steps = () => jobs().verify.steps;

  // IN A JOB OF ITS OWN, AFTER THE DEPLOY: the check runs node on a dependency, which the job
  // holding the OIDC token must not, and it needs the site that job deployed (*Deployment*).
  it('after the deploy, against the host that branch serves', () => {
    const { deploy, verify } = jobs();
    expect(deploy.steps.some((s) => s.run?.includes('deploy-amplify.sh'))).toBe(true);
    expect(verify.needs).toBe('deploy');
    expect(verify.permissions?.['id-token']).toBeUndefined();
    // Dev's pair is an environment secret, so the job resolves the environment the deploy did.
    expect(verify.environment?.name).toBe(deploy.environment?.name);
    const check = steps().find((s) => s.run?.includes('scripts/check-headers.ts'));
    expect(check?.env?.SITE).toBe(
      "${{ github.ref_name == 'main' && 'https://quirenote.com' || 'https://dev.quirenote.com' }}",
    );
  });

  it("takes dev's pair from the environment secret, never from GetBranch", () => {
    // GetBranch answers a transformed password that dev's basic auth refuses.
    const check = steps().find((s) => s.run?.includes('scripts/check-headers.ts'));
    // Dev's alone: `main` resolves `prod`, which holds no such secret and needs none.
    expect(check?.env?.BASIC_AUTH).toBe(
      "${{ github.ref_name != 'main' && secrets.DEV_BASIC_AUTH || '' }}",
    );
    expect(check?.run).not.toContain('get-branch');
  });
});

describe("the page's inline scripts are held to the policy's hashes", () => {
  // SHA-256 of `a()` and of `b()`, base64.
  const A = 'sha256-qVpDBgj7bpq5hMAcGp3AOc79J3Y1Z4HvySTwKrWDoy4=';
  const B = 'sha256-cf242PFc/kb7xD0Qzhsmd9vvRkc+cWFmbi+k+YvtdKc=';
  const page = (...scripts: string[]) => `<html><head>${scripts.join('')}</head></html>`;

  it('splits a policy into directives, each a list of sources', () => {
    const d = parsePolicy(
      `script-src 'sha256-x' 'strict-dynamic';  object-src 'none'; img-src 'self' data:`,
    );
    expect([...d.entries()]).toEqual([
      ['script-src', [`'sha256-x'`, `'strict-dynamic'`]],
      ['object-src', [`'none'`]],
      ['img-src', [`'self'`, 'data:']],
    ]);
  });

  it('reads a directive name in any case and keeps its first occurrence, as a browser does', () => {
    const d = parsePolicy(`Script-Src 'sha256-x'; script-src 'sha256-y'`);
    expect(d.get('script-src')).toEqual([`'sha256-x'`]);
  });

  it('hashes every script with text and no src, the loader with its data attribute included', () => {
    const html = page(
      '<script>a()</script>',
      '<script type="module" id="entry" data-src="/assets/i.js">b()</script>',
    );
    expect(inlineScriptHashes(html)).toEqual([A, B]);
  });

  it('hashes no data block and no empty script, which the policy never checks', () => {
    const html = page(
      '<script>a()</script>',
      '<script type="application/json">{"x":1}</script>',
      '<script type="importmap">{}</script>',
      '<script></script>',
      '<script type="text/javascript">b()</script>',
    );
    expect(inlineScriptHashes(html)).toEqual([A, B]);
  });

  it('reads tags and attributes as HTML does: any case, either quote, any JavaScript type', () => {
    const html = page(
      '<SCRIPT>a()</SCRIPT>',
      "<script type='module'>b()</script>",
      '<script type="text/x-javascript">a()</script>',
      '<!-- <script>b()</script> -->',
    );
    expect(inlineScriptHashes(html)).toEqual([A, B, A]);
    expect(
      hashMismatches(`script-src '${A}' '${B}'`, page('<script SRC="/x.js"></script>')),
    ).toEqual([
      'external script the policy refuses: /x.js',
      `hash admits no script on the page: '${A}'`,
      `hash admits no script on the page: '${B}'`,
    ]);
  });

  it('hashes a script as the parser hands it over, its line endings LF', () => {
    const crlf = page('<script>a(\r\n)</script>');
    expect(inlineScriptHashes(crlf)).toEqual(inlineScriptHashes(page('<script>a(\n)</script>')));
  });

  it('names every external script, which a hash-only strict policy refuses wherever it points', () => {
    const html = page(
      '<script>a()</script>',
      '<script src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>',
    );
    expect(hashMismatches(`script-src '${A}' 'strict-dynamic'`, html)).toEqual([
      'external script the policy refuses: /cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js',
    ]);
  });

  it('passes when the page and the policy name the same hashes', () => {
    const html = page('<script>a()</script>', '<script type="module">b()</script>');
    expect(hashMismatches(`script-src '${A}' '${B}' 'strict-dynamic'`, html)).toEqual([]);
  });

  it('names a script the policy does not admit, and a hash no script carries', () => {
    const html = page('<script>a()</script>');
    expect(hashMismatches(`script-src '${B}' 'strict-dynamic'`, html)).toEqual([
      `inline script not admitted: '${A}'`,
      `hash admits no script on the page: '${B}'`,
    ]);
  });

  it('refuses a policy with no script-src rather than passing a page it did not check', () => {
    expect(() => hashMismatches(`object-src 'none'`, page('<script>a()</script>'))).toThrow(
      /script-src/,
    );
  });
});

describe("dev's pair becomes one Authorization header", () => {
  it('sends none without a pair, and trims a pasted newline', () => {
    expect(authorization(undefined)).toEqual({});
    expect(authorization('u:p\r\n')).toEqual({
      authorization: `Basic ${Buffer.from('u:p').toString('base64')}`,
    });
  });

  it('refuses a value that is not user:pass, such as an encoded pair', () => {
    expect(() => authorization(Buffer.from('u:p').toString('base64'))).toThrow(/user:pass/);
  });
});
