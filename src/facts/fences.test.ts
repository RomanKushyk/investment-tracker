import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACTS } from './facts';
import { markdownFiles, REPO } from './markdown-files';
import { derived } from './registry';
import { rewrite, rewriteFile, blank, keepOnly } from './fences';

const TEST_FACTS = { 'a.count': derived(() => 7), k: derived(() => 7) };

describe('blank/keepOnly — shared masking, used by src/claims/scan.ts and src/distillation/scan.ts', () => {
  it('blank replaces every character in the given ranges with a space, sparing line endings', () => {
    expect(blank('abcdef', [{ start: 1, end: 4 }])).toBe('a   ef');
  });

  it('blank leaves a line ending inside a range untouched, so line numbers stay meaningful', () => {
    expect(blank('ab\ncd', [{ start: 0, end: 5 }])).toBe('  \n  ');
  });

  it('blank is a no-op with no ranges', () => {
    expect(blank('abcdef', [])).toBe('abcdef');
  });

  it('keepOnly is the mirror of blank — everything OUTSIDE the ranges is blanked instead', () => {
    expect(keepOnly('abcdef', [{ start: 1, end: 4 }])).toBe(' bcd  ');
  });

  it('keepOnly also spares a line ending outside its kept ranges', () => {
    expect(keepOnly('ab\ncd', [{ start: 0, end: 2 }])).toBe('ab\n  ');
  });

  it("PIN: keepOnly with NO ranges blanks the WHOLE text — the dangerous direction, unlike blank's no-op", () => {
    // If commentRanges ever returned [] for a file that genuinely has
    // comments, this is the exact shape scanFile's .ts branch would see:
    // an all-space view, read as "no comment", reporting the file as
    // improved when nothing changed. blank([]) is a safe no-op; keepOnly([])
    // is not, and that asymmetry is worth its own pin, not just blank's.
    expect(keepOnly('ab\ncd', [])).toBe('  \n  ');
  });
});

describe('the fence rewriter', () => {
  it('fills a fence with the fact value', () => {
    expect(rewrite('there are <!--f:a.count-->3<!--/f--> of them', TEST_FACTS)).toBe(
      'there are <!--f:a.count-->7<!--/f--> of them',
    );
  });

  it('is idempotent', () => {
    const once = rewrite('x <!--f:a.count-->3<!--/f--> y', TEST_FACTS);
    expect(rewrite(once, TEST_FACTS)).toBe(once);
  });

  it('leaves text with no fences untouched — frozen past tense must survive', () => {
    const frozen = 'PLAN-NOW.md had reached 2,211 lines and carried 51 closed tasks';
    expect(rewrite(frozen, TEST_FACTS)).toBe(frozen);
  });

  it('THROWS on an unknown key rather than skipping it', () => {
    // A rewriter that silently ignores what it cannot resolve is how a check
    // stops checking while the suite stays green.
    expect(() => rewrite('<!--f:nope-->1<!--/f-->', TEST_FACTS)).toThrow(/nope/);
  });

  it('THROWS on an unclosed fence', () => {
    expect(() => rewrite('<!--f:a.count-->3 and then nothing', TEST_FACTS)).toThrow(/unclosed/i);
  });

  it('handles two fences on one line', () => {
    const two = '<!--f:a.count-->1<!--/f--> and <!--f:a.count-->2<!--/f-->';
    expect(rewrite(two, TEST_FACTS)).toBe(
      '<!--f:a.count-->7<!--/f--> and <!--f:a.count-->7<!--/f-->',
    );
  });
});

describe('fence syntax inside Markdown code is documentation, not usage', () => {
  it('does not throw on a fenced ```ts block quoting a fixture key and an unknown key', () => {
    const withCode = [
      'prose before',
      '```ts',
      "const TEST_FACTS = { 'a.count': derived(() => 7) };",
      "expect(rewrite('<!--f:a.count-->3<!--/f-->', TEST_FACTS)).toBe('<!--f:a.count-->7<!--/f-->');",
      "expect(() => rewrite('<!--f:nope-->1<!--/f-->', TEST_FACTS)).toThrow(/nope/);",
      '```',
      'prose after',
    ].join('\n');
    expect(() => rewrite(withCode, TEST_FACTS)).not.toThrow();
    expect(rewrite(withCode, TEST_FACTS)).toBe(withCode);
  });

  it('leaves a real key untouched inside a fenced ```markdown illustration', () => {
    const illustration = [
      'Example:',
      '```markdown',
      'Measured <!--f:a.count-->3<!--/f--> on a warm cluster.',
      '```',
    ].join('\n');
    expect(rewrite(illustration, TEST_FACTS)).toBe(illustration);
  });

  it('also treats a ~~~ fence as code', () => {
    const text = ['~~~', '<!--f:a.count-->3<!--/f-->', '~~~'].join('\n');
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });

  it('leaves a real key untouched inside an inline code span, even with a deliberately wrong value', () => {
    // The value (3) differs from the real fact (7) — a rewriter that only
    // "skips code" by swallowing thrown errors would still fix this, since
    // the key resolves fine and nothing throws. Only genuine code-span
    // tracking leaves a resolvable fence alone here.
    const inline = 'Plant `<!--f:a.count-->3<!--/f-->` in any Markdown file.';
    expect(rewrite(inline, TEST_FACTS)).toBe(inline);
  });

  it('still fills a fence sitting in ordinary prose next to an unrelated code span', () => {
    const mixed = 'There are <!--f:a.count-->3<!--/f--> of `them`.';
    expect(rewrite(mixed, TEST_FACTS)).toBe('There are <!--f:a.count-->7<!--/f--> of `them`.');
  });

  it('treats an unterminated inline backtick as literal text, not as an open span', () => {
    // No closing backtick on the line: the run is literal, and the fence
    // right after it is still live — an unclosed backtick must not swallow
    // the rest of the file.
    const text = 'a stray ` backtick, then <!--f:a.count-->3<!--/f--> right after';
    expect(rewrite(text, TEST_FACTS)).toBe(
      'a stray ` backtick, then <!--f:a.count-->7<!--/f--> right after',
    );
  });
});

describe('a fence opens and closes on the same line', () => {
  it('CRITICAL: a dropped closer cannot reach past a paragraph and a whole code block to a documented one further down', () => {
    // The exact review reproduction. Before this fix, rewrite() found the
    // `<!--/f-->` inside the ```md illustration and deleted everything
    // between it and the real (missing) closer — a paragraph, two blank
    // lines, and the code block's own opening fence — leaving broken
    // Markdown with a dangling ```. Now it throws instead.
    const bomb = [
      'Write it as <!--f:k-->',
      '',
      'IMPORTANT PARAGRAPH THAT MUST SURVIVE',
      '',
      '```md',
      '<!--f:k-->3<!--/f-->',
      '```',
      'tail',
    ].join('\n');
    let error: Error | undefined;
    try {
      rewrite(bomb, TEST_FACTS);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toMatch(/unclosed fence for `k`/);
    expect(error?.message).toMatch(/\bline 1\b/);
  });

  it('SECOND PROOF: an unterminated backtick masquerading as a code span cannot smuggle a distant closer either', () => {
    const bomb2 = ['`<!--f:a.count-->', 'prose', '<!--/f-->` end'].join('\n');
    expect(() => rewrite(bomb2, TEST_FACTS)).toThrow(/unclosed/i);
  });

  it('THROWS naming the line even when the fence body is short and just missing its closer', () => {
    const text = ['before', '<!--f:a.count-->3 oops', 'after'].join('\n');
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed fence for `a\.count`.*line 2/is);
  });
});

describe('a false fence opener cannot blind the rest of the file', () => {
  it('a backtick fence with a backtick in its info string is not a real opener (CommonMark), so it cannot swallow what follows', () => {
    const text = ['```sh `x`', 'not actually code', '<!--f:a.count-->3<!--/f-->', 'tail'].join(
      '\n',
    );
    expect(rewrite(text, TEST_FACTS)).toBe(
      ['```sh `x`', 'not actually code', '<!--f:a.count-->7<!--/f-->', 'tail'].join('\n'),
    );
  });

  it('THROWS, naming the opening line, if the scan ends with a fence still open — when the file also carries a fact tag', () => {
    // The no-fact-tag guard (see below) means a document that never carries
    // `<!--f:` has nothing for this function to do, so an unclosed fence in
    // it is never even examined. This variant keeps the EOF-guard itself
    // covered for the case it exists for — a file the rewriter actually has
    // to act on.
    const text = ['prose', '<!--f:a.count-->3<!--/f-->', '```ts', 'code that never closes'].join(
      '\n',
    );
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed code fence.*line 3/is);
  });
});

describe('cheap code contexts: blockquote and tab, not 4-space indent', () => {
  it('recognizes a blockquote-prefixed fence opener as code', () => {
    const text = ['> ```ts', '> <!--f:a.count-->3<!--/f-->', '> ```', 'after'].join('\n');
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });

  it('recognizes a tab-indented fence opener as code', () => {
    const text = ['\t```ts', '\t<!--f:a.count-->3<!--/f-->', '\t```', 'after'].join('\n');
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });
});

describe('CRLF line endings', () => {
  // `text.slice(i, lineEnd)` stops before `\n` but keeps a `\r` right before
  // it on a CRLF file. `.` in FENCE_OPEN's `(.*)$` cannot match `\r`, so a
  // CRLF-terminated opener line was silently rejected — while FENCE_CLOSE's
  // `\s*$` tolerated `\r` fine, closing what the opener never opened. Assert
  // the exact string, `\r\n` included, so a fix that quietly normalises line
  // endings on write fails too — that would be its own whole-file corruption.

  it('a bare CRLF-opened fenced block is recognized as code and left byte-identical', () => {
    const text = '```\r\n<!--f:k-->3<!--/f-->\r\n```\r\n';
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });

  it('a CRLF-opened fenced block with an info string is recognized as code and left byte-identical', () => {
    const text = '```md\r\n<!--f:k-->3<!--/f-->\r\n```\r\n';
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });

  it('a fact fence in CRLF prose is still rewritten, with every \\r\\n preserved exactly', () => {
    const text = 'before\r\n<!--f:k-->3<!--/f-->\r\nafter\r\n';
    expect(rewrite(text, TEST_FACTS)).toBe('before\r\n<!--f:k-->7<!--/f-->\r\nafter\r\n');
  });

  it('a fact fence inside an inline code span survives CRLF prose byte-identical', () => {
    const text = 'Plant `<!--f:k-->3<!--/f-->` here.\r\nafter\r\n';
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });
});

describe('a file with no fact tag has nothing to rewrite', () => {
  // A file containing no `<!--f:` at all cannot hold a stale fence, so
  // rewrite() returns it untouched before the scanner ever runs — its
  // code-state (fenced or not, closed or not) is irrelevant. That is what
  // lets a document with a genuinely malformed, never-closing code fence
  // sit in the tree unbothered, as long as it carries no fact tag. A file
  // that DOES carry one keeps the full guard, unclosed-fence throw included
  // — that is the case the guard exists for, proven by the sibling test
  // above (same shape, with a fact tag added, still throws).

  it('an unclosed code fence with no fact tag anywhere is skipped silently, not thrown', () => {
    const text = ['prose', '```ts', 'code that never closes'].join('\n');
    expect(rewrite(text, TEST_FACTS)).toBe(text);
  });

  it('an unclosed code fence with a fact tag elsewhere in the same file still throws', () => {
    // Same shape as the test above, plus one fact tag — the presence of
    // `<!--f:` anywhere in the file is what turns the guard back on.
    const text = ['<!--f:a.count-->3<!--/f-->', '```ts', 'code that never closes'].join('\n');
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed code fence.*line 2/is);
  });
});

describe('a closer inside an inline code span does not count', () => {
  it('CRITICAL: a `<!--/f-->` shown inside backticks on the same line is not a real closer — the fence is unclosed and throws', () => {
    // The exact review reproduction. Before this fix, the close search was a
    // plain indexOf blind to span state, so it matched the `<!--/f-->`
    // inside the backticks and deleted everything between the real
    // (missing) closer and it — here, the prose "3 and close it with `" and
    // the opening backtick. Now it throws instead, same message, same line.
    const text = 'Write <!--f:k-->3 and close it with `<!--/f-->` after.';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed fence for `k`.*line 1/is);
  });

  it('a real closer still resolves normally when a code span with no fence tag sits further along the same line', () => {
    // Not every backtick on the line is the problem — only one that
    // contains the only candidate closer. Here the real close comes first.
    const text = 'Write <!--f:a.count-->3<!--/f--> then `code` after.';
    expect(rewrite(text, TEST_FACTS)).toBe('Write <!--f:a.count-->7<!--/f--> then `code` after.');
  });
});

describe('error messages carry the right file path and line number', () => {
  it('PIN: rewriteFile attaches the path to a thrown error — removing that prefix would leave this red', () => {
    expect(() => rewriteFile('some/path.md', '<!--f:nope-->1<!--/f-->', TEST_FACTS)).toThrow(
      /^some\/path\.md: unknown fact key `nope`/,
    );
  });

  it('PIN: line counting stays correct across a documented code block, so an error after it names the true line', () => {
    // The realistic bomb: a dropped closer AFTER a fence, not before one —
    // every other line-number assertion in this file names an error that
    // happens before any code block, so none of them would notice either
    // line-increment (entering or continuing a fence) going missing.
    const text = 'a\n```ts\nx\ny\nz\n```\nWrite <!--f:k--> with no closer\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed fence for `k`.*line 7/is);
  });

  it('PIN: the same line count holds across a CRLF-terminated code block', () => {
    const text = 'a\r\n```ts\r\nx\r\ny\r\nz\r\n```\r\nWrite <!--f:k--> with no closer\r\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed fence for `k`.*line 7/is);
  });
});

describe('declared limits of the code-context scanner', () => {
  it('DECLARED LIMIT: a 4-space-indented fenced block is NOT recognized as code, so a fence inside it IS rewritten', () => {
    // Deliberate, not a bug — see stripCodeContext's comment above: telling
    // an indented code block apart from list-item continuation is
    // CommonMark's hairiest corner, and a wrong guess would silently SKIP
    // real fences inside list items. This pins the CURRENT behaviour so a
    // later "improvement" cannot silently change it without a failing test.
    const text = '    ```ts\n    <!--f:a.count-->3<!--/f-->\n    ```\n';
    expect(rewrite(text, TEST_FACTS)).toBe('    ```ts\n    <!--f:a.count-->7<!--/f-->\n    ```\n');
  });

  it('DECLARED LIMIT: a doubly-nested blockquote fence opener is NOT recognized as code, so a fence inside it IS rewritten', () => {
    // Deliberate — stripCodeContext strips exactly one blockquote level.
    // Pinned for the same reason as the 4-space case above: a trade-off
    // with no test is just a comment.
    const text = '> > ```ts\n> > <!--f:a.count-->3<!--/f-->\n> > ```\n';
    expect(rewrite(text, TEST_FACTS)).toBe('> > ```ts\n> > <!--f:a.count-->7<!--/f-->\n> > ```\n');
  });

  it('DECLARED LIMIT: a blockquoted fence marker inside an open code fence closes it early — no container tracking', () => {
    // Deliberate, same class of limit as the two above: stripCodeContext
    // runs unconditionally on every candidate closer line, including lines
    // that are CONTENT inside an already-open fence — so a "> ```" example
    // quoted inside a ```markdown block reads as a real closer three lines
    // early. The correct fix is container-level tracking (a fence inside a
    // blockquote closes only at the same container level), the same hairy
    // CommonMark corner as the two limits above, refused for the same
    // reason. Nothing in the repo triggers this today.
    const text = '```markdown\n> ```\n<!--f:k-->3<!--/f-->\n```\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed code fence opened on line 4/);
  });

  it('DECLARED LIMIT: a tab-indented fence marker inside an open code fence closes it early too — same class as the blockquote case', () => {
    // Same mechanism as the blockquote case just above, same refusal.
    const text = '```markdown\n\t```\n<!--f:k-->3<!--/f-->\n```\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed code fence opened on line 4/);
  });

  it('DECLARED LIMIT: fence syntax inside an indented (4+ space) code block THROWS rather than being silently skipped or corrected', () => {
    // Not a bug fix, a documented trade-off: the two failure modes here are
    // not symmetric. Treating 4-space indentation as code (like the other
    // limits above) risks silently SKIPPING a real fence inside a list item
    // in a repo whose docs are dense with indented list content — a fence
    // that quietly stops being maintained. NOT treating it as code, as
    // today, produces a loud red suite instead. Loud beats silent, so this
    // is the right side of the trade — it only needed pinning, not fixing.
    const text = '- see this:\n\n      <!--f:nope-->1<!--/f-->\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unknown fact key `nope`/);
  });
});

describe('an orphan closer is the mirror of an unclosed opener', () => {
  it('CRITICAL: a closer with no opener throws, naming the line, instead of being copied through silently', () => {
    // The exact review reproduction. Before this fix, a lone `<!--/f-->`
    // with nothing to close was just ordinary text to the scanner — copied
    // through untouched, no error, suite green. Losing the opener half of a
    // fence (a hand edit, a careless search-and-replace, a conflict
    // resolution) must be exactly as loud as losing the closer half.
    const text = 'A: <!--f:k-->3<!--/f--> ok\nB: 51<!--/f--> orphan\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/orphan closer.*line 2/is);
  });

  it('an orphan closer is caught even in a file with no opener anywhere — the early-return checks CLOSE too', () => {
    // Deliberate choice: the file whose ONLY damage is a lost opener has no
    // `<!--f:` left in it at all, only the orphaned `<!--/f-->` — an
    // early-return keyed on OPEN alone would let exactly that file, the one
    // this guard exists for, slip past unscanned. So the guard checks for
    // either tag before deciding there is nothing to do.
    const text = 'B: 51<!--/f--> orphan, no opener anywhere in this file\n';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/orphan closer.*line 1/is);
  });

  it('a closer inside a code span or fenced block is not an orphan — it is documentation, same as always', () => {
    const inline = 'Shown as `<!--/f-->` in an example.';
    const fenced = ['```md', '<!--/f-->', '```'].join('\n');
    expect(rewrite(inline, TEST_FACTS)).toBe(inline);
    expect(rewrite(fenced, TEST_FACTS)).toBe(fenced);
  });
});

describe('a second opener on the same line cannot smuggle its closer to the first', () => {
  it('CRITICAL: two openers on one line — the close search stops at the second opener and throws unclosed', () => {
    // The D76 pre-merge review's reproduction. Before this fix, the close
    // search just walked forward for the next `<!--/f-->`, found the
    // SECOND fence's closer, and silently folded " B " and the entire
    // second fence into the first fence's rendered value — idempotently,
    // so the drift test stayed green forever after, and `pnpm facts` is
    // what would have written the loss to disk.
    const text = 'A <!--f:k-->3 B <!--f:k-->4<!--/f--> C';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/unclosed fence for `k`.*line 1/is);
  });

  it('a well-formed pair still resolves when a second, later fence follows correctly on the same line', () => {
    // Not every second opener on a line is the problem — only one that
    // appears BEFORE the first fence's own closer. Regression guard for the
    // existing "handles two fences on one line" fixture above.
    const text = '<!--f:a.count-->1<!--/f--> and <!--f:a.count-->2<!--/f-->';
    expect(rewrite(text, TEST_FACTS)).toBe(
      '<!--f:a.count-->7<!--/f--> and <!--f:a.count-->7<!--/f-->',
    );
  });
});

describe('the unknown-key guard is not defeated by the prototype chain', () => {
  it('CRITICAL: <!--f:constructor--> and <!--f:toString--> both throw unknown-key rather than rendering a prototype method', () => {
    // facts[key] alone resolves to Object.prototype's own constructor/
    // toString with no error, rendering "undefined undefined" — verified
    // before this fix. Object.hasOwn checks only the registry's own keys.
    expect(() => rewrite('<!--f:constructor-->x<!--/f-->', TEST_FACTS)).toThrow(
      /unknown fact key `constructor`/,
    );
    expect(() => rewrite('<!--f:toString-->x<!--/f-->', TEST_FACTS)).toThrow(
      /unknown fact key `toString`/,
    );
  });
});

describe('a malformed fact tag is an error, not silent pass-through', () => {
  it('CRITICAL: a key with a space is not silently ignored — it throws, naming the line', () => {
    // Before this fix, `<!--f:seed assets-->` failed to match OPEN and was
    // just copied through character by character — a fence that looks
    // machine-maintained and never is, forever.
    const text = 'x <!--f:seed assets-->3 y';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/malformed fact tag on line 1/);
  });

  it('names the malformed opener, not a misleading orphan closer, when a closer follows it on the line', () => {
    // The confusing knock-on: before this fix, the same malformed tag WITH
    // its closer present reached the real `<!--/f-->` later on the line and
    // threw "orphan closer … no matching opener" — true in the narrowest
    // sense (OPEN never matched) but the wrong defect to report. The
    // malformed-tag check now fires first, at the actual mistake.
    const text = 'x <!--f:seed assets-->3<!--/f--> y';
    expect(() => rewrite(text, TEST_FACTS)).toThrow(/malformed fact tag on line 1/);
  });
});

it('every Markdown fence in the repository is current', () => {
  // The REAL registry, not the fixture above — scanning the tree against a
  // one-key stub would throw on every genuine fence. The gate already runs
  // `pnpm test`, so this needs no new command; `pnpm facts` is the fix.
  const stale = markdownFiles(REPO).filter((p) => {
    const text = readFileSync(p, 'utf8');
    return rewriteFile(p, text, FACTS) !== text;
  });
  expect(stale, 'stale fences — run `pnpm facts`').toEqual([]);
});
