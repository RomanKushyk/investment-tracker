import ts from 'typescript';
import type { CodeRange } from '../facts/fences';

/** Thrown by `commentRanges` when TypeScript's own parser rejects `text` as
 *  `.ts`/`.tsx` — `repo-scan.ts` catches this by message and routes the
 *  file into `RepoScan.unparseable`, the same declared-damage path
 *  `codeRanges`'s unclosed-fence error uses for Markdown, rather than
 *  silently returning zero comments for a file that has some. */
export const PARSE_ERROR_PREFIX = 'cannot parse as TypeScript:';

/**
 * Every `[start, end)` range in `text` that is a TypeScript/TSX COMMENT — a
 * `//` line comment or a slash-star/star-slash block comment, JSDoc
 * included. Built on TypeScript's own scanner (`typescript`, already a
 * dependency) via a full parse (`ts.createSourceFile`), not a hand-rolled
 * state machine — a string, a template literal and a regex literal are
 * exactly as ambiguous to write a scanner for by hand as `src/facts/
 * fences.ts`'s own README warns Markdown fencing is, and this module
 * shipped with precisely that defect once: differentially against this
 * function, the hand-rolled predecessor missed dozens of comments in
 * `src/core/backup/csv.ts` alone (a `/[",\r\n]/` regex literal
 * desynchronised its quote-tracking) and, in the other direction, read
 * `.replace(/\/\*[\s\S]*?\*\//g, '')` as opening a real block comment.
 * TypeScript's parser resolves the regex-vs-division ambiguity as part of
 * real parsing, which no scanner running in isolation can do correctly —
 * this function inherits that instead of re-deriving it.
 *
 * `fileName`'s extension picks `.ts` vs `.tsx` parsing (`<Foo>` casts are
 * legal in the former, ambiguous with JSX in the latter) — always pass the
 * real relative path, not a placeholder.
 *
 * TWO PASSES, deliberately not one: `ts.transpileModule` first, purely for
 * its (public, typed) `diagnostics` — a file this repo's own `tsc --noEmit`
 * would reject is not something this function can safely report comments
 * for, since a parser that gave up partway through cannot be trusted to
 * have found every comment either. Only once that comes back clean does
 * `ts.createSourceFile` run the walk. `SourceFile.parseDiagnostics` (a
 * single-parse alternative) is NOT used — it is `@internal` to the
 * `typescript` package and absent from its shipped `.d.ts`, so reading it
 * needs an `any` escape hatch this avoids entirely.
 *
 * THE WALK ITSELF is every node's `getChildren(sourceFile)` (not
 * `forEachChild`), recursively, collecting `getLeadingCommentRanges` at
 * each child's full start AND `getTrailingCommentRanges` at its end, plus
 * the end-of-file token's own leading range for a comment with nothing
 * lexical after it anywhere in the file. `getChildren` — which needs
 * `setParentNodes: true` on the parse — visits punctuation tokens
 * (`}`, `]`, `)`) that `forEachChild` skips entirely; a comment reachable from
 * no node's leading trivia and no node's trailing trivia, because the only
 * thing adjacent to it is a closing brace, is invisible to `forEachChild`
 * and was the walk's own defect the first time this shipped. The two
 * comment-range calls are both necessary regardless of which walk finds
 * the tokens — TypeScript classifies a comment sharing its PREVIOUS
 * token's line (`const x = 1; // hi`) as that token's TRAILING trivia,
 * invisible to `getLeadingCommentRanges` at the next token's full start; a
 * comment on its own line is the mirror image. A token's full start/end is
 * shared with its neighbours at every depth, so the same comment is
 * offered up repeatedly from nested calls; deduped by its own start
 * offset, which is what makes the walk correct without needing to reason
 * about which node "owns" a comment.
 */
export function commentRanges(text: string, fileName: string): CodeRange[] {
  const { diagnostics } = ts.transpileModule(text, { fileName, reportDiagnostics: true });
  if (diagnostics && diagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ');
    throw new Error(`${PARSE_ERROR_PREFIX} ${message}`);
  }

  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const ranges: CodeRange[] = [];
  const seen = new Set<number>();

  const collect = (found: readonly ts.CommentRange[] | undefined) => {
    for (const r of found ?? []) {
      if (!seen.has(r.pos)) {
        seen.add(r.pos);
        ranges.push({ start: r.pos, end: r.end });
      }
    }
  };

  const visit = (node: ts.Node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };

  visit(sourceFile);
  collect(ts.getLeadingCommentRanges(text, sourceFile.endOfFileToken.getFullStart()));

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}
