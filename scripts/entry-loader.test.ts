import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin, type UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import docs from '../vite.config.api-docs.ts';
import app from '../vite.config.ts';
import { REPO } from '../src/repo-root';
import { LOADER, loadEntry } from './entry-loader.ts';

const TAG = '<script type="module" crossorigin src="/assets/index-BziHMKFZ.js"></script>';
const html = (body: string) => `<!doctype html>\n<html><head>${body}</head><body></body></html>\n`;

describe('the built entry is loaded by one inline module whose text never changes', () => {
  it('replaces the parser-inserted entry tag with the loader, carrying the path as data', () => {
    const out = loadEntry(html(`<title>x</title>${TAG}<link rel="stylesheet" href="/a.css">`));
    expect(out).toBe(
      html(
        `<title>x</title><script type="module" id="entry" data-src="/assets/index-BziHMKFZ.js">${LOADER}</script><link rel="stylesheet" href="/a.css">`,
      ),
    );
  });

  it('is one line with no quote that could end the tag, and reads its own data attribute', () => {
    expect(LOADER).not.toMatch(/[\n\r"<]/);
    expect(LOADER).toContain("getElementById('entry')");
    expect(LOADER).toContain('dataset.src');
  });

  it('refuses a page with no entry tag, or with two', () => {
    expect(() => loadEntry(html('<title>x</title>'))).toThrow(/entry/);
    expect(() => loadEntry(html(`${TAG}${TAG}`))).toThrow(/entry/);
  });

  it('leaves the dev server alone, whose entry is the source tag', async () => {
    const server = await createServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'custom',
      logLevel: 'silent',
    });
    try {
      const source = readFileSync(join(REPO, 'index.html'), 'utf8');
      const out = await server.transformIndexHtml('/', source);
      expect(out).toContain('src="/src/main.tsx"');
      expect(out).not.toContain(LOADER);
    } finally {
      await server.close();
    }
  });

  it('is wired into both builds, and the app build inlines no asset', () => {
    const names = (c: UserConfig) => (c.plugins ?? []).flat().map((p) => (p as Plugin).name);
    expect(names(app as UserConfig)).toContain('entry-loader');
    expect(names(docs as UserConfig)).toContain('entry-loader');
    // An inlined font would ship as `data:`, which `font-src 'self'` refuses.
    expect((app as UserConfig).build?.assetsInlineLimit).toBe(0);
  });
});
