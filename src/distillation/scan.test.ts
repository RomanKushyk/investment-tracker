import { describe, expect, it } from 'vitest';
import type { CodeRange } from '../facts/fences';
import {
  sentenceHits,
  groupRepeated,
  repeatedCountsByFile,
  commentChars,
  historyHits,
  historyHitsInProse,
  wrapOnlyHistoryHits,
  historyCountsByFile,
  scanFile,
} from './scan';

// A sentence long enough to clear both thresholds (≥8 words, ≥50 normalised
// characters) — reused across tests so each one only has to vary what it is
// actually testing.
const LONG_SENTENCE = 'The brief keeps its title and every one of its owner decisions in place.';

describe('sentenceHits', () => {
  it('finds a sentence at or above both thresholds', () => {
    const hits = sentenceHits('a.md', `${LONG_SENTENCE} Short one.`);
    expect(hits).toHaveLength(1);
    expect(hits[0].excerpt).toBe(LONG_SENTENCE);
  });

  it('does not flag a sentence under the word threshold', () => {
    expect(sentenceHits('a.md', 'Too short to count as a repeated sentence.')).toEqual([]);
  });

  it('does not flag a sentence under the character threshold even with enough words', () => {
    // 8 one-letter words: well over the word count, nowhere near 50 chars.
    expect(sentenceHits('a.md', 'a a a a a a a a.')).toEqual([]);
  });

  it('joins a soft-wrapped paragraph before splitting sentences — a real repo shape', () => {
    const wrapped = [
      'The brief keeps its title and every one of',
      'its owner decisions in place.',
    ].join('\n');
    const hits = sentenceHits('a.md', wrapped);
    expect(hits.map((h) => h.excerpt)).toEqual([LONG_SENTENCE]);
  });

  it('attributes every sentence in a paragraph to the paragraph start line', () => {
    const text = [
      'intro',
      '',
      `${LONG_SENTENCE} And a second one that is also fairly long here.`,
    ].join('\n');
    const hits = sentenceHits('a.md', text);
    expect(hits.every((h) => h.line === 3)).toBe(true);
  });

  it('normalises case and Markdown emphasis so two differently-styled copies share a key', () => {
    const plain = sentenceHits('a.md', LONG_SENTENCE)[0];
    const decorated = sentenceHits('b.md', `**${LONG_SENTENCE.toUpperCase()}**`)[0];
    expect(plain.key).toBe(decorated.key);
  });

  it('resets paragraphs across multiple blank-line-separated blocks', () => {
    const text = [
      LONG_SENTENCE,
      '',
      'Another long enough sentence sits down here on its own line.',
    ].join('\n\n');
    const hits = sentenceHits('a.md', text);
    expect(hits).toHaveLength(2);
    expect(hits[1].line).toBeGreaterThan(hits[0].line);
  });

  it('splits two Cyrillic sentences instead of fusing them into one unsplittable key (Ukrainian is the default language, D54)', () => {
    const uk = [
      'Це перше речення для перевірки розбиття тексту на реченння в цьому файлі.',
      'Це друге речення, яке також є досить довгим для перевірки того самого правила.',
    ].join(' ');
    const hits = sentenceHits('a.md', uk);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts a typographic opening quote (« or „) as a valid sentence start, not just ASCII', () => {
    const text = `${LONG_SENTENCE} «Наступне речення» також досить довге, щоб пройти поріг тут.`;
    const hits = sentenceHits('a.md', text);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('groupRepeated', () => {
  it('groups identical-key hits from 2+ DISTINCT files', () => {
    const hits = [...sentenceHits('a.md', LONG_SENTENCE), ...sentenceHits('b.md', LONG_SENTENCE)];
    const groups = groupRepeated(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toEqual(new Set(['a.md', 'b.md']));
  });

  it('does NOT group a sentence repeated only within a single file', () => {
    const hits = [...sentenceHits('a.md', LONG_SENTENCE), ...sentenceHits('a.md', LONG_SENTENCE)];
    expect(groupRepeated(hits)).toEqual([]);
  });

  it('does not group two different long sentences together', () => {
    const other = 'A completely different long sentence occupies this second file entirely.';
    const hits = [...sentenceHits('a.md', LONG_SENTENCE), ...sentenceHits('b.md', other)];
    expect(groupRepeated(hits)).toEqual([]);
  });
});

describe('repeatedCountsByFile', () => {
  it('counts every instance, per file, across all qualifying groups', () => {
    const hits = [
      ...sentenceHits('a.md', LONG_SENTENCE),
      ...sentenceHits('b.md', LONG_SENTENCE),
      ...sentenceHits('b.md', LONG_SENTENCE), // b.md carries it twice
    ];
    const counts = repeatedCountsByFile(groupRepeated(hits));
    expect(counts).toEqual({ 'a.md': 1, 'b.md': 2 });
  });

  it('omits a file that has no repeated-sentence hits at all', () => {
    const hits = [...sentenceHits('a.md', LONG_SENTENCE), ...sentenceHits('b.md', LONG_SENTENCE)];
    expect(repeatedCountsByFile(groupRepeated(hits))).not.toHaveProperty('c.md');
  });
});

describe('commentChars', () => {
  it('sums the length of every given range', () => {
    const ranges: CodeRange[] = [
      { start: 0, end: 5 },
      { start: 10, end: 13 },
    ];
    expect(commentChars('x.ts', ranges).chars).toBe(8);
  });

  it('is 0 for no ranges at all', () => {
    expect(commentChars('x.ts', []).chars).toBe(0);
  });

  it('does NOT need the file text at all — the count is the ranges alone, never a ratio against file length', () => {
    // No `text` parameter exists on this function's signature any more —
    // this is a property test of that design choice, not an accident: a
    // ratio needs a denominator, an absolute count never does.
    expect(commentChars('x.ts', [{ start: 0, end: 100 }]).chars).toBe(100);
  });
});

describe('historyHits', () => {
  it('flags the design spec’s own two named examples', () => {
    expect(historyHits('a.md', 'This was the first draft.').map((h) => h.match)).toEqual([
      'the first draft',
    ]);
    expect(historyHits('a.md', 'A follow-up review found the bug.').map((h) => h.match)).toEqual([
      'review found',
    ]);
  });

  it('matches this repository’s own recurring narration idioms', () => {
    expect(
      historyHits('a.ts', 'fix round 2 — a case that used to fail').map((h) => h.match),
    ).toEqual(['fix round 2']);
  });

  it('does NOT flag CRITICAL:/PIN: — a forward-looking test-severity convention, not narration', () => {
    expect(historyHits('a.ts', "CRITICAL: reproduces the review's finding")).toEqual([]);
    expect(historyHits('a.ts', 'PIN: this must never silently pass again')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(historyHits('a.md', 'THE FIRST DRAFT said otherwise')).toHaveLength(1);
  });

  it('reports the correct 1-based line number', () => {
    const hits = historyHits('a.md', ['line one', 'the first draft', 'line three'].join('\n'));
    expect(hits).toEqual([{ file: 'a.md', line: 2, match: 'the first draft' }]);
  });

  it('finds two different phrases on the same line as two separate hits', () => {
    const hits = historyHits('a.md', 'the first draft, and review found nothing else wrong');
    expect(hits.map((h) => h.match).sort()).toEqual(['review found', 'the first draft']);
  });

  it('does not flag ordinary prose with none of the phrases', () => {
    expect(historyHits('a.md', 'Nothing historical is said here at all.')).toEqual([]);
  });

  it('does NOT double-count "verified before this fix" — it entirely CONTAINS "before this fix"', () => {
    // Before the fix, /verified before this fix/ and /before this fix/ both
    // matched the identical text, so this line counted twice, and deleting
    // ONE occurrence of the phrase from a file only ever dropped its count
    // by 2 — never to a number that let the ratchet notice a single
    // deletion.
    expect(historyHits('a.md', 'It was verified before this fix landed.')).toHaveLength(1);
  });
});

describe('historyHitsInProse', () => {
  it('catches a phrase split across a soft wrap — invisible to line-by-line historyHits', () => {
    const wrapped = ['A follow-up review', 'found the issue quickly.'].join('\n');
    expect(historyHits('a.md', wrapped)).toEqual([]); // the line-based scan misses it
    const hits = historyHitsInProse('a.md', wrapped);
    expect(hits.map((h) => h.match)).toEqual(['review found']);
  });

  it('attributes a hit to its paragraph start line, the same approximation sentenceHits makes', () => {
    const text = ['intro', '', 'A follow-up review found the issue quickly.'].join('\n');
    const hits = historyHitsInProse('a.md', text);
    expect(hits).toEqual([{ file: 'a.md', line: 3, match: 'review found' }]);
  });

  it('ALSO catches a non-wrapped hit, unfiltered — the right behaviour for .md, which runs this alone', () => {
    // Regression: an earlier version filtered out anything already visible
    // on a single raw line (the shape `wrapOnlyHistoryHits`, below, needs
    // for its .ts pairing), which silently dropped every ordinary,
    // non-wrapped .md history phrase, since nothing else scans that view.
    const hits = historyHitsInProse('a.md', 'the first draft said otherwise');
    expect(hits.map((h) => h.match)).toEqual(['the first draft']);
  });
});

describe('wrapOnlyHistoryHits', () => {
  it('keeps a genuine wrap-catch — same case historyHitsInProse catches', () => {
    const wrapped = ['A follow-up review', 'found the issue quickly.'].join('\n');
    expect(wrapOnlyHistoryHits('a.ts', wrapped).map((h) => h.match)).toEqual(['review found']);
  });

  it('drops a hit that is already visible on a single raw line — historyHits would find it too', () => {
    const text = ['intro line', 'the first draft was different', 'more text'].join('\n');
    expect(wrapOnlyHistoryHits('a.ts', text)).toEqual([]);
  });

  it('combined with historyHits over the same view, neither drops nor doubles a non-wrapped hit', () => {
    const text = 'the first draft was different';
    const combined = [...historyHits('a.ts', text), ...wrapOnlyHistoryHits('a.ts', text)];
    expect(combined.map((h) => h.match)).toEqual(['the first draft']);
  });
});

describe('historyCountsByFile', () => {
  it('counts hits per file', () => {
    const hits = [
      ...historyHits('a.md', 'the first draft'),
      ...historyHits('a.md', 'review found it'),
      ...historyHits('b.md', 'the first draft'),
    ];
    expect(historyCountsByFile(hits)).toEqual({ 'a.md': 2, 'b.md': 1 });
  });
});

describe('scanFile — dispatch by file kind', () => {
  it('.md: masks FENCED code out of sentence and history detection', () => {
    const text = [
      '```',
      'the first draft, twelve words long enough to clear the threshold here',
      '```',
    ].join('\n');
    const result = scanFile('a.md', text);
    expect(result.sentences).toEqual([]);
    expect(result.history).toEqual([]);
    expect(result.commentChars).toBeNull();
  });

  it('.md: keeps an INLINE code span literal — it can be the only thing distinguishing two sentences', () => {
    const textA = 'Section moved verbatim from `A21-A40.md` on this date for the split.';
    const textB = 'Section moved verbatim from `A01-A20.md` on this date for the split.';
    const a = scanFile('a.md', textA).sentences;
    const b = scanFile('b.md', textB).sentences;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].key).not.toBe(b[0].key);
  });

  it('.ts: sentence detection sees only comments, never code', () => {
    const text = [
      '// The brief keeps its title and every one of its owner decisions in place.',
      "const theBriefKeepsItsTitleAndEveryOneOfItsOwnerDecisionsInPlace = 'code, not prose';",
    ].join('\n');
    const result = scanFile('a.ts', text);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0].excerpt).toContain('The brief keeps its title');
  });

  it('.ts: a sentence closing a JSDoc block on the same line groups with the identical sentence as a // comment', () => {
    // Before the trailing-marker fix, the JSDoc variant's key carried a
    // stray " /" glued on by its own closer, so the two never grouped.
    const jsdoc = `/** ${LONG_SENTENCE} */`;
    const lineComment = `// ${LONG_SENTENCE}`;
    const hits = [...scanFile('a.ts', jsdoc).sentences, ...scanFile('b.ts', lineComment).sentences];
    const groups = groupRepeated(hits);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toEqual(new Set(['a.ts', 'b.ts']));
  });

  it('.ts: history-phrase detection reads the WHOLE file, including string literals like describe/it titles', () => {
    const text = "describe('fix round 2 — a case that used to fail', () => {});";
    const result = scanFile('a.ts', text);
    expect(result.history.map((h) => h.match)).toContain('fix round 2');
  });

  it('.ts: catches "the first draft" wrapped across a JSDoc continuation line — the real allocation.ts/overview.ts/useAssetDialogs.ts shape', () => {
    const text = [
      '/**',
      ' * Some context here, and the',
      ' * first draft got it wrong.',
      ' */',
      'export function f() {}',
    ].join('\n');
    const result = scanFile('a.ts', text);
    expect(result.history.map((h) => h.match)).toEqual(['the first draft']);
  });

  it('.ts: a non-wrapped comment phrase is reported exactly once, not doubled by the two history passes', () => {
    const text = '// the first draft was different\ncode();';
    const result = scanFile('a.ts', text);
    expect(result.history.map((h) => h.match)).toEqual(['the first draft']);
  });

  it('.ts: reports a comment-volume result', () => {
    const text = '// comment\ncode();';
    const result = scanFile('a.ts', text);
    expect(result.commentChars).not.toBeNull();
    expect(result.commentChars!.file).toBe('a.ts');
  });

  it('.ts: comment volume is invariant to a code-only edit elsewhere in the file', () => {
    const before = '// only comment\nconst a = 1;\n';
    const after = before + 'const b = 2;\nconst c = 3;\n';
    expect(scanFile('x.ts', after).commentChars?.chars).toBe(
      scanFile('x.ts', before).commentChars?.chars,
    );
  });

  it('.ts: comment volume is identical whether the source file is CRLF or LF (CI checks out LF, this Windows tree is mostly CRLF)', () => {
    const lf = '// a comment\ncode();\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(scanFile('x.ts', crlf).commentChars?.chars).toBe(
      scanFile('x.ts', lf).commentChars?.chars,
    );
  });

  it('.sql and unknown kinds are excluded from all three checks', () => {
    const text = '-- the first draft of this migration, twelve words to clear the threshold';
    expect(scanFile('a.sql', text)).toEqual({ sentences: [], commentChars: null, history: [] });
    expect(scanFile('a.json', text)).toEqual({ sentences: [], commentChars: null, history: [] });
  });

  it('.d.ts is excluded, same as the claim lint', () => {
    expect(
      scanFile('a.d.ts', '// the first draft of a long enough comment here to clear both'),
    ).toEqual({
      sentences: [],
      commentChars: null,
      history: [],
    });
  });

  it('docs/decisions/ is excluded from history-phrase detection — narrating history is what a decision record is for', () => {
    const text = 'A prior pass ruled otherwise; review found the earlier draft was wrong.';
    const result = scanFile('docs/decisions/D97.md', text);
    expect(result.history).toEqual([]);
  });

  it('docs/archive/ is excluded from history-phrase detection too, same reason', () => {
    const text = 'The first draft of this closed task said something else entirely.';
    const result = scanFile('docs/archive/plan-a/section-a-b.md', text);
    expect(result.history).toEqual([]);
  });

  it('docs/decisions/ is ALSO excluded from repeated-sentence detection — every decision shares a structural footer by design', () => {
    // A brand-new docs/decisions/D98.md, created exactly as CLAUDE.md
    // instructs, must not be immediately `over` a baseline of 0 just for
    // carrying the same footer every other decision carries.
    const text = `${LONG_SENTENCE} And something specific to this decision only.`;
    const result = scanFile('docs/decisions/D98.md', text);
    expect(result.sentences).toEqual([]);
  });

  it('docs/archive/ is ALSO excluded from repeated-sentence detection — closing a task must not turn the gate red', () => {
    const text = `${LONG_SENTENCE} And something specific to this closed task only.`;
    const result = scanFile('docs/archive/plan-a/section-z.md', text);
    expect(result.sentences).toEqual([]);
  });

  it('a file OUTSIDE docs/decisions/ and docs/archive/ still gets both checks — the exemption is scoped, not global', () => {
    const historyResult = scanFile('docs/plans/PLAN-NOW.md', 'the first draft said otherwise');
    expect(historyResult.history).toHaveLength(1);
    const sentenceResult = scanFile(
      'docs/plans/PLAN-NOW.md',
      `${LONG_SENTENCE} And something specific to this plan only.`,
    );
    expect(sentenceResult.sentences).toHaveLength(1);
  });
});
