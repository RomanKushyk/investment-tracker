import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../facts/markdown-files';
import { diffBaseline as diffSection, type Baseline, type BaselineDiff } from '../claims/baseline';

export const BASELINE_PATH = join(REPO, 'distillation-baseline.json');

/** One baseline file, three sections — not three baseline files. Each
 *  section is the same shape `src/claims/baseline.ts`'s `Baseline` already
 *  is (file → count), which is what lets `diffSection` below be that
 *  module's own `diffBaseline`, reused three times, rather than a
 *  reimplementation. */
export interface DistillationBaseline {
  repeatedSentences: Baseline;
  commentChars: Baseline;
  historyPhrases: Baseline;
}

const SECTION_KEYS: (keyof DistillationBaseline)[] = [
  'repeatedSentences',
  'commentChars',
  'historyPhrases',
];

function validateSection(path: string, sectionName: string, value: unknown): Baseline {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${path}: "${sectionName}" must be a JSON object, got ${JSON.stringify(value)}`,
    );
  }
  for (const [key, count] of Object.entries(value)) {
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new Error(
        `${path}: "${sectionName}.${key}" must be a non-negative integer, got ${JSON.stringify(count)}`,
      );
    }
  }
  return value as Baseline;
}

/** Parses and validates the nested shape `diffBaseline` below assumes: a
 *  JSON object carrying exactly the three known sections, each a plain
 *  object of non-negative integers — same defensive reasoning as
 *  `src/claims/baseline.ts`'s `loadBaseline`: an unvalidated bad value
 *  (a string, a float, a negative) would silently disable that entry's
 *  ratchet forever rather than fail loudly. A missing section reads as
 *  empty (`{}`) — the file has never had a claim of that kind. */
export function loadBaseline(path: string): DistillationBaseline {
  if (!existsSync(path)) {
    return { repeatedSentences: {}, commentChars: {}, historyPhrases: {} };
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object, got ${JSON.stringify(parsed)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const result = {} as DistillationBaseline;
  for (const key of SECTION_KEYS) {
    result[key] = validateSection(path, key, obj[key] ?? {});
  }
  return result;
}

function serializeSection(counts: Baseline): Baseline {
  const sorted: Baseline = {};
  for (const key of Object.keys(counts).sort()) sorted[key] = counts[key];
  return sorted;
}

/** Sorted keys within each section, sections in a fixed order (the order
 *  the design spec's own §4 lists the three checks) — matches prettier's
 *  own JSON formatting, so `pnpm format` never fights this writer, and two
 *  runs against the same scan produce byte-identical output. */
export function serializeBaseline(b: DistillationBaseline): string {
  const ordered: DistillationBaseline = {
    repeatedSentences: serializeSection(b.repeatedSentences),
    commentChars: serializeSection(b.commentChars),
    historyPhrases: serializeSection(b.historyPhrases),
  };
  return JSON.stringify(ordered, null, 2) + '\n';
}

export interface DistillationDiff {
  repeatedSentences: BaselineDiff;
  commentChars: BaselineDiff;
  historyPhrases: BaselineDiff;
}

/** Compares a live scan's three sections against the committed baseline,
 *  section by section, each via `src/claims/baseline.ts`'s own
 *  `diffBaseline` (imported as `diffSection`) — the exact same "over" /
 *  "stale" comparison the claim lint's ratchet already uses, not a second
 *  implementation of it. */
export function diffBaseline(
  baseline: DistillationBaseline,
  actual: DistillationBaseline,
): DistillationDiff {
  return {
    repeatedSentences: diffSection(baseline.repeatedSentences, actual.repeatedSentences),
    commentChars: diffSection(baseline.commentChars, actual.commentChars),
    historyPhrases: diffSection(baseline.historyPhrases, actual.historyPhrases),
  };
}
