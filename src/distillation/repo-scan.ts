import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../facts/markdown-files';
import { claimTargetFiles } from '../claims/target-files';
import { isDeclaredDamage } from '../claims/repo-scan';
import {
  scanFile,
  groupRepeated,
  repeatedCountsByFile,
  historyCountsByFile,
  type SentenceHit,
  type CommentCharsResult,
  type HistoryHit,
  type RepeatedGroup,
} from './scan';

export interface DistillationScan {
  /** File → repeated-sentence-instance count, the shape `baseline.ts`'s
   *  ratchet compares. */
  repeatedSentences: Record<string, number>;
  /** File → raw comment-character count — not a percentage, see
   *  `scan.ts`'s `CommentCharsResult` for why. */
  commentChars: Record<string, number>;
  /** File → history-phrase count. */
  historyPhrases: Record<string, number>;
  /** The repeated-sentence GROUPS themselves — needed by the gate test to
   *  print which sentence, and which other file it also lives in, not just
   *  a bare per-file count. */
  repeatedGroups: RepeatedGroup[];
  /** Every history-phrase hit, same reason. */
  historyHitList: HistoryHit[];
  /** Reuses `src/claims/repo-scan.ts`'s own classification of the two
   *  declared, pre-existing damage classes — a genuinely unclosed Markdown
   *  fence, or a `.ts`/`.tsx` file `commentRanges` rejects. This module
   *  walks the SAME target files through the SAME two range-finders, so it
   *  hits the identical, already-explained set; see `distillation-lint.
   *  test.ts` for the pinned list. */
  unparseable: string[];
  errors: { file: string; message: string }[];
}

/** Scans every claim-lint target file (`claimTargetFiles` — already
 *  git-scoped and quote-safe, reused rather than a second file walk) for
 *  all three distillation checks. The one place in this mechanism that
 *  touches disk — `scan.ts`'s `scanFile` stays pure, given text. */
export function scanRepo(): DistillationScan {
  const sentenceHits: SentenceHit[] = [];
  const commentCharsList: CommentCharsResult[] = [];
  const historyHitList: HistoryHit[] = [];
  const unparseable: string[] = [];
  const errors: DistillationScan['errors'] = [];

  for (const relPath of claimTargetFiles()) {
    try {
      const text = readFileSync(join(REPO, relPath), 'utf8');
      const result = scanFile(relPath, text);
      sentenceHits.push(...result.sentences);
      if (result.commentChars) commentCharsList.push(result.commentChars);
      historyHitList.push(...result.history);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isDeclaredDamage(message)) unparseable.push(relPath);
      else errors.push({ file: relPath, message });
    }
  }

  const repeatedGroups = groupRepeated(sentenceHits);

  return {
    repeatedSentences: repeatedCountsByFile(repeatedGroups),
    // Zero-`chars` files are skipped, same as `countsFromClaims` skips a
    // file with zero counted claims — `Baseline`'s own doc comment says an
    // entry of 0 would be indistinguishable from "never scanned", and a
    // real one here would sit outside the refuse-to-write guard (which
    // tests `> 0`) and, if the file were ever deleted, leave a `0` row
    // `diffBaseline` can never flag as stale (0 there already equals 0
    // missing).
    commentChars: Object.fromEntries(
      commentCharsList.filter((d) => d.chars > 0).map((d) => [d.file, d.chars]),
    ),
    historyPhrases: historyCountsByFile(historyHitList),
    repeatedGroups,
    historyHitList,
    unparseable,
    errors,
  };
}
