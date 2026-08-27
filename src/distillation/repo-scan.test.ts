import { describe, expect, it } from 'vitest';
import { scanRepo } from './repo-scan';

// Integration-level invariants over the REAL repository — `distillation-
// lint.test.ts` is the ratchet check against the committed baseline; this
// file instead pins properties `scanRepo`'s own aggregation must hold no
// matter what the tree currently contains, the same division of labour
// `src/claims/repo-scan.test.ts` draws for its own module.

describe('scanRepo — aggregation invariants', () => {
  const scan = scanRepo();

  it('finds real files of every kind — a silent empty scan would pass every assertion below vacuously', () => {
    expect(Object.keys(scan.commentChars).length).toBeGreaterThan(0);
    expect(scan.repeatedGroups.length).toBeGreaterThan(0);
  });

  it('every comment-volume entry is a .ts/.tsx file, never .md/.sql', () => {
    for (const file of Object.keys(scan.commentChars)) {
      expect(file).toMatch(/\.tsx?$/);
    }
  });

  it('every comment-volume count is a non-negative whole number — never a percentage, never negative', () => {
    for (const chars of Object.values(scan.commentChars)) {
      expect(Number.isInteger(chars)).toBe(true);
      expect(chars).toBeGreaterThanOrEqual(0);
    }
  });

  it('no repeated-sentence or history-phrase entry exists for a file under docs/decisions/ or docs/archive/', () => {
    const exempt = (f: string) => f.startsWith('docs/decisions/') || f.startsWith('docs/archive/');
    expect(Object.keys(scan.repeatedSentences).some(exempt)).toBe(false);
    expect(Object.keys(scan.historyPhrases).some(exempt)).toBe(false);
  });

  it('every repeated-sentence group spans 2 or more distinct files', () => {
    for (const group of scan.repeatedGroups) {
      expect(group.files.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('the repeated-sentence and history-phrase per-file counts agree with the raw hit/group lists they were built from', () => {
    // Comment volume has no equivalent "raw list" to sum against — one
    // count per file, not a set of individual hits — so it is not part of
    // this check; see the dedicated shape assertions above instead.
    const groupTotal = scan.repeatedGroups.reduce((sum, g) => sum + g.hits.length, 0);
    const countedTotal = Object.values(scan.repeatedSentences).reduce((a, c) => a + c, 0);
    expect(countedTotal).toBe(groupTotal);

    const historyTotal = Object.values(scan.historyPhrases).reduce((a, c) => a + c, 0);
    expect(historyTotal).toBe(scan.historyHitList.length);
  });

  it('reports no unexpected scan error against the real tree', () => {
    expect(scan.errors).toEqual([]);
  });
});
