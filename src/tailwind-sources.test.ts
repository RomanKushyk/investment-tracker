import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';

import { stripCss } from './__fixtures__/palette';

// Without `source()` Tailwind scans from Vite's root, and the docs add utilities to the app's CSS.
// A directive's path that matches nothing is silent, so each must reach a real file.

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const CSS = stripCss(read('index.css'), 'index.css');
/** A direct dependency's manifest: none of the three exports its `package.json`. */
const manifest = (name: string): { version: string; dependencies: Record<string, string> } =>
  JSON.parse(read(`../node_modules/${name}/package.json`));

/** Every `var(--…)` name in the values core's modules export, read at run time. */
async function handedOut(): Promise<string[]> {
  const files = globSync('../packages/core/src/**/*.ts', {
    cwd: here,
    exclude: (f) => /\.test\.ts$|__fixtures__/.test(String(f)),
  });
  const modules = await Promise.all(files.map((f) => import(pathToFileURL(join(here, f)).href)));
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(/var\((--[\w-]+)/g)) names.add(m[1]);
    else if (v && typeof v === 'object' && !seen.has(v)) {
      seen.add(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(modules);
  return [...names];
}

const IMPORT = /@import\s+(['"])tailwindcss\1\s*([^;]*);/;
const SOURCE_ARG = /\bsource\(\s*(['"])(.*?)\1\s*\)/;
const SOURCE = /@source\s+(not\s+)?(['"])(.*?)\2\s*;/g;

describe('Tailwind scans src/ and nothing else', () => {
  it('the import sets the scan base to this directory', () => {
    const imported = CSS.match(IMPORT);
    expect(imported, 'index.css no longer imports tailwindcss').not.toBeNull();
    const base = imported![2].match(SOURCE_ARG)?.[2];
    expect(
      base,
      "the import has no source('…'), so Tailwind scans from the repo root",
    ).toBeDefined();
    expect(relative(here, join(here, base!)), `source('${base}') is not src/`).toBe('');
  });

  it('every @source path reaches a real file', () => {
    const paths = [...CSS.matchAll(SOURCE)].map((m) => m[3]);
    expect(paths, 'no @source directive found; the reader no longer sees them').not.toEqual([]);
    for (const p of paths) {
      const found = globSync([p, `${p}/**`], { cwd: here, withFileTypes: true });
      expect(
        found.some((d) => d.isFile()),
        `@source '${p}' reaches no file from src/`,
      ).toBe(true);
    }
  });

  it('compiles with the Tailwind the Vite plugin builds with', () => {
    const plugin = manifest('@tailwindcss/vite').dependencies;
    for (const name of ['@tailwindcss/node', '@tailwindcss/oxide']) {
      expect(manifest(name).version, `${name} is not the plugin’s`).toBe(plugin[name]);
    }
  });

  // Tailwind drops a theme variable nothing it builds uses, and core's paint strings are the only
  // users of some: the build is compiled as the Vite plugin compiles it.
  it('the built CSS declares every chart token and every variable core hands out', async () => {
    const compiler = await compile(CSS, { base: here, onDependency: () => {} });
    if (typeof compiler.root !== 'object' || compiler.root === null) {
      throw new Error('index.css sets no source() base');
    }
    const sources = [{ ...compiler.root, negated: false }, ...compiler.sources];
    const built = compiler.build(new Scanner({ sources }).scan());
    const chart = [...CSS.matchAll(/(--color-chart-[\w-]+)\s*:/g)].map((m) => m[1]);
    expect(chart, 'index.css declares no chart token; the reader no longer sees them').not.toEqual(
      [],
    );
    const handed = await handedOut();
    expect(handed, 'core hands out no var(); the walk no longer sees its paint').not.toEqual([]);
    const tokens = [...new Set([...chart, ...handed])];
    expect(
      tokens.filter((t) => !built.includes(`${t}:`)),
      'Tailwind pruned variables core hands out as var() strings',
    ).toEqual([]);
  }, 30_000);
});
