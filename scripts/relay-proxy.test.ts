import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { REPO } from '../src/repo-root';
import { relayProxy } from './relay-proxy.ts';

// A home of the test's own, so the owner's real file is never read and never printed.
const home = mkdtempSync(join(tmpdir(), 'relay-proxy-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const file = join(home, '.quirenote', 'bot-check-bypass.txt');

/** The modules as they load under `home`. */
const underHome = async () => {
  vi.resetModules();
  vi.doMock('node:os', async (actual) => ({
    ...(await actual<typeof import('node:os')>()),
    homedir: () => home,
  }));
  return {
    proxy: await import('./relay-proxy.ts'),
    config: (await import('../vite.config')).default,
  };
};
afterEach(() => {
  vi.doUnmock('node:os');
  vi.resetModules();
  rmSync(join(home, '.quirenote'), { recursive: true, force: true });
});

describe('the dev server’s relay proxy', () => {
  it('reaches the dev relay same-origin, as without a bypass', () => {
    const proxy = relayProxy(undefined);
    expect(proxy.target).toBe('https://api.dev.quirenote.com');
    expect(proxy.changeOrigin).toBe(true);
    expect(proxy.rewrite?.('/relay/auth/start')).toBe('/auth/start');
    expect(proxy.rewrite?.('/v1/relay')).toBe('/v1/relay');
  });

  // THE DEV API'S BYPASS IS A CREDENTIAL, so the page never holds it: the proxy adds it on the way.
  it('adds the bypass header when the local value is there, and no header when it is not', () => {
    expect(relayProxy('a-value').headers).toEqual({ 'x-bot-check-bypass': 'a-value' });
    expect('headers' in relayProxy(undefined)).toBe(false);
  });

  it('is what the dev server runs, with the local file and without it', async () => {
    const without = await underHome();
    expect(without.config.server?.proxy?.['/relay']).not.toHaveProperty('headers');
    mkdirSync(join(home, '.quirenote'), { recursive: true });
    writeFileSync(file, 'a-known-value\n');
    const withFile = await underHome();
    expect(withFile.config.server?.proxy?.['/relay']).toHaveProperty('headers', {
      'x-bot-check-bypass': 'a-known-value',
    });
  });
});

describe('the local bypass value', () => {
  // OUTSIDE THE REPOSITORY, beside the owner's other local secrets, so no commit can carry it.
  it('lives in the owner’s home, outside the repository', async () => {
    const { proxy } = await underHome();
    expect(proxy.BYPASS_FILE).toBe(file);
    expect(proxy.BYPASS_FILE.startsWith(REPO)).toBe(false);
  });

  it('is the file’s text without its line ending, or none for a missing or blank file', async () => {
    const { proxy } = await underHome();
    expect(proxy.readBypass()).toBeUndefined();
    mkdirSync(join(home, '.quirenote'), { recursive: true });
    writeFileSync(file, 'the-value\r\n');
    expect(proxy.readBypass()).toBe('the-value');
    writeFileSync(file, '\n');
    expect(proxy.readBypass()).toBeUndefined();
  });
});
