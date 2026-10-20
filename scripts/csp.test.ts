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
        'frame-src',
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
    // Turnstile's api.js sends a feedback beacon from the page, and its challenge is a frame.
    expect(d.get('connect-src')).toEqual([
      `'self'`,
      'https://api.quirenote.com',
      'https://api.dev.quirenote.com',
      'https://www.inzhur.reit',
      'https://challenges.cloudflare.com',
    ]);
    expect(d.get('frame-src')).toEqual(['https://challenges.cloudflare.com']);
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
});
