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

async function main() {
  const site = process.env.SITE;
  if (!site) throw new Error('SITE is required, e.g. https://dev.quirenote.com');
  // `user:pass`, for dev's basic auth; never printed.
  const auth = process.env.BASIC_AUTH;
  const headers: Record<string, string> = auth
    ? { authorization: `Basic ${Buffer.from(auth).toString('base64')}` }
    : {};
  const source = readFileSync(SOURCE, 'utf8');
  let failed = false;
  for (const path of PATHS) {
    const res = await fetch(new URL(path, site), { headers, redirect: 'manual' });
    await res.body?.cancel();
    const bad = res.status === 200 ? mismatches(expected(source, path), res.headers) : [];
    if (res.status !== 200) bad.push(`status ${res.status}`);
    failed ||= bad.length > 0;
    console.log(bad.length ? `FAIL ${path}\n  ${bad.join('\n  ')}` : `ok   ${path}`);
  }
  if (failed) process.exit(1);
}

// Both sides through realpath, since a link may stand in either; imported, `argv[1]` may be no file.
const run = process.argv[1];
if (run && existsSync(run) && realpathSync(run) === realpathSync(HERE)) await main();
