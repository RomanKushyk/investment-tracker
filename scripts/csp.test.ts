import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../src/repo-root';
import { expected, parsePolicy } from './check-headers.ts';
import { LOADER } from './entry-loader.ts';

// The parser hands a script over with LF endings, which is the text a CSP hash is taken of.
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64');

function bootScript(): string {
  const html = readFileSync(join(REPO, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const boot = scripts.find((s) => s.includes('dataset.theme'));
  if (!boot) throw new Error('index.html no longer carries an inline theme boot script');
  expect(scripts).toHaveLength(1);
  return boot;
}

const SOURCE = readFileSync(join(REPO, 'public/customHttp.yml'), 'utf8');

/** The enforced policy every page carries. A change to it is walked beside it, Report-Only. */
function policy(path = '/sign-in'): string {
  const value = expected(SOURCE, path)['content-security-policy'];
  if (!value) throw new Error(`${path} carries no enforced Content-Security-Policy`);
  return value;
}

describe('the Content-Security-Policy in customHttp.yml', () => {
  it('names the boot script and the loader by hash, and nothing else may run', () => {
    const d = parsePolicy(policy());
    expect(d.get('script-src')).toEqual([
      `'sha256-${sha256(bootScript())}'`,
      `'sha256-${sha256(LOADER)}'`,
      `'strict-dynamic'`,
    ]);
  });

  it('carries the fitted directives and no other', () => {
    const d = parsePolicy(policy());
    expect([...d.keys()].sort()).toEqual(
      [
        'base-uri',
        'connect-src',
        'font-src',
        'form-action',
        'frame-ancestors',
        'img-src',
        'object-src',
        'script-src',
        'style-src',
      ].sort(),
    );
    expect(d.get('object-src')).toEqual([`'none'`]);
    expect(d.get('base-uri')).toEqual([`'none'`]);
    expect(d.get('frame-ancestors')).toEqual([`'none'`]);
    expect(d.get('form-action')).toEqual([`'self'`]);
    // One file serves both branches, so both API hosts are named. Cognito is the relay's to call.
    expect(d.get('connect-src')).toEqual([
      `'self'`,
      'https://api.quirenote.com',
      'https://api.dev.quirenote.com',
      'https://www.inzhur.reit',
    ]);
    expect(d.get('img-src')).toEqual([`'self'`, 'data:']);
    expect(d.get('font-src')).toEqual([`'self'`]);
    // Sonner and Radix write `<style>` elements, and React writes `style` attributes.
    expect(d.get('style-src')).toEqual([`'self'`, `'unsafe-inline'`]);
  });

  it('is the same policy on every page, the API reference included', () => {
    for (const path of ['/', '/auth/callback', '/api-docs.html']) {
      expect(policy(path)).toBe(policy());
    }
  });
  // TURNSTILE, WALKED BESIDE IT: its challenge frame, and the feedback beacon api.js sends from the
  // page with `sendBeacon`, which `connect-src` governs. Nothing else differs.
  it('walks Turnstile beside it: its frame and its beacon, and nothing else', () => {
    const TURNSTILE = 'https://challenges.cloudflare.com';
    for (const path of ['/', '/sign-in', '/auth/callback', '/api-docs.html']) {
      const walked = expected(SOURCE, path)['content-security-policy-report-only'];
      if (!walked) throw new Error(`${path} carries no Report-Only policy`);
      const enforced = parsePolicy(policy(path));
      const beside = parsePolicy(walked);
      expect([...beside.keys()].sort()).toEqual([...enforced.keys(), 'frame-src'].sort());
      expect(beside.get('frame-src')).toEqual([TURNSTILE]);
      expect(beside.get('connect-src')).toEqual([...enforced.get('connect-src')!, TURNSTILE]);
      for (const [name, sources] of enforced)
        if (name !== 'connect-src') expect([name, beside.get(name)]).toEqual([name, sources]);
    }
  });
});
