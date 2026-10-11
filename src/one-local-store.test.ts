import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// ONE LOCAL STORE (#404): the demo/live pair, the boot seed and the DEMO badge are gone, and nothing
// brings one back by a new name. A census over the app and the domain package, read through
// TypeScript: it sees the NAMES a module declares or spells (identifiers, string and template text,
// JSX text), never a comment, so a sentence that merely says "seeded" is not a hit and a key such as
// `datasetSwitch` is. Prose is swept by hand, because a guard over prose is a regex over claims.
//
// THE ALLOW-LIST IS PER FILE AND COUNTED, so a second use in a file that is allowed one is a hit.

const ROOTS = ['src', 'packages/core/src'];
const MODULE = /\.[cm]?tsx?$/;
const TEST = /\.test\.[cm]?tsx?$/;

type Kind = 'name' | 'string' | 'text';
const ANY: readonly Kind[] = ['name', 'string', 'text'];

const RETIRED = {
  dataset: { re: /dataset/i, in: ANY }, // the type, the setting, the switch, the copy that named one
  seeded: { re: /seeded/i, in: ANY }, // `ensureSeeded` and the `seeded` flag it kept in `meta`
  demo: { re: /demo/i, in: ANY }, // the badge, the gates, the reset
  демо: { re: /демо/i, in: ANY }, // the same, in the Ukrainian dictionary
  // The demo database's name, as a string: the live one is `quirenote-live`, and the wordmark is JSX text.
  database: { re: /^quirenote$/, in: ['string'] },
} as const satisfies Record<string, { re: RegExp; in: readonly Kind[] }>;
type Needle = keyof typeof RETIRED;

/** What still says a needle, and why it is not the retired thing. */
const ALLOWED: Record<string, Partial<Record<Needle, number>>> = {
  // The DOM's own `dataset`: `root.dataset.theme`, read and written.
  'src/app/theme.ts': { dataset: 2 },
  // `dataset.clear`, an op the server defines (*Cloud target*), and the client's name for it.
  'src/lib/writes.ts': { dataset: 1 },
  'packages/core/src/ops.ts': { dataset: 2 },
  // The staged import replaces the dataset the server holds for the account.
  'src/lib/backup.ts': { dataset: 1 },
  'src/lib/repository.ts': { dataset: 2 },
};

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return MODULE.test(e.name) && !TEST.test(e.name) ? [rel] : [];
  });

const parse = (rel: string, text: string) =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));

/** Every node that spells a name, a string or a run of JSX text, with what it spells. */
function namesIn(sf: ts.SourceFile): { kind: Kind; text: string }[] {
  const out: { kind: Kind; text: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.push({ kind: 'name', text: n.text });
    else if (ts.isStringLiteralLike(n) || ts.isTemplateMiddleOrTemplateTail(n)) {
      out.push({ kind: 'string', text: n.text });
    } else if (ts.isTemplateHead(n)) out.push({ kind: 'string', text: n.text });
    else if (ts.isJsxText(n)) out.push({ kind: 'text', text: n.text });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** `file:needle:count` for every needle a file spells, sorted. */
function hits(sources: { rel: string; sf: ts.SourceFile }[]): string[] {
  return sources
    .flatMap(({ rel, sf }) => {
      const names = namesIn(sf);
      return (Object.keys(RETIRED) as Needle[]).flatMap((needle) => {
        const { re, in: kinds } = RETIRED[needle];
        const count = names.filter(
          (n) => (kinds as readonly Kind[]).includes(n.kind) && re.test(n.text),
        ).length;
        return count > 0 ? [`${rel}:${needle}:${count}`] : [];
      });
    })
    .sort();
}

// Read straight into the parser, as the reader census asks of a guard that parses.
const SOURCES = ROOTS.flatMap(walk).map((rel) => ({
  rel,
  sf: ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  ),
}));

const allowed = Object.entries(ALLOWED)
  .flatMap(([rel, counts]) => Object.entries(counts).map(([needle, n]) => `${rel}:${needle}:${n}`))
  .sort();

describe('the app keeps one local store', () => {
  it('reads the app and the domain package, and the allow-list names files that exist', () => {
    // VACUITY ANCHOR: an empty walk would pass every assertion below.
    expect(SOURCES.length).toBeGreaterThan(150);
    const present = new Set(SOURCES.map((s) => s.rel));
    for (const rel of Object.keys(ALLOWED)) expect(present, rel).toContain(rel);
  });

  it('names no dataset, seed flag, demo or demo database outside the allow-list', () => {
    expect(hits(SOURCES)).toEqual(allowed);
  });

  // The controls are inline and split at the needle, so this file is not a hit for itself.
  describe('the census can tell', () => {
    const control = (text: string) =>
      hits([{ rel: 'src/control.tsx', sf: parse('src/control.tsx', text) }]);

    it.each([
      ['an identifier', 'export const use' + 'Dataset = 1;', 'dataset'],
      ['a type', 'type Data' + 'set = string;', 'dataset'],
      ['a property key', 'const t = { dataset' + 'Switch: 1 };', 'dataset'],
      ['a string', "const k = 'see" + "ded';", 'seeded'],
      ['a function', 'async function ensure' + 'Seeded() {}', 'seeded'],
      ['a template', 'const m = `the De' + 'mo badge`;', 'demo'],
      ['JSX text', '<b>DE' + 'MO</b>;', 'demo'],
      ['a Ukrainian string', "const m = 'Де" + "мо';", 'демо'],
      ['the database name', "const n = 'quire" + "note';", 'database'],
    ] as const)('%s', (_what, text, needle) => {
      expect(control(text)).toEqual([`src/control.tsx:${needle}:1`]);
    });

    it.each([
      ['a comment', '// the dataset is seeded for the demo\nconst a = 1;'],
      ['the live database', "const n = 'quirenote-live';"],
      ['the wordmark', '<span>quirenote</span>;'],
    ])('and leaves %s alone', (_what, text) => {
      expect(control(text)).toEqual([]);
    });
  });
});
