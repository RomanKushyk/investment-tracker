import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../facts/markdown-files';
import { parseDecisionFileAt, type DecisionFrontMatter } from './frontMatter';

// `REPO` is src/facts/markdown-files.ts's own repo-root resolution — reused
// rather than re-derived, so the `'..', '..'` depth assumption has exactly
// one copy, not two that can silently drift apart.
export const DECISIONS_DIR = join(REPO, 'docs', 'decisions');

export interface DecisionRecord extends DecisionFrontMatter {
  /** Numeric id, e.g. 67 for D67 — the sort and range key. */
  num: number;
}

const FILE_RE = /^D(\d+)\.md$/;

/** Reads and parses the front matter of every `docs/decisions/D*.md`,
 *  sorted ascending by id. Throws if a filename and its own `id` field
 *  disagree — that mismatch would silently misfile a decision under the
 *  wrong link. */
export function readDecisions(dir: string = DECISIONS_DIR): DecisionRecord[] {
  const files = readdirSync(dir).filter((f) => FILE_RE.test(f));
  const records = files.map((file): DecisionRecord => {
    const num = Number(FILE_RE.exec(file)![1]);
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const frontMatter = parseDecisionFileAt(path, text);
    if (frontMatter.id !== `D${num}`) {
      throw new Error(`${path}: front matter id "${frontMatter.id}" does not match the filename`);
    }
    return { ...frontMatter, num };
  });
  return records.sort((a, b) => a.num - b.num);
}

export interface DecisionProblem {
  id: string;
  problem: string;
}

/** Everything a generated index could get wrong that a type checker can't
 *  catch: an `amends` target that names no file, and a decision that
 *  amends itself. */
export function validateDecisions(records: DecisionRecord[]): DecisionProblem[] {
  const ids = new Set(records.map((r) => r.id));
  const problems: DecisionProblem[] = [];
  for (const r of records) {
    for (const target of r.amends) {
      if (target === r.id) {
        problems.push({ id: r.id, problem: `amends itself (${target})` });
      } else if (!ids.has(target)) {
        problems.push({ id: r.id, problem: `amends ${target}, which has no file` });
      }
    }
  }
  return problems;
}
