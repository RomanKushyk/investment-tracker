import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument, type Scalar } from 'yaml';
import { REPO } from './repo-root';

// A skill's `description` is the only text a request is matched against, and it is YAML: an
// unquoted plain scalar ends at the first ` #`, so the rest is delivered to nobody and nothing
// fails. The rule forbids that shape rather than catching one instance of it. Read from `src/`
// because vitest, eslint and prettier all exclude `.claude/` whole.
const SKILLS = join(REPO, '.claude/skills');

const skillFile = (name: string) => join(SKILLS, name, 'SKILL.md');

const names = existsSync(SKILLS)
  ? readdirSync(SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(skillFile(entry.name)))
      .map((entry) => entry.name)
  : [];

/** The frontmatter as a parsed document — its `errors` are half of what the checks below ask. */
const frontmatterOf = (source: string) => {
  const lines = source.split('\n').map((line) => line.trimEnd());
  const end = lines.indexOf('---', 1);
  // Without this, a missing closing fence gives `indexOf` -1, which `slice` reads as "one from
  // the end" — the body would parse as frontmatter and a file carrying none at all would pass.
  if (lines[0] !== '---' || end < 0) throw new Error('SKILL.md opens with no frontmatter fence');
  return parseDocument(lines.slice(1, end).join('\n'));
};

const descriptionOf = (doc: ReturnType<typeof frontmatterOf>) =>
  doc.get('description', true) as Scalar | undefined;

describe('a skill description is quoted, so YAML cannot swallow it', () => {
  // Named rather than counted, so the sweep cannot pass over a directory that no longer holds
  // the file this guard exists for.
  it('is looking at the real .claude/skills', () => {
    expect(names).toContain('work-issue');
  });

  it.each(names)('%s carries its whole description as a quoted scalar', (name) => {
    const doc = frontmatterOf(readFileSync(skillFile(name), 'utf8'));
    // `parseDocument` COLLECTS syntax errors rather than throwing, and a quoted scalar broken
    // mid-way still reports as quoted — so without this the type below means nothing.
    expect(doc.errors.map((error) => error.message)).toEqual([]);
    const description = descriptionOf(doc);
    // Positively, because a description written as a list or a map has neither `type` nor
    // `value` and would satisfy any pair of negative assertions.
    expect(typeof description?.value).toBe('string');
    expect(String(description?.value).trim()).not.toBe('');
    expect(description?.type).not.toBe('PLAIN');
  });

  // The two shapes the checks above exist for, read by the same helper.
  it('an unquoted # swallows the tail', () => {
    const description = descriptionOf(frontmatterOf('---\ndescription: a b #c\n---\n'));
    expect(description?.type).toBe('PLAIN');
    expect(description?.value).toBe('a b');
  });

  it('a stray apostrophe truncates a quoted scalar without changing its type', () => {
    const doc = frontmatterOf("---\ndescription: 'let's build X'\n---\n");
    expect(descriptionOf(doc)?.type).toBe('QUOTE_SINGLE');
    expect(descriptionOf(doc)?.value).toBe('let');
    expect(doc.errors).not.toEqual([]);
  });
});
