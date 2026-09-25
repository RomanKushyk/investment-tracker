import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from './repo-root';

// THE API REFERENCE IS A SECOND BUILD SO THAT "NOT IN PRODUCTION" IS STRUCTURAL RATHER THAN
// FLAG-GATED. Every write-up of hosted Swagger UI names the same failure: a flag meant to
// disable it turns out to be dead code and the page ships anyway. There is no flag —
// `pnpm build` is the app, `pnpm build:api-docs` is the page, and a workflow step's `if:`
// decides. The workflow carries the one assertion this file cannot make, against the
// artifact itself.

const WORKFLOW = '.github/workflows/deploy-frontend.yml';
const SCRIPT = 'build:api-docs';
const SPEC = 'docs/reference/openapi.json';

const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

/** The two configs and the entry are read through this, because an absence assertion over raw
 *  text fails on a comment that merely names what the file must not do.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
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

type Step = { name?: string; run?: string; if?: string; env?: Record<string, string> };
type Workflow = {
  on?: { push?: { paths?: string[]; 'paths-ignore'?: string[] } };
  jobs: Record<string, { env?: Record<string, string>; steps?: Step[] }>;
};

const workflow = () => parseDocument(read(WORKFLOW)).toJS() as Workflow;
const job = () => workflow().jobs.deploy ?? {};
const steps = () => job().steps ?? [];

/** `if: x` and `if: ${{ x }}` are one condition to GitHub; compare the condition. */
const condition = (s: Step) =>
  (s.if ?? '')
    .replace(/^\s*\$\{\{\s*/, '')
    .replace(/\s*\}\}\s*$/, '')
    .trim();

describe('the API reference is a second build, and production never runs it', () => {
  // ANCHORS: the assertions below are about absence and singularity, and an absence assertion
  // cannot tell "nothing is there" from "I am not looking at the right tree".
  it('is reading the real frontend workflow and the real app config', () => {
    expect(existsSync(join(REPO, WORKFLOW))).toBe(true);
    expect(steps().some((s) => s.run?.trim() === 'pnpm build')).toBe(true);
    expect(stripTs(read('vite.config.ts'), 'vite.config.ts')).toContain('defineConfig');
    expect(existsSync(join(REPO, SPEC))).toBe(true);
  });

  it('the app config names no rollup INPUT, so `pnpm build` cannot emit the page', () => {
    // Read as source rather than imported: importing pulls in babel and a native Tailwind
    // binding, seconds of load for a question the text answers.
    //
    // `rollupOptions` FOLLOWED BY AN `input`, which is NARROWER than `rollupOptions` alone —
    // Vite's own build output recommends `rollupOptions.output.manualChunks` for the app's
    // entry chunk, and a bare `rollupOptions` ban would redden this gate for someone taking
    // that advice. It is not scoped to the object, though: an `input` anywhere after it, in a
    // plugin option or a string, reddens this too. A comment does not; it is stripped first.
    expect(
      stripTs(read('vite.config.ts'), 'vite.config.ts'),
      'the app config names a rollup input after `rollupOptions`, which would let `pnpm ' +
        'build` emit the page — check it is a real input and not a later unrelated word',
    ).not.toMatch(/rollupOptions[\s\S]*?\binput\b/);
  });

  it('the second build has its own config, appends, and owns no app output', () => {
    const config = stripTs(read('vite.config.api-docs.ts'), 'vite.config.api-docs.ts');
    expect(config).toContain('api-docs.html');
    expect(config, 'the second build wipes the app build that ran before it').toMatch(
      /emptyOutDir:\s*false/,
    );
    expect(config, 'public/ belongs to the app build and the second copies over it').toMatch(
      /copyPublicDir:\s*false/,
    );
    // `\boutDir\b` does not match `emptyOutDir`.
    expect(
      config,
      'the page is redirected out of dist/, so production\u2019s `test ! -f ' +
        'dist/api-docs.html` starts passing for the wrong reason while dev still ships one',
    ).not.toMatch(/\boutDir\b/);
  });

  it('the page is one module graph, and it shares nothing with the app', () => {
    // THE ISOLATION IS THE WHOLE DESIGN, AND ONE IMPORT WOULD END IT SILENTLY: the app's
    // globals are declared for everything under src/ and defined only by the app's config, so
    // an app module pulled in here TYPE-CHECKS, BUILDS, AND THROWS ReferenceError ON THE
    // DEPLOYED PAGE. Nothing else catches it — `pnpm build:api-docs` runs no typecheck, and
    // typecheck cannot see a missing `define`.
    //
    // BOTH ENDS, because the page is the HTML plus what it loads. Counted over every
    // `<script`, so an INLINE module importing an app path cannot slip past a check that only
    // reads `src=` attributes.
    const html = read('api-docs.html');
    const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(['/src/api-docs/main.ts']);
    expect(html.match(/<script\b/g)).toHaveLength(1);

    const entry = stripTs(read('src/api-docs/main.ts'), 'src/api-docs/main.ts');
    const local = [...entry.matchAll(/(?:^import|\bfrom)[^'"]*['"](\.[^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(local).toEqual(['../../docs/reference/openapi.json']);
    // A bare specifier could still resolve into src/ through an alias, and it would have to be
    // THIS config's: `vite build --config` REPLACES the app's rather than merging with it, so
    // an alias in `vite.config.ts` cannot reach this graph.
    expect(stripTs(read('vite.config.api-docs.ts'), 'vite.config.api-docs.ts')).not.toMatch(
      /\balias\b/,
    );
  });

  it('package.json exposes the script the workflow runs', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    expect(Object.keys(pkg.scripts ?? {})).toContain(SCRIPT);
  });

  it('exactly one step runs it, and not on `main`', () => {
    const running = steps().filter((s) => s.run?.includes(SCRIPT));
    expect(running).toHaveLength(1);
    expect(condition(running[0])).toBe("github.ref_name != 'main'");
  });

  it('nothing else in the job can run it', () => {
    // Counted over PARSED steps and env, never raw text: a mention inside a comment cannot
    // run a build, and counting characters would fail this gate for describing it.
    const mentions = steps().flatMap((s) => [s.run ?? '', ...Object.values(s.env ?? {})]);
    expect(mentions.filter((v) => v.includes(SCRIPT))).toHaveLength(1);
    expect(Object.values(job().env ?? {}).filter((v) => v.includes(SCRIPT))).toHaveLength(0);
  });

  it('production asserts the page is absent from what it zips', () => {
    // The recipe assertions above prove the STEP is guarded; this proves the ARTIFACT is,
    // which is the only thing the zip step reads.
    const check = steps().find((s) => s.run?.includes('dist/api-docs.html'));
    expect(check).toBeDefined();
    expect(condition(check as Step)).toBe("github.ref_name == 'main'");
    expect(check?.run).toMatch(/test\s+!\s+-f\s+dist\/api-docs\.html/);
  });

  it('builds the app, then the page, then checks, then zips', () => {
    const all = steps();
    const at = (p: (s: Step) => boolean) => all.findIndex(p);
    const app = at((s) => s.run?.trim() === 'pnpm build');
    const docs = at((s) => !!s.run?.includes(SCRIPT));
    const check = at((s) => !!s.run?.includes('dist/api-docs.html'));
    const zip = at((s) => !!s.run?.includes('dist.zip'));

    expect(zip).toBeGreaterThanOrEqual(0);
    expect(app).toBeLessThan(docs);
    expect(docs).toBeLessThan(check);
    expect(check).toBeLessThan(zip);
  });

  it('redeploys when the spec is regenerated', () => {
    const push = workflow().on?.push ?? {};
    const ignored = push['paths-ignore'] ?? [];

    expect(
      ignored,
      '`docs/**` is back in `paths-ignore`, so regenerating the spec no longer reaches this ' +
        'build — its absence is the whole of that, no negation and no ordering rule',
    ).not.toContain('docs/**');
    // Anchors: the filter is still doing its other work, and is still a paths-ignore.
    expect(push.paths).toBeUndefined();
    expect(ignored).toEqual(expect.arrayContaining(['**/*.md', 'infra/**']));
  });

  it('docs/ holds no non-Markdown file but the spec — the reason docs/** can be dropped', () => {
    // THE WORKFLOW'S DROPPED `docs/**` FILTER IS WHAT THIS EXISTS TO HOLD, and nothing else
    // would notice it changing: every non-Markdown file added under docs/ starts triggering
    // frontend deploys. That is the safe direction — an extra no-op run, never a stale page —
    // but it stops being free the moment docs/ carries something large.
    const tracked = execFileSync('git', ['ls-files', 'docs'], { cwd: REPO, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(1);
    expect(tracked.filter((f) => !f.endsWith('.md'))).toEqual([SPEC]);
  });
});
