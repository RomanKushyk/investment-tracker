import { describe, expect, it } from 'vitest';

import { answerOf } from './access';

describe('what a refused caller is told', () => {
  it.each([
    [{ error: 'pending' }, 'pending'],
    [{ error: 'rejected' }, 'rejected'],
    [{ error: 'no_application' }, 'noApplication'],
    [{ error: 'forbidden' }, 'forbidden'],
  ])('reads a 403 %j as %s', (body, expected) => {
    expect(answerOf(403, body)).toBe(expected);
  });

  it.each([
    // The relay's own 403, which refuses a request rather than a caller.
    [403, { error: 'csrf' }],
    [403, { error: 'internal' }],
    // A name every object answers to, so a lookup on a plain object would find it.
    [403, { error: 'constructor' }],
    [403, { error: 'toString' }],
    [403, {}],
    [403, null],
    [403, 'pending'],
    [403, ['pending']],
    [401, { error: 'pending' }],
    [200, { error: 'pending' }],
    [500, { error: 'internal' }],
  ])('reads %i %j as no answer', (status, body) => {
    expect(answerOf(status, body)).toBeUndefined();
  });
});
