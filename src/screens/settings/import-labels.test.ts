import { describe, expect, it } from 'vitest';

import { en, uk } from '../../i18n/messages';

import { formatReasonSentence } from './import-labels';

// A reader narrowing bumps the version as well as a model change (`core/backup/json.ts`),
// so the sentence states only what every bump shares: an older build wrote the file.
describe('the older-format refusal', () => {
  it('says the file was written by an older version of the app, with its version', () => {
    expect(formatReasonSentence('older-format', 9, en)).toBe(
      'This backup was written by an older version of the app (format 9). It can no longer be imported.',
    );
    expect(formatReasonSentence('older-format', 9, uk)).toBe(
      'Цю копію створила старіша версія застосунку (формат 9). Імпортувати її вже не можна.',
    );
  });

  it('names no cause, whatever the version', () => {
    for (const version of [1, 2]) {
      for (const [t, word] of [
        [en, 'format'],
        [uk, 'формат'],
      ] as const) {
        const sentence = formatReasonSentence('older-format', version, t);
        expect(sentence).toContain(`(${word} ${version})`);
        expect(sentence).not.toMatch(/data model|моделі даних/u);
      }
    }
  });
});
