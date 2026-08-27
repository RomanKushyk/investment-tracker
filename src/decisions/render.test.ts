import { describe, expect, it } from 'vitest';
import { assertUnderLineCap, README_LINE_CAP, renderRow, spliceGeneratedRows } from './render';
import type { DecisionRecord } from './records';

function record(over: Partial<DecisionRecord> & { num: number }): DecisionRecord {
  return {
    id: `D${over.num}`,
    date: '2026-01-01',
    summary: 'summary',
    amends: [],
    ...over,
  };
}

describe('renderRow', () => {
  it('renders one row for a decision with no extra row', () => {
    const r = record({ num: 1, summary: 'A summary' });
    expect(renderRow(r)).toEqual(['| [D1](D1.md) | A summary | 2026-01-01 |']);
  });

  it('renders the extra row directly after the main row, same date, "*(original)*" label', () => {
    const r = record({ num: 43, summary: 'Own row', indexExtraRow: 'Original row' });
    expect(renderRow(r)).toEqual([
      '| [D43](D43.md) | Own row | 2026-01-01 |',
      '| [D43 *(original)*](D43.md) | Original row | 2026-01-01 |',
    ]);
  });
});

describe('spliceGeneratedRows — CRLF', () => {
  const records = [record({ num: 1, summary: 'first' }), record({ num: 2, summary: 'second' })];

  it('fills a marker block with the matching range and leaves the rest untouched', () => {
    const readme =
      'before\r\n<!-- decisions:rows range="1-2" -->\r\nstale\r\n<!-- /decisions:rows -->\r\nafter\r\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.text).toBe(
      'before\r\n<!-- decisions:rows range="1-2" -->\r\n' +
        '| [D1](D1.md) | first | 2026-01-01 |\r\n| [D2](D2.md) | second | 2026-01-01 |\r\n' +
        '<!-- /decisions:rows -->\r\nafter\r\n',
    );
    expect(result.blocksFilled).toBe(1);
    expect(result.rowsRendered).toBe(2);
  });

  it('fills independent blocks independently, by range', () => {
    const readme =
      '<!-- decisions:rows range="1-1" -->\r\nx\r\n<!-- /decisions:rows -->\r\n' +
      '<!-- decisions:rows range="2-2" -->\r\ny\r\n<!-- /decisions:rows -->\r\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.text).toContain('| [D1](D1.md) | first | 2026-01-01 |');
    expect(result.text).toContain('| [D2](D2.md) | second | 2026-01-01 |');
    expect(result.text.indexOf('D1')).toBeLessThan(result.text.indexOf('D2'));
    expect(result.blocksFilled).toBe(2);
  });

  it('an unbounded range ("41-") runs through the highest id', () => {
    const twoAndThree = [
      record({ num: 2, summary: 'second' }),
      record({ num: 3, summary: 'third' }),
    ];
    const readme = '<!-- decisions:rows range="2-" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    const result = spliceGeneratedRows(readme, twoAndThree);
    expect(result.text).toBe(
      '<!-- decisions:rows range="2-" -->\r\n' +
        '| [D2](D2.md) | second | 2026-01-01 |\r\n| [D3](D3.md) | third | 2026-01-01 |\r\n' +
        '<!-- /decisions:rows -->\r\n',
    );
  });

  it('DOES detect drift — a stale row inside a marker is not left alone', () => {
    const readme =
      '<!-- decisions:rows range="1-2" -->\r\n' +
      '| [D1](D1.md) | STALE | 2026-01-01 |\r\n| [D2](D2.md) | second | 2026-01-01 |\r\n' +
      '<!-- /decisions:rows -->\r\n';
    expect(spliceGeneratedRows(readme, records).text).not.toBe(readme);
  });

  it('a no-marker file with no records is a genuine no-op', () => {
    const readme = 'plain prose, no markers here\r\n';
    const result = spliceGeneratedRows(readme, []);
    expect(result).toEqual({ text: readme, blocksFilled: 0, rowsRendered: 0 });
  });
});

describe('spliceGeneratedRows — LF', () => {
  const records = [record({ num: 1, summary: 'first' }), record({ num: 2, summary: 'second' })];

  it('fills a marker block on an LF file and stays LF (no mixed endings)', () => {
    const readme =
      'before\n<!-- decisions:rows range="1-2" -->\nstale\n<!-- /decisions:rows -->\nafter\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.text).toBe(
      'before\n<!-- decisions:rows range="1-2" -->\n' +
        '| [D1](D1.md) | first | 2026-01-01 |\n| [D2](D2.md) | second | 2026-01-01 |\n' +
        '<!-- /decisions:rows -->\nafter\n',
    );
    expect(result.text).not.toContain('\r\n');
  });

  it('DOES detect drift on an LF file too — not only the CRLF one', () => {
    const readme =
      '<!-- decisions:rows range="1-2" -->\n' +
      '| [D1](D1.md) | STALE | 2026-01-01 |\n| [D2](D2.md) | second | 2026-01-01 |\n' +
      '<!-- /decisions:rows -->\n';
    expect(spliceGeneratedRows(readme, records).text).not.toBe(readme);
  });
});

describe('spliceGeneratedRows — silence becomes impossible', () => {
  const records = [record({ num: 1 }), record({ num: 2 })];

  it('throws, rather than reporting "current", when a record has no marker at all', () => {
    const readme = 'plain prose, no markers here\r\n';
    expect(() => spliceGeneratedRows(readme, records)).toThrow(/landed in no/);
  });

  it("throws, naming the line, when a marker's closing tag is missing", () => {
    const readme = '<!-- decisions:rows range="1-2" -->\r\nstale\r\n';
    expect(() => spliceGeneratedRows(readme, records)).toThrow(
      /failed to match a complete block, at line 1/,
    );
  });

  it('throws, naming the line, when a range typo makes a marker unmatchable', () => {
    // "1-2" mistyped without the dash: still a genuine (non-code) opening
    // marker, but MARKER_RE's range attribute cannot match it.
    const readme = '<!-- decisions:rows range="12" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    expect(() => spliceGeneratedRows(readme, records)).toThrow(
      /failed to match a complete block, at line 1/,
    );
  });

  it('throws when a marker range matches zero decisions — a blank block would end the table', () => {
    const readme =
      '<!-- decisions:rows range="200-300" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    expect(() => spliceGeneratedRows(readme, records)).toThrow(/matches no decisions/);
  });

  it('throws when a decision lands in two blocks, not only when it lands in none', () => {
    const readme =
      '<!-- decisions:rows range="1-2" -->\r\nx\r\n<!-- /decisions:rows -->\r\n' +
      '<!-- decisions:rows range="2-2" -->\r\ny\r\n<!-- /decisions:rows -->\r\n';
    expect(() => spliceGeneratedRows(readme, records)).toThrow(
      /landed in more than one "decisions:rows" block: D2/,
    );
  });
});

describe('spliceGeneratedRows — the syntax can be documented in the file it maintains', () => {
  const records = [record({ num: 1, summary: 'first' }), record({ num: 2, summary: 'second' })];

  it('a marker shown in an inline code span is not read as a live one', () => {
    const readme =
      'Documented as `<!-- decisions:rows range="1-2" -->` in prose.\r\n' +
      '<!-- decisions:rows range="1-2" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.text).toContain('Documented as `<!-- decisions:rows range="1-2" -->` in prose.');
    expect(result.blocksFilled).toBe(1);
  });

  it('a full worked example inside a fenced code block is left untouched', () => {
    const readme =
      '```\r\n<!-- decisions:rows range="1-2" -->\r\nEXAMPLE ROW\r\n<!-- /decisions:rows -->\r\n```\r\n' +
      '<!-- decisions:rows range="1-2" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.text).toContain('EXAMPLE ROW');
    expect(result.blocksFilled).toBe(1);
  });

  it('a backtick-fenced example whose delimiter carries a backtick in its info string does not blind the real marker after it (shared fences.ts hardening)', () => {
    // The review's exact reproduction: a false fence opener (a backtick in
    // the info string means it never opens at all, CommonMark) must not
    // swallow the real marker that follows as "code", nor should the
    // false-fence text itself be misread as a genuine, incomplete marker.
    const readme =
      '```<!-- decisions:rows range="1-20" -->```\r\n' +
      '<!-- decisions:rows range="1-2" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.blocksFilled).toBe(1);
    expect(result.text).toContain('| [D1](D1.md) | first | 2026-01-01 |');
  });

  it('a blockquoted example fence is recognized as code (shared fences.ts hardening)', () => {
    const readme =
      '> ```\r\n> <!-- decisions:rows range="1-2" -->\r\n> ```\r\n' +
      '<!-- decisions:rows range="1-2" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    const result = spliceGeneratedRows(readme, records);
    expect(result.blocksFilled).toBe(1);
  });

  it('a fenced example that never closes throws "unclosed code fence", not a misleading coverage error', () => {
    const readme =
      '```markdown\r\nan example (never closed)\r\n' +
      '<!-- decisions:rows range="1-2" -->\r\nstale\r\n<!-- /decisions:rows -->\r\n';
    expect(() => spliceGeneratedRows(readme, records)).toThrow(/unclosed code fence/);
  });
});

describe('assertUnderLineCap', () => {
  it('does nothing when the text is at or under the cap', () => {
    const atCap = Array.from({ length: README_LINE_CAP }, () => 'x').join('\n') + '\n';
    expect(() => assertUnderLineCap(atCap, 'docs/decisions/README.md')).not.toThrow();
  });

  it('throws, naming the path and the count, one line over the cap', () => {
    const overCap = Array.from({ length: README_LINE_CAP + 1 }, () => 'x').join('\n') + '\n';
    expect(() => assertUnderLineCap(overCap, 'docs/decisions/README.md')).toThrow(
      /docs\/decisions\/README\.md would be 201 lines, over the 200-line cap/,
    );
  });
});
