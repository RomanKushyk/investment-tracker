// THE RETIRED SENTENCES, NOT THE CLAIM: headers here explained their module by a test that could
// not load `capture.ts`, or had to keep clear of its `@aws-sdk/*` imports for the frontend CI job's
// sake. `infra` is a workspace member, so the deploy jobs install its dependencies at the root and
// tests import `./capture`. A paraphrase needs a reader; a copy does not.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

/** Every file under `infra/src`, fixtures and tests included, since a retired sentence can come
 *  back in any of them; the needles below are split so this file cannot match itself. */
const sources = (): { file: string; text: string }[] =>
  readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .map((path) => ({
      file: `infra/src/${relative(SRC, path).replaceAll('\\', '/')}`,
      text: readFileSync(path, 'utf8'),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

/** Comment markers off and whitespace collapsed, as `cognito-pool.test.ts` reads: a sentence
 *  wrapped across two `//` lines reads clean, and `\r` is whitespace. */
const prose = (text: string): string =>
  text
    .toLowerCase()
    .replace(/^[ \t]*(#|\/\/|--|>)[ \t]?/gm, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ');

describe('no header explains a module by a test that cannot load capture.ts', () => {
  // Each place's sentence as the file carried it, split at the needle so this file cannot match
  // itself: the positive control for every needle, held inline rather than in a fixture the
  // sweep would read.
  const RETIRED: [file: string, extract: string][] = [
    [
      'infra/src/diagnose-reconciliation.ts',
      'its own module so pglite can run it; `capture.ts` cannot load ' + 'in a test.',
    ],
    ['infra/src/dates.ts', 'imports, which the frontend ci job ' + 'cannot resolve.'],
    [
      'infra/src/observe-window.ts',
      'a test for it must not ' + "drag in the handler's `@aws-sdk/*` imports.",
    ],
    [
      'infra/src/quotes.ts',
      'so a test for it does not ' + "drag in the handler's `@aws-sdk/*` imports.",
    ],
  ];
  const NEEDLES = [
    'cannot load ' + 'in a test',
    'must not ' + 'drag in',
    'does not ' + 'drag in the handler',
    'frontend ci job ' + 'cannot resolve',
  ];
  // Literal, word-bounded by lookaround since a needle can end at punctuation.
  const FINDERS = NEEDLES.map((n) => {
    const literal = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [n, new RegExp(`(?<!\\w)${literal}(?!\\w)`)] as const;
  });
  const files = sources();

  it('cuts every needle from a retired sentence, and has one for every place', () => {
    const matches = (r: RegExp) => RETIRED.filter(([, extract]) => r.test(extract));
    expect(FINDERS.filter(([, r]) => matches(r).length === 0).map(([n]) => n)).toEqual([]);
    const caught = new Set(FINDERS.flatMap(([, r]) => matches(r).map(([file]) => file)));
    expect(RETIRED.map(([file]) => file).filter((f) => !caught.has(f))).toEqual([]);
    // A walk that stopped reaching a place would leave the test below passing blind.
    expect(files.map(({ file }) => file)).toEqual(
      expect.arrayContaining(RETIRED.map(([file]) => file)),
    );
    expect(files.some(({ file }) => file.includes('/__fixtures__/'))).toBe(true);
  });

  it('finds none of them under infra/src', () => {
    const offenders = files.flatMap(({ file, text }) =>
      FINDERS.filter(([, r]) => r.test(prose(text))).map(([n]) => `${file}: ${n}`),
    );
    expect(offenders).toEqual([]);
  });
});
