import { describe, expect, it } from 'vitest';
import { fileKind, scanFile } from './scan';

// The real fact registry's shape, not its content — every test below that
// does not care about fact citation still needs SOME set to pass, and the
// two keys used by fixtures that DO care (below) must be real members of
// it, matching how `scanFile` is actually called in production (a real
// `Object.keys(FACTS)`).
const TEST_FACT_KEYS = new Set(['app.colorSlots', 'dpu.observeNbu.window']);

function scan(relPath: string, text: string): ReturnType<typeof scanFile> {
  return scanFile(relPath, text, TEST_FACT_KEYS);
}

function rules(claims: ReturnType<typeof scanFile>): number[] {
  return claims.map((c) => c.rule);
}

describe('fileKind', () => {
  it('recognizes the four target extensions and nothing else', () => {
    expect(fileKind('docs/README.md')).toBe('md');
    expect(fileKind('infra/migrations/001.sql')).toBe('sql');
    expect(fileKind('src/claims/scan.ts')).toBe('ts');
    expect(fileKind('src/App.tsx')).toBe('ts');
    expect(fileKind('package.json')).toBeNull();
    expect(fileKind('README')).toBeNull();
  });

  it('excludes .d.ts — a pure ambient declaration ts.transpileModule cannot emit', () => {
    expect(fileKind('src/vite-env.d.ts')).toBeNull();
  });
});

describe('rule 1 — bare numbers of measured shape', () => {
  it('flags a number with a measured-shape unit in Markdown prose', () => {
    const claims = scan('x.md', 'Measured 0.25594 DPU on a warm cluster.');
    expect(rules(claims)).toContain(1);
  });

  it('flags %, ms and × the same way', () => {
    expect(rules(scan('x.md', 'up 3.08% today'))).toContain(1);
    expect(rules(scan('x.md', 'took 12ms to run'))).toContain(1);
    expect(rules(scan('x.md', 'a 9.1× win'))).toContain(1);
  });

  it('does NOT flag a bare number with no measured-shape unit', () => {
    expect(scan('x.md', 'the rate is 44.83 today')).toEqual([]);
  });

  it('is exempt inside a fenced code block — a pasted plan is evidence, not a claim', () => {
    const text = ['```', 'Measured 0.25594 DPU on a warm cluster.', '```'].join('\n');
    expect(scan('x.md', text)).toEqual([]);
  });

  it('is exempt inside an inline code span too', () => {
    expect(scan('x.md', 'the value `0.25594 DPU` was captured')).toEqual([]);
  });

  it('is exempt when the number is rendered through a fact fence', () => {
    const text = 'Measured <!--f:dpu.observeNbu.window-->0.25594 DPU<!--/f--> on a warm cluster.';
    expect(scan('x.md', text)).toEqual([]);
  });

  it('does NOT pair a number on one line with a unit on the next', () => {
    const text = 'a measurement of 12\nms elapsed';
    expect(scan('x.md', text)).toEqual([]);
  });
});

describe('rule 2 — bare counts of repository things', () => {
  it('flags a number immediately followed by a repository-thing noun', () => {
    expect(rules(scan('x.md', '97 decisions live here, and 22 carry tables'))).toEqual([2, 2]);
  });

  it('flags across one or two intervening words too', () => {
    expect(rules(scan('x.md', 'the log carries 39 distinct findings'))).toContain(2);
  });

  it('does not flag a number with no repository-thing noun nearby', () => {
    expect(scan('x.md', 'the rate is 44.83 today')).toEqual([]);
  });

  it('is exempt inside a fenced code block', () => {
    const text = ['```', '97 decisions', '```'].join('\n');
    expect(scan('x.md', text)).toEqual([]);
  });

  it('does NOT split a decimal — "about 3.5 files" is not read as "5 files"', () => {
    expect(scan('x.md', 'about 3.5 files were affected')).toEqual([]);
  });

  it('does NOT pair a number on one line with a noun on the next', () => {
    const text = 'there are 97\ndecisions in the log';
    expect(scan('x.md', text)).toEqual([]);
  });
});

describe('rule 3 — an absolute that names a code identifier', () => {
  it('flags an exclusivity claim naming a backtick-wrapped identifier', () => {
    const claims = scan('x.md', 'nothing reads `Transaction.source` anywhere');
    expect(rules(claims)).toEqual([3]);
  });

  it('does NOT flag design intent with no identifier cited', () => {
    expect(scan('x.md', 'Never add a VPC')).toEqual([]);
    expect(scan('x.md', "the app's ONE scroll surface")).toEqual([]);
  });

  it('does NOT flag an absolute next to a plain word in backticks — not identifier-shaped', () => {
    expect(scan('x.md', 'only `emphasis`, not an identifier')).toEqual([]);
  });

  it('flags other identifier shapes too: a call, CONST_CASE, camelCase, a filename', () => {
    expect(scan('x.md', 'only `parseAsset()` does this')).toHaveLength(1);
    expect(scan('x.md', 'never read `MAX_RETRIES` directly')).toHaveLength(1);
    expect(scan('x.md', 'only `useFormat` touches this')).toHaveLength(1);
    expect(scan('x.md', 'nothing imports `legacy.ts` anymore')).toHaveLength(1);
  });

  it('flags a full repo-relative path, not just a bare filename — this repo cites files that way', () => {
    expect(scan('x.md', 'only `README.md` says this')).toHaveLength(1);
    expect(scan('x.md', 'only `docs/plans/PLAN-NOW.md` says this')).toHaveLength(1);
    expect(scan('x.md', 'only `src/components/ui/Scroller.tsx` owns this')).toHaveLength(1);
  });

  it('passes when the same line also cites a fact', () => {
    const text = 'only <!--f:app.colorSlots-->4<!--/f--> slots read `COLOR_KEYS` today';
    expect(scan('x.md', text)).toEqual([]);
  });

  it('does NOT pass on a bare `<!--f:` opener with no well-formed fence — that is not a citation', () => {
    const text = 'only <!--f: unclosed opener, reads `COLOR_KEYS` today';
    expect(scan('x.md', text)).toHaveLength(1);
  });
});

describe('the fact-citation exemption resolves against the real registry', () => {
  it('a well-formed fence citing a MADE-UP key does not exempt a rule 3 claim', () => {
    const text = 'nothing reads `Transaction.source` <!--f:totally.made.up-->99<!--/f-->';
    expect(rules(scan('x.md', text))).toEqual([3]);
  });

  it('a forged key does not mask a bare rule 1 number either', () => {
    const text = 'Measured <!--f:totally.made.up-->0.25594 DPU<!--/f--> on a warm cluster.';
    expect(rules(scan('x.md', text))).toEqual([1]);
  });

  it('a forged key does not mask a bare rule 2 count either', () => {
    const text = 'There are <!--f:totally.made.up-->97 decisions<!--/f--> here.';
    expect(rules(scan('x.md', text))).toEqual([2]);
  });
});

describe('the fact-citation exemption is .md-only, in both directions', () => {
  // Nothing outside .md renders or checks a fence's value — pnpm facts and
  // the drift check both walk .md files only — so even a REAL key must
  // not exempt anything in .ts/.sql: it would be a hand-written number
  // wearing a machine-maintained appearance forever. `app.colorSlots` is a
  // genuine member of TEST_FACT_KEYS, unlike the forged-key tests above.

  it('a REAL key does not exempt a rule 3 claim inside a .ts comment', () => {
    const text =
      '// nothing reads `Transaction.source` <!--f:app.colorSlots-->4<!--/f-->\nconst x=1;';
    expect(rules(scan('x.ts', text))).toEqual([3]);
  });

  it('a REAL key does not exempt a rule 3 claim inside a .sql comment', () => {
    const text = '-- nothing reads `Transaction.source` <!--f:app.colorSlots-->4<!--/f-->';
    expect(rules(scan('x.sql', text))).toEqual([3]);
  });

  it('a REAL key does not mask a bare rule 1 number in a .ts comment', () => {
    const text = '// Measured <!--f:dpu.observeNbu.window-->0.25594 DPU<!--/f-->\nconst x=1;';
    expect(rules(scan('x.ts', text))).toEqual([1]);
  });

  it('the identical citation DOES exempt the rule 3 claim in .md — proving the restriction is real, not a broken fence', () => {
    const text = 'nothing reads `Transaction.source` <!--f:app.colorSlots-->4<!--/f-->';
    expect(scan('x.md', text)).toEqual([]);
  });
});

describe('the escape hatch — <!--unchecked: reason-->', () => {
  it('suppresses a claim on the same line but still reports it as unchecked', () => {
    const claims = scan(
      'x.md',
      '<!--unchecked: example, not verified-->nothing reads `Transaction.source` here',
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].unchecked).toBe(true);
  });

  it('does not suppress a claim on a DIFFERENT line', () => {
    const text = ['<!--unchecked: reason-->', 'nothing reads `Transaction.source` here'].join('\n');
    const claims = scan('x.md', text);
    expect(claims).toHaveLength(1);
    expect(claims[0].unchecked).toBe(false);
  });

  it('accepts the spelling with a space after <!--', () => {
    const claims = scan('x.md', '<!-- unchecked: reason-->nothing reads `Transaction.source` here');
    expect(claims).toHaveLength(1);
    expect(claims[0].unchecked).toBe(true);
  });

  it('accepts a reason containing ">"', () => {
    const claims = scan(
      'x.md',
      '<!--unchecked: true when a > b holds-->nothing reads `Transaction.source` here',
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].unchecked).toBe(true);
  });

  it('THROWS, naming the file and line, on a marker that looks like the hatch but does not parse', () => {
    const text = ['fine line one', '<!--unchecked: missing its closer', 'fine line three'].join(
      '\n',
    );
    expect(() => scan('x.md', text)).toThrow(/x\.md:2:.*unchecked-hatch marker/);
  });

  it('does NOT throw on an ordinary HTML comment that merely contains the word "unchecked"', () => {
    // The colon is what makes an attempt unambiguous — verified review
    // reproduction: neither of these is trying to be this mechanism's
    // marker, and must not brick the whole scan by looking like a typo of
    // it.
    expect(() => scan('x.md', '<!-- unchecked items below -->\nsome text')).not.toThrow();
    expect(() => scan('x.md', '<!--unchecked-boxes-->\nsome text')).not.toThrow();
  });
});

describe('.sql — wholesale, no fence exemption', () => {
  it('flags a claim inside a SQL comment, with no fenced-code concept to exempt it', () => {
    const text = '-- 97 decisions were reviewed before this migration\nCREATE TABLE t (id int);';
    expect(rules(scan('x.sql', text))).toContain(2);
  });
});

describe('.ts/.tsx — comment blocks only', () => {
  it('flags a claim written in a // comment', () => {
    const text = '// nothing reads `Transaction.source` anywhere\nconst x = 1;';
    expect(rules(scan('x.ts', text))).toEqual([3]);
  });

  it('flags a claim written in a /** */ JSDoc comment', () => {
    const text = '/** 97 decisions live here */\nexport const x = 1;';
    expect(rules(scan('x.ts', text))).toContain(2);
  });

  it('does NOT flag the same shape sitting in a string literal', () => {
    const text = "const msg = 'nothing reads `Transaction.source` anywhere';";
    expect(scan('x.ts', text)).toEqual([]);
  });

  it('does NOT flag code — only comments are in scope', () => {
    const text = 'const count = 97; // just a variable named count, not a claim';
    expect(scan('x.ts', text)).toEqual([]);
  });

  it('an identifier cited in a comment is only found within that same comment, not adjacent code', () => {
    // The backtick span here is a real template literal in CODE, not a
    // comment — masked out before rule 3 ever looks for an identifier.
    const text = 'const s = `Transaction.source`; // nothing to see here';
    expect(scan('x.tsx', text)).toEqual([]);
  });
});
