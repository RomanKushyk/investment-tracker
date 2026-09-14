import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from './repo-root';

// THE API REFERENCE IS A SECOND BUILD SO THAT "NOT IN PRODUCTION" IS STRUCTURAL.
//
// Every write-up of hosted Swagger UI names the same failure: a flag meant to disable it
// turns out to be dead code and the page ships anyway. There is no flag — `pnpm build` is
// the app, `pnpm build:api-docs` is the page, and a workflow step's `if:` decides. What
// follows holds the ways that could quietly stop being true. The workflow carries the one
// assertion this file cannot make, against the built artifact itself.

const WORKFLOW = '.github/workflows/deploy-frontend.yml';
const SCRIPT = 'build:api-docs';
const SPEC = 'docs/reference/openapi.json';

const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

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
  // ANCHORS. The assertions below are about absence and singularity, and an absence
  // assertion cannot tell 'nothing is there' from 'I am not looking at the right tree'.
  it('is reading the real frontend workflow and the real app config', () => {
    expect(existsSync(join(REPO, WORKFLOW))).toBe(true);
    expect(steps().some((s) => s.run?.trim() === 'pnpm build')).toBe(true);
    expect(read('vite.config.ts')).toContain('defineConfig');
    expect(existsSync(join(REPO, SPEC))).toBe(true);
  });

  it('the app config names no rollup INPUT, so `pnpm build` cannot emit the page', () => {
    // Read as source rather than imported: importing pulls in babel and a native
    // Tailwind binding, seconds of load for a question the text answers.
    //
    // `rollupOptions.input` specifically, NOT `rollupOptions`. Vite's own build output
    // recommends `rollupOptions.output.manualChunks` for the app's 1.5 MB entry chunk, so
    // a broad match would redden this gate for someone taking that advice — and redden it
    // with a message claiming production leaks the API reference, which it would not.
    expect(read('vite.config.ts')).not.toMatch(/rollupOptions[\s\S]*?\binput\b/);
  });

  it('the second build has its own config, appends, and owns no app output', () => {
    const config = read('vite.config.api-docs.ts');
    expect(config).toContain('api-docs.html');
    // Without this it wipes the app build that ran before it.
    expect(config).toMatch(/emptyOutDir:\s*false/);
    // public/ belongs to the app build; the second must not copy over it.
    expect(config).toMatch(/copyPublicDir:\s*false/);
    // AND IT MUST EMIT INTO dist/. Redirect it elsewhere and the workflow's production
    // check — `test ! -f dist/api-docs.html` — starts passing for the wrong reason while
    // dev still ships a page. `\boutDir\b` does not match `emptyOutDir`.
    expect(config).not.toMatch(/\boutDir\b/);
  });

  it('the page is one module graph, and it shares nothing with the app', () => {
    // THE ISOLATION IS THE WHOLE DESIGN, and one import would end it silently. The app's
    // globals — `__APP_VERSION__` among them — are declared for everything under src/ and
    // defined only by the app's config, so an app module pulled in here type-checks,
    // builds without complaint and throws ReferenceError on the deployed page. Nothing
    // else catches it: `pnpm build:api-docs` runs no typecheck, and typecheck cannot see
    // a missing `define`.
    //
    // BOTH ENDS, because the page is the HTML plus what it loads: one script tag, that
    // one, and the module behind it reaching nothing but the spec. Counted over every
    // `<script`, so an INLINE module importing an app path cannot slip past a check that
    // only reads `src=` attributes.
    const html = read('api-docs.html');
    const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toEqual(['/src/api-docs/main.ts']);
    expect(html.match(/<script\b/g)).toHaveLength(1);

    const entry = read('src/api-docs/main.ts');
    const local = [...entry.matchAll(/(?:^import|\bfrom)[^'"]*['"](\.[^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(local).toEqual(['../../docs/reference/openapi.json']);
    // A bare specifier could still resolve into src/ through an alias — and it would have
    // to be THIS config's, since `vite build --config` replaces the app's rather than
    // merging with it. An alias in vite.config.ts cannot reach this graph, so reading that
    // file here would guard nothing and redden on a change that is none of this page's
    // business.
    expect(read('vite.config.api-docs.ts')).not.toMatch(/\balias\b/);
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
    // Counted over PARSED steps and env, not raw text: a mention inside a comment cannot
    // run a build, and counting characters would fail this gate for describing it.
    const mentions = steps().flatMap((s) => [s.run ?? '', ...Object.values(s.env ?? {})]);
    expect(mentions.filter((v) => v.includes(SCRIPT))).toHaveLength(1);
    expect(Object.values(job().env ?? {}).filter((v) => v.includes(SCRIPT))).toHaveLength(0);
  });

  it('production asserts the page is absent from what it zips', () => {
    // The recipe assertions above prove the step is guarded; this proves the ARTIFACT is,
    // which is the only thing the zip step actually reads.
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

    // The page is compiled FROM the spec, so a regeneration has to reach this build.
    // `docs/**` being absent is the whole of that — no negation, no ordering rule.
    expect(ignored).not.toContain('docs/**');
    // Anchors: the filter is still doing its other work, and is still a paths-ignore.
    expect(push.paths).toBeUndefined();
    expect(ignored).toEqual(expect.arrayContaining(['**/*.md', 'infra/**']));
  });

  it('docs/ holds no non-Markdown file but the spec — the reason docs/** can be dropped', () => {
    // THE SENTENCE IN THE WORKFLOW DEPENDS ON THIS, and nothing else would notice it
    // changing. Drop `docs/**` and every non-Markdown file added under docs/ starts
    // triggering frontend deploys. That is the safe direction — an extra no-op run, never
    // a stale page — but it stops being free the moment docs/ carries something large,
    // and this is where that would be found.
    const tracked = execFileSync('git', ['ls-files', 'docs'], { cwd: REPO, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(1);
    expect(tracked.filter((f) => !f.endsWith('.md'))).toEqual([SPEC]);
  });
});
