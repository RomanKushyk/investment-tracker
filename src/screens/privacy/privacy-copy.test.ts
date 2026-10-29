import { describe, expect, it } from 'vitest';

import { en, uk } from '../../i18n/messages';

// The brief's mapping (#497): each item GDPR Art. 13(1)–(2) and Law 2297-VI Art. 12(2) asks for at
// collection, and the copy key that answers it. Walked by path, so a key that is gone fails here
// rather than at the compiler, which cannot see an emptied string or a dropped list item.
const ANSWERS: [item: string, key: string][] = [
  ['GDPR 13(1)(a) identity and contact', 'privacy.sections.controller.body.0'],
  ['GDPR 13(1)(b) data protection officer', 'privacy.sections.controller.body.1'],
  ['GDPR 13(1)(c) purposes and legal basis', 'privacy.sections.purposes.body.0'],
  ['GDPR 13(1)(d) legitimate interests', 'privacy.sections.purposes.body.0.2'],
  ['GDPR 13(1)(e) recipients', 'privacy.sections.recipients.body.0'],
  ['GDPR 13(1)(e) no one else', 'privacy.sections.recipients.body.1'],
  ['GDPR 13(1)(f) transfers', 'privacy.sections.transfers.body.0'],
  ['GDPR 13(2)(a) storage period', 'privacy.sections.retention.body.0'],
  ['GDPR 13(2)(b) rights', 'privacy.sections.rights.body.1'],
  ['GDPR 13(2)(b) how to exercise them', 'privacy.sections.rights.body.2'],
  ['GDPR 13(2)(c) withdrawing consent', 'privacy.sections.purposes.body.1'],
  ['GDPR 13(2)(d) complaint', 'privacy.sections.rights.body.3'],
  ['GDPR 13(2)(e) required or not', 'privacy.sections.data.body.1'],
  ['GDPR 13(2)(f) automated decisions', 'privacy.sections.purposes.body.1'],
  ['2297-VI 12(2) the owner, one link away', 'privacy.firstLayer'],
  ['2297-VI 12(2) composition and content', 'privacy.sections.data.body.0'],
  ['2297-VI 12(2) purpose', 'privacy.sections.purposes.body.0'],
  ['2297-VI 12(2) to whom it is passed', 'privacy.sections.recipients.body.0'],
  ['2297-VI 8(2)(1) the data’s location', 'privacy.sections.recipients.body.0.0'],
];

const SECTIONS = [
  'controller',
  'data',
  'purposes',
  'recipients',
  'transfers',
  'retention',
  'rights',
  'cookies',
  'changes',
];

function at(root: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, step) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[step]
          : undefined,
      root,
    );
}

/** A sentence, or a list whose every item is one; anything else answers nothing. */
function said(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  return Array.isArray(value) && value.length > 0 && value.every(said);
}

describe('the privacy notice answers every item asked at collection', () => {
  for (const [language, dict] of [
    ['en', en],
    ['uk', uk],
  ] as const) {
    it.each(ANSWERS)(`${language}: %s`, (_item, key) => {
      expect(said(at(dict, key)), `${language} ${key} is missing or empty`).toBe(true);
    });
  }
});

describe('the English notice says no more than the Ukrainian', () => {
  const sections = (dict: unknown) => Object.keys((at(dict, 'privacy.sections') ?? {}) as object);

  it('has the nine sections, in both languages', () => {
    expect(sections(uk)).toEqual(SECTIONS);
    expect(sections(en)).toEqual(SECTIONS);
  });

  it.each(SECTIONS)('holds as many blocks and list items in %s', (id) => {
    const shape = (dict: unknown) =>
      ((at(dict, `privacy.sections.${id}.body`) ?? []) as unknown[]).map((block) =>
        Array.isArray(block) ? block.length : 'paragraph',
      );
    expect(shape(en)).toEqual(shape(uk));
    expect(shape(uk).length, `${id} has no body`).toBeGreaterThan(0);
  });
});
