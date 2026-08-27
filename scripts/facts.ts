import { readFileSync, writeFileSync } from 'node:fs';
import { FACTS } from '../src/facts/facts';
import { rewriteFile } from '../src/facts/fences';
import { markdownFiles, REPO } from '../src/facts/markdown-files';

// Validate every file before writing any. rewriteFile throws on the first
// bad file (an orphan closer, a malformed tag, an unknown key...), and
// nothing below has run yet at that point — so a single damaged file aborts
// with the repo untouched, never with an arbitrary prefix of it rewritten
// and the rest not.
const results = markdownFiles(REPO).map((path) => {
  const before = readFileSync(path, 'utf8');
  return { path, before, after: rewriteFile(path, before, FACTS) };
});

let changed = 0;
for (const { path, before, after } of results) {
  if (after === before) continue;
  writeFileSync(path, after);
  console.log(`updated ${path}`);
  changed += 1;
}
console.log(changed === 0 ? 'every fence was already current' : `${changed} file(s) updated`);
