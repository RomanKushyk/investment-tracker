import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

// Reads a deployed site's headers back against public/customHttp.yml, the file Amplify applies,
// so the check holds no second list (*Deployment*).
const HERE = fileURLToPath(import.meta.url);
const SOURCE = resolve(dirname(HERE), '../public/customHttp.yml');

/** The pages probed: the shell, a rewritten route, and the one page with its own entry. */
export const PATHS = ['/', '/sign-in', '/auth/callback'];
/** `storage` would delete what the app keeps, and the XSS auditor's header creates holes (MDN). */
export const FORBIDDEN = ['clear-site-data', 'x-xss-protection'];
/** The policy's key, Report-Only while a change is walked, enforced otherwise. */
export const CSP_KEYS = ['content-security-policy', 'content-security-policy-report-only'];

type Entry = { pattern: string; headers: { key: string; value: string }[] };

/** The headers `path` must carry: every `**` or exact entry, in file order, a later one winning.
 *  `/` is served as `/index.html` and takes its entry, as measured on the live host. Any other
 *  pattern names no probed path, unless it is a glob this cannot evaluate. */
export function expected(source: string, path: string): Record<string, string> {
  const { customHeaders } = parseDocument(source).toJS() as { customHeaders: Entry[] };
  const out: Record<string, string> = {};
  for (const { pattern, headers } of customHeaders) {
    if (pattern !== '**' && pattern !== path && !(path === '/' && pattern === '/index.html')) {
      // A literal is another page's, and so is a glob whose literal prefix the path lacks; any
      // other glob might be this one's, so refuse to guess.
      const wild = pattern.search(/[*?[{]/);
      if (wild >= 0 && path.startsWith(pattern.slice(0, wild))) {
        throw new Error(`cannot tell whether ${pattern} matches ${path}`);
      }
      continue;
    }
    for (const { key, value } of headers) out[key.toLowerCase()] = value;
  }
  return out;
}

/** One line per header that is missing, wrong, or forbidden and present. */
export function mismatches(want: Record<string, string>, got: Headers): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(want)) {
    const actual = got.get(key);
    if (actual === null) out.push(`${key}: missing`);
    else if (actual !== value) out.push(`${key}: wanted "${value}", got "${actual}"`);
  }
  for (const key of FORBIDDEN) {
    const actual = got.get(key);
    if (actual !== null) out.push(`${key}: must be absent, got "${actual}"`);
  }
  return out;
}

/** A policy as directives, each its list of sources. Names fold case and the first occurrence
 *  wins, as CSP3's parser has it. */
export function parsePolicy(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), sources);
  }
  return out;
}

/** Every script element outside a comment, as `[attributes, text]`, tag names in any case. */
const scripts = (html: string) =>
  [
    ...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
  ].map((m) => [m[1], m[2]] as const);

/** An attribute's value, double-, single- or un-quoted; undefined when it is absent. */
const attr = (attrs: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`, 'i').exec(
    attrs,
  );
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

/** A classic or module script, the only kinds CSP checks; a data block or an import map is not.
 *  The types are HTML's JavaScript MIME type essences. */
const runs = (attrs: string) => {
  const type = (attr(attrs, 'type') ?? '').trim().toLowerCase();
  return (
    type === '' ||
    type === 'module' ||
    /^(application|text)\/(x-)?(java|ecma)script$|^text\/(javascript1\.[0-5]|jscript|livescript)$/.test(
      type,
    )
  );
};

/** The CSP hash of every script that runs, has text and no `src`, in page order, its text LF as
 *  the parser hands it over. The loader's `data-src` is not `src`. */
export function inlineScriptHashes(html: string): string[] {
  return scripts(html)
    .filter(([attrs, text]) => attr(attrs, 'src') === undefined && runs(attrs) && text !== '')
    .map(([, text]) => text.replace(/\r\n?/g, '\n'))
    .map((text) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`);
}

/** One line per external script, which a hash-only `'strict-dynamic'` policy refuses, per inline
 *  script it does not admit and per hash that admits none: a stale hash fails as a rewrite does. */
export function hashMismatches(policy: string, html: string): string[] {
  const sources = parsePolicy(policy).get('script-src');
  if (!sources) throw new Error('the policy has no script-src');
  const admitted = sources.filter((s) => s.startsWith("'sha256-")).map((s) => s.slice(1, -1));
  const onPage = inlineScriptHashes(html);
  const external = scripts(html).flatMap(([attrs]) => attr(attrs, 'src') ?? []);
  return [
    ...external.map((src) => `external script the policy refuses: ${src}`),
    ...onPage.filter((h) => !admitted.includes(h)).map((h) => `inline script not admitted: '${h}'`),
    ...admitted
      .filter((h) => !onPage.includes(h))
      .map((h) => `hash admits no script on the page: '${h}'`),
  ];
}

/** Dev's basic auth from `user:pass`, trimmed, since a secret pasted from a file keeps its
 *  newline. Refuses anything else by name rather than letting dev answer an unexplained 401. */
export function authorization(pair: string | undefined): Record<string, string> {
  const value = pair?.trim();
  if (!value) return {};
  if (!value.includes(':')) throw new Error('BASIC_AUTH must be user:pass, not encoded');
  return { authorization: `Basic ${Buffer.from(value).toString('base64')}` };
}

async function main() {
  const site = process.env.SITE;
  if (!site) throw new Error('SITE is required, e.g. https://dev.quirenote.com');
  const headers = authorization(process.env.BASIC_AUTH);
  const source = readFileSync(SOURCE, 'utf8');
  let failed = false;
  for (const path of PATHS) {
    const res = await fetch(new URL(path, site), { headers, redirect: 'manual' });
    const bad: string[] = [];
    if (res.status === 200) {
      const want = expected(source, path);
      bad.push(...mismatches(want, res.headers));
      const key = CSP_KEYS.find((k) => k in want);
      const policy = key && res.headers.get(key);
      if (policy) bad.push(...hashMismatches(policy, await res.text()));
      else await res.body?.cancel();
    } else {
      await res.body?.cancel();
      bad.push(`status ${res.status}`);
    }
    failed ||= bad.length > 0;
    console.log(bad.length ? `FAIL ${path}\n  ${bad.join('\n  ')}` : `ok   ${path}`);
  }
  if (failed) process.exit(1);
}

// Both sides through realpath, since a link may stand in either; imported, `argv[1]` may be no file.
const run = process.argv[1];
if (run && existsSync(run) && realpathSync(run) === realpathSync(HERE)) await main();
