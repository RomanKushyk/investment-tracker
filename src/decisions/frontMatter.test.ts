import { describe, expect, it } from 'vitest';
import {
  parseDecisionFile,
  parseDecisionFileAt,
  unquoteYaml,
  type DecisionFrontMatter,
} from './frontMatter';

// No YAML library is a dependency of this repo (checked package.json). Front matter is
// hand-written, never generated, so this module only reads it — `unquoteYaml` proves it
// decodes the punctuation decision prose actually contains, rather than trusting it by
// inspection.

describe('unquoteYaml', () => {
  const cases: Array<[string, string]> = [
    ['"plain"', 'plain'],
    ['"a colon: and more"', 'a colon: and more'],
    ['"an em dash — right here"', 'an em dash — right here'],
    ['"backticks `like this`"', 'backticks `like this`'],
    ['"**bold** and ~~struck~~"', '**bold** and ~~struck~~'],
    ['"a pipe | in the middle"', 'a pipe | in the middle'], // unquoteYaml itself does not reject a bare "|" — parseDecisionFile's separate check does
    ['"an apostrophe\'s here"', "an apostrophe's here"],
    ['"a literal \\"quote\\""', 'a literal "quote"'],
    ['"a trailing backslash\\\\"', 'a trailing backslash\\'],
    ['"\\\\|"', '\\|'], // the D92 table-escape sequence, stored as literal text
  ];

  it.each(cases)('decodes %j to %j', (raw, expected) => {
    expect(unquoteYaml(raw)).toBe(expected);
  });

  it('rejects a scalar with no surrounding quotes', () => {
    expect(() => unquoteYaml('bare')).toThrow(/double-quoted/);
  });
});

function block(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\r\n${lines.join('\r\n')}\r\n---\r\n\r\n`;
}

describe('parseDecisionFile', () => {
  const fm: DecisionFrontMatter = {
    id: 'D67',
    date: '2026-08-17',
    summary: "Production moves on a version, not on a calendar — supersedes D59's cadence",
    amends: ['D59'],
  };

  it('parses id, date, summary and amends', () => {
    const text =
      block({
        id: fm.id,
        date: fm.date,
        summary: '"Production moves on a version, not on a calendar — supersedes D59\'s cadence"',
        amends: '[D59]',
      }) + '> Decision log entry.\r\n\r\n## D67 — Production moves…\r\n';
    expect(parseDecisionFile(text)).toEqual(fm);
  });

  it('amends is an empty array when the key is absent', () => {
    const text = block({ id: 'D1', date: '2026-07-27', summary: '"no amendment here"' }) + 'x\r\n';
    expect(parseDecisionFile(text).amends).toEqual([]);
  });

  it('carries index_extra_row for the D43 case', () => {
    const text =
      block({
        id: 'D43',
        date: '2026-08-11',
        summary: '"Backfill fails on every historical date, and it is **not** the layout"',
        index_extra_row:
          '"~~The NBU parser only reads the current file layout~~ — **kept as the record of a wrong diagnosis**"',
      }) + 'x\r\n';
    expect(parseDecisionFile(text)).toEqual({
      id: 'D43',
      date: '2026-08-11',
      summary: 'Backfill fails on every historical date, and it is **not** the layout',
      amends: [],
      indexExtraRow:
        '~~The NBU parser only reads the current file layout~~ — **kept as the record of a wrong diagnosis**',
    });
  });

  it('parses multiple amends targets in order', () => {
    const text =
      block({
        id: 'D91',
        date: '2026-08-25',
        summary: '"one aliased column"',
        amends: '[D90, D48]',
      }) + 'x\r\n';
    expect(parseDecisionFile(text).amends).toEqual(['D90', 'D48']);
  });

  it('rejects a file with no front matter block', () => {
    expect(() => parseDecisionFile('# just a heading\r\n')).toThrow(/no front matter/);
  });

  it('rejects an unknown front matter key', () => {
    const text = block({ id: 'D1', date: '2026-07-27', bogus: '"x"' }) + 'x\r\n';
    expect(() => parseDecisionFile(text)).toThrow(/unknown front matter key/);
  });

  it('rejects the retired `title` key, so a stale writer fails loudly rather than silently dropping it', () => {
    const text = block({ id: 'D1', date: '2026-07-27', title: '"x"', summary: '"y"' }) + 'x\r\n';
    expect(() => parseDecisionFile(text)).toThrow(/unknown front matter key: title/);
  });

  it('rejects the retired `supersedes` key', () => {
    const text =
      block({ id: 'D1', date: '2026-07-27', summary: '"y"', supersedes: '[D2]' }) + 'x\r\n';
    expect(() => parseDecisionFile(text)).toThrow(/unknown front matter key: supersedes/);
  });

  it('an entirely-LF file (what CI actually checks out) parses the same as CRLF', () => {
    const crlf = block({ id: 'D1', date: '2026-07-27', summary: '"x"' }) + '> body\r\n';
    const lf = crlf.replace(/\r\n/g, '\n');
    expect(lf).not.toContain('\r');
    expect(parseDecisionFile(lf)).toEqual({
      id: 'D1',
      date: '2026-07-27',
      summary: 'x',
      amends: [],
    });
  });

  describe('date validation', () => {
    it.each(['25.08.2026', 'TBD', '2026-13-45', '2026-02-30', '2026/08/27'])(
      'rejects %j',
      (date) => {
        const text = block({ id: 'D1', date, summary: '"x"' }) + 'x\r\n';
        expect(() => parseDecisionFile(text)).toThrow(/date must be a real ISO calendar date/);
      },
    );

    it('accepts a real ISO calendar date', () => {
      const text = block({ id: 'D1', date: '2026-08-27', summary: '"x"' }) + 'x\r\n';
      expect(() => parseDecisionFile(text)).not.toThrow();
    });
  });

  describe('unescaped pipe validation', () => {
    it('rejects an unescaped "|" in summary — it would silently add a table column', () => {
      const text =
        block({ id: 'D1', date: '2026-07-27', summary: '"Chose A | B over C"' }) + 'x\r\n';
      expect(() => parseDecisionFile(text)).toThrow(/summary has an unescaped "\|"/);
    });

    it('rejects an unescaped "|" in index_extra_row', () => {
      const text =
        block({
          id: 'D1',
          date: '2026-07-27',
          summary: '"fine"',
          index_extra_row: '"A | B"',
        }) + 'x\r\n';
      expect(() => parseDecisionFile(text)).toThrow(/index_extra_row has an unescaped "\|"/);
    });

    it('accepts a correctly hand-escaped "\\|", D92\'s exact case', () => {
      const text =
        block({
          id: 'D92',
          date: '2026-08-25',
          summary: '"Supersedes `PWA \\\\| vite-plugin-pwa`"',
        }) + 'x\r\n';
      expect(() => parseDecisionFile(text)).not.toThrow();
    });
  });
});

describe('parseDecisionFileAt', () => {
  it('attaches the path to a thrown parse error', () => {
    expect(() => parseDecisionFileAt('docs/decisions/D99.md', 'not front matter\r\n')).toThrow(
      /^docs\/decisions\/D99\.md: no front matter block found/,
    );
  });

  it('returns the same result as parseDecisionFile when parsing succeeds', () => {
    const text = block({ id: 'D1', date: '2026-07-27', summary: '"s"' }) + 'body\r\n';
    expect(parseDecisionFileAt('docs/decisions/D1.md', text)).toEqual(parseDecisionFile(text));
  });
});
