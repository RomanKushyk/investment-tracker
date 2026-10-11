import { ESLint } from 'eslint';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO } from './repo-root';

// A QUERY IS HELD BY LINT, NOT BY CONVENTION. `select` re-runs only when the data or the function
// changes (query-core's `queryObserver`), so a selector made inside a render re-runs on every one.
// A selector in `eslint.config.js` that stops matching still parses, so these assertions lint TEXT
// at a source path through the ESLint JS API, the instrument `domain-purity.test.ts` uses.
const eslint = new ESLint({ cwd: REPO });

const SCREEN = 'src/screens/Probe.tsx';

async function messages(code: string, file = SCREEN) {
  const [result] = await eslint.lintText(code, { filePath: join(REPO, file) });
  return result.messages;
}
const inline = async (code: string, file?: string) =>
  (await messages(code, file))
    .filter((m) => m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);

describe('a selector is made at module level', () => {
  // Resolving the real flat config is the whole cost (typescript-eslint, two react plugins, the
  // query plugin) and it lands in whichever case runs first.
  beforeAll(async () => {
    await messages('export {};\n');
  }, 20_000);

  it.each([
    ['an arrow', 'export function A() { return useView((b) => b.view.capital); }'],
    [
      'a function expression',
      'export function A() { return useView(function (b) { return b.view.capital; }); }',
    ],
    ['a call that makes one', 'export function A({ p }) { return useView(pick(p)); }'],
    [
      'an option of a query',
      'export function A() { return useQuery({ queryKey: ["x"], queryFn, select: (d) => d }); }',
    ],
  ])('refuses %s', async (_, code) => {
    expect((await inline(code)).join(' ')).toContain('module level');
  });

  it.each([
    ['an identifier', 'export function A() { return useView(selectCapital); }'],
    ['a read of a table of them', 'export function A({ p }) { return useView(overviewOf[p]); }'],
  ])('lets %s through', async (_, code) => {
    expect(await inline(code)).toEqual([]);
  });

  it('holds a .ts hook as it holds a .tsx screen', async () => {
    expect(
      (await inline('export const a = () => useView((b) => b);', 'src/hooks/probe.ts')).length,
    ).toBe(1);
  });

  // THE CONTROL. A rule written for every file would pass the cases above while a test, which
  // builds its own selectors, was held to it too.
  it('leaves a test alone', async () => {
    expect(
      await inline('export const a = () => useView((b) => b);', 'src/hooks/probe.test.tsx'),
    ).toEqual([]);
  });

  // The block restates the PGlite rule it replaces for these paths.
  it('still refuses what the rule it replaces refused', async () => {
    expect((await inline("export const a = require('@electric-sql/pglite');")).join(' ')).toContain(
      'only infra/src/__fixtures__/pglite.ts',
    );
  });
});

describe("the query plugin's recommended rules are on", () => {
  it('refuses a client made in a render', async () => {
    const code = `import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
export function App() {
  const client = new QueryClient();
  return <QueryClientProvider client={client} />;
}
`;
    expect((await messages(code)).map((m) => m.ruleId)).toContain(
      '@tanstack/query/stable-query-client',
    );
  });

  it('refuses a key that leaves out what the read depends on', async () => {
    const code = `import { useQuery } from '@tanstack/react-query';
export function A({ id }: { id: string }) {
  return useQuery({ queryKey: ['a'], queryFn: () => fetch(id) });
}
`;
    expect((await messages(code)).map((m) => m.ruleId)).toContain(
      '@tanstack/query/exhaustive-deps',
    );
  });
});
