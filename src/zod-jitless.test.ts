import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { REPO } from './repo-root';

describe('zod never probes `new Function` in the browser', () => {
  it('the config module sets jitless', async () => {
    await import('./zod-jitless');
    expect(z.config().jitless).toBe(true);
  });

  it('is the first import of the entry, before any schema module can be evaluated', () => {
    // Parsed, not matched: an import's order is what the module graph evaluates.
    const main = ts.createSourceFile(
      'main.tsx',
      readFileSync(join(REPO, 'src/main.tsx'), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const first = main.statements[0];
    if (!ts.isImportDeclaration(first)) throw new Error('main.tsx does not start with an import');
    expect((first.moduleSpecifier as ts.StringLiteral).text).toBe('./zod-jitless');
  });
});
