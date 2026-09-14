// Writes the committed OpenAPI document. `pnpm openapi`.
//
// The document is an artifact: `infra/src/openapi.test.ts` regenerates it and fails when the
// committed copy disagrees, so a hand edit is caught rather than silently discarded here.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildSpec } from '../src/openapi';

const OUT = fileURLToPath(new URL('../../docs/reference/openapi.json', import.meta.url));

// LF, ALWAYS. Development is Windows with `core.autocrlf=true` and CI is Linux; the test
// strips `\r` on the committed side for the same reason, and writing LF here is the half
// that keeps a regeneration on Windows from showing up as a whole-file diff.
writeFileSync(OUT, `${JSON.stringify(buildSpec(), null, 2)}\n`, 'utf8');
console.log(`wrote ${OUT}`);
