import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { KINDS, LANGUAGES, assertLinksOn, render, type Kind, type Params } from './index.ts';
import { PALETTE } from './palette.ts';

// The spec is docs/superpowers/specs/2026-11-07-email/README.md. Its sample values are used here,
// so a render can be laid beside the signed frames.
const ORIGIN = 'https://quirenote.com';
const SAMPLE: { [K in Kind]: Params[K] } = {
  invitation: {
    origin: ORIGIN,
    email: 'reader@example.com',
    expiresAt: new Date('2026-11-14T12:32:00Z'),
  },
  code: { origin: ORIGIN },
};
const ALL = KINDS.flatMap((kind) => LANGUAGES.map((language) => ({ kind, language })));
const rendered = async (kind: Kind, language: (typeof LANGUAGES)[number]) =>
  render(kind, language, SAMPLE[kind] as never);

describe('every kind renders in both languages, within the limits that drop or clip it', () => {
  it.each(ALL)('$kind/$language', async ({ kind, language }) => {
    const { subject, html, text } = await rendered(kind, language);
    expect(subject).not.toBe('');
    // Gmail clips the message body past about 102 KB.
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThanOrEqual(102_000);
    expect(text.trim()).not.toBe('');
  });

  // Cognito drops a CustomMessage longer than 20,000 UTF-8 characters without an error and sends
  // its default instead, and it fills the code into `{####}`.
  it.each(ALL)('$kind/$language keeps {####} under Cognito’s cap', async ({ kind, language }) => {
    const { html } = await rendered(kind, language);
    expect(html).toContain('{####}');
    expect([...html].length).toBeLessThanOrEqual(20_000);
  });

  it('carries the signed copy and the sample’s Kyiv time', async () => {
    const uk = await rendered('invitation', 'uk');
    expect(uk.subject).toBe('Вашу заявку схвалено');
    expect(uk.html).toContain('14.11.2026, 14:32');
    expect(uk.html).toContain('reader@example.com');
    const en = await rendered('code', 'en');
    expect(en.subject).toBe('Your verification code');
  });
});

describe('the markup rules', () => {
  it.each(ALL)('$kind/$language', async ({ kind, language }) => {
    const { html } = await rendered(kind, language);
    expect(html).toMatch(new RegExp(`<div[^>]*\\blang="${language}"[^>]*\\bdir="ltr"`));
    // React Email's Body writes lang="en" unless told otherwise, which a reader's voice obeys.
    for (const [, lang] of html.matchAll(/\blang="([^"]*)"/g)) expect(lang).toBe(language);
    const tables = html.match(/<table\b[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table).toContain('role="presentation"');
    expect(html).toContain('<meta name="color-scheme" content="light dark"');
    expect(html).toContain('<meta name="format-detection"');
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(img).toContain('alt="Quirenote"');
  });

  it.each(ALL)('$kind/$language is titled by its subject', async ({ kind, language }) => {
    const { subject, html } = await rendered(kind, language);
    expect(html.match(/<title>[^<]*<\/title>/g)).toEqual([`<title>${subject}</title>`]);
  });

  // The swap is a string replace, so a marker React stops writing byte for byte fails silently.
  it.each(ALL)(
    '$kind/$language gives classic Outlook its 600 table',
    async ({ kind, language }) => {
      const { html } = await rendered(kind, language);
      expect(html).not.toContain('data-mso-marker');
      expect(html).toContain('<!--[if mso]><table role="presentation" align="center" width="600"');
      expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
    },
  );

  it.each(ALL)('$kind/$language subject and pre-header fit the inbox line', async (c) => {
    const { subject, preheader } = await rendered(c.kind, c.language);
    expect(subject.length).toBeLessThan(45);
    expect(preheader.length).toBeLessThan(90);
  });

  it('puts the action’s URL on its own line in the text part', async () => {
    const { text } = await rendered('invitation', 'uk');
    expect(text.split('\n')).toContain(`${ORIGIN}/sign-in`);
    expect(text.split('\n').every((line) => line.length <= 78)).toBe(true);
  });
});

describe('links stay on the environment’s own origin', () => {
  it.each(ALL)('$kind/$language links only to the origin passed in', async ({ kind, language }) => {
    const { html } = await rendered(kind, language);
    const urls = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith(`${ORIGIN}/`) || url === ORIGIN).toBe(true);
  });

  it('refuses an http: origin, and an origin with a path', async () => {
    await expect(render('code', 'uk', { origin: 'http://quirenote.com' })).rejects.toThrow();
    await expect(render('code', 'uk', { origin: 'https://quirenote.com/x' })).rejects.toThrow();
  });

  it('refuses a link off the origin, and any http: link', () => {
    const page = (href: string) => `<p><a href="${href}">x</a></p>`;
    expect(() => assertLinksOn(page(`${ORIGIN}/sign-in`), ORIGIN)).not.toThrow();
    expect(() => assertLinksOn(page('https://quirenote.com.evil.example/'), ORIGIN)).toThrow();
    expect(() => assertLinksOn(page('https://dev.quirenote.com/'), ORIGIN)).toThrow();
    expect(() => assertLinksOn(page('http://quirenote.com/'), ORIGIN)).toThrow();
    expect(() => assertLinksOn('<img src="https://x.example/a.png">', ORIGIN)).toThrow();
  });
});

// THE PALETTE IS A COPY OF `src/index.css`, and mail cannot read a custom property, so the copy
// is held to the stylesheet rather than to hexes written here.
const here = dirname(fileURLToPath(import.meta.url));

function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}

// The stylesheet read as mark.test.ts reads it: comments stripped quote-aware, each theme a rule
// body matched on its braces, and the last declaration taken, as the browser does.
function stripCss(source: string, what: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else out += c;
  }
  return out;
}

const CSS = stripCss(
  readFileSync(join(here, '..', '..', '..', 'src', 'index.css'), 'utf8'),
  'index.css',
);

function ruleBody(source: string, opener: string): string {
  const at = source.indexOf(`${opener} {`);
  expect(at, `${opener} must be findable — index.css's shape changed`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${opener} is never closed`);
}

const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

function declared(block: keyof typeof BLOCKS, name: string): string {
  const needle = `--color-${name}:`;
  const from = BLOCKS[block].lastIndexOf(needle) >= 0 ? BLOCKS[block] : BLOCKS.light;
  const at = from.lastIndexOf(needle);
  expect(at, `--color-${name} is declared in neither ${block} nor @theme`).toBeGreaterThan(-1);
  const value = from.slice(at + needle.length, from.indexOf(';', at)).trim();
  expect(value, `--color-${name} is not a plain hex in ${block} — resolve the alias here`).toMatch(
    /^#[0-9a-fA-F]{6}$/,
  );
  return value.toLowerCase();
}

describe('every colour is a src/index.css token', () => {
  it('holds each palette entry equal to its token, in both themes', () => {
    for (const theme of ['light', 'dark'] as const)
      for (const [token, hex] of Object.entries(PALETTE[theme]))
        expect(hex, `${theme} ${token}`).toBe(declared(theme, token));
  });

  it('writes no hex outside the palette, in the source or the output', async () => {
    const allowed = new Set(Object.values(PALETTE).flatMap((t) => Object.values(t)));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    for (const path of files(here).filter(
      (p) => !p.endsWith('.test.ts') && !p.endsWith('palette.ts'),
    ))
      expect(
        stripTs(readFileSync(path, 'utf8'), path).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [],
        path,
      ).toEqual([]);
    for (const { kind, language } of ALL) {
      const { html } = await rendered(kind, language);
      for (const hex of html.match(/#[0-9a-fA-F]{6}\b/g) ?? [])
        expect(allowed).toContain(hex.toLowerCase());
    }
  });
});
