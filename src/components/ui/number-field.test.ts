import { describe, expect, it } from 'vitest';

import { caretAfterDigits, digitsBefore, withoutDigit } from './number-field';

const NBSP = ' ';

// The caret rule, apart from the DOM. The component's own wiring — that it holds
// the element AND passes the ref on — is browser behaviour and is walked there;
// what is arithmetic is pinned here, because "counted in digits, never in
// characters" is the whole reason the component exists and an offset drifts
// silently.
describe('caretAfterDigits', () => {
  it('lands just past the nth digit, however many marks moved', () => {
    expect(caretAfterDigits(`1${NBSP}234`, 1, 0)).toBe(1);
    expect(caretAfterDigits(`1${NBSP}234`, 4, 0)).toBe(5);
    expect(caretAfterDigits('1,234,567', 4, 0)).toBe(5);
    // Two marks now sit before the caret where none did — an offset would drift
    // by both.
    expect(caretAfterDigits(`1${NBSP}234${NBSP}567`, 5, 0)).toBe(7);
  });

  it('falls back to the offset when no digit sits behind the caret', () => {
    // A mark pressed in front of the first digit: `5` becomes `,5` and the caret
    // belongs AFTER what was just typed, which no digit count can say.
    expect(caretAfterDigits(',5', 0, 1)).toBe(1);
    expect(caretAfterDigits('1,234', 0, 0)).toBe(0);
    // And never past the end, nor before the start.
    expect(caretAfterDigits('1,234', 0, 99)).toBe(5);
    expect(caretAfterDigits('1,234', 0, -3)).toBe(0);
  });

  it('parks at the end when the text holds fewer digits than asked for', () => {
    expect(caretAfterDigits('12', 9, 0)).toBe(2);
    expect(caretAfterDigits('', 4, 0)).toBe(0);
  });
});

describe('digitsBefore', () => {
  it('counts digits, so a mark never shifts which one is meant', () => {
    expect(digitsBefore(`1${NBSP}234${NBSP}567`, 1)).toBe(1);
    expect(digitsBefore(`1${NBSP}234${NBSP}567`, 5)).toBe(4);
    expect(digitsBefore('1,234,567', 5)).toBe(4);
    expect(digitsBefore('1234.56', 7)).toBe(6);
    expect(digitsBefore('1,234', 0)).toBe(0);
  });
});

describe('deleting through a grouping mark', () => {
  it('takes the digit the mark guards, forwards and backwards', () => {
    // Restoring the mark and stopping there is what made forward Delete look
    // like a dead key: the mark is the field's own, so the press has to reach
    // the digit behind it.
    expect(withoutDigit('1234567', 1, true)).toBe('134567'); // Delete at `1|<mark>234`
    expect(withoutDigit('1234567', 1, false)).toBe('234567'); // Backspace at the same place
    expect(withoutDigit('1234567', 4, true)).toBe('123467'); // four digits behind it, so the 5th goes
  });

  it('does nothing at either edge rather than dropping the wrong digit', () => {
    expect(withoutDigit('1234', 0, false)).toBe('1234'); // Backspace before digit one
    expect(withoutDigit('1234', 4, true)).toBe('1234'); // Delete past the last
  });

  it('puts the caret where the deleted digit WAS, not where it counted from', () => {
    // A Backspace over a mark removes the digit behind it, so one fewer digit
    // sits behind the caret than the pressed text said — counted from the old
    // text the caret jumped forward over a mark and a digit, and the next
    // Backspace ate the wrong one.
    // Backspace at `1 |234 567` leaves the DOM holding `1234 567` with the caret
    // at 1; the `1` is then taken, so no digit is behind the caret at all.
    const digits = digitsBefore(`1234${NBSP}567`, 1) - 1;
    expect(digits).toBe(0);
    expect(caretAfterDigits(`234${NBSP}567`, digits, 0)).toBe(0);
    // At the SECOND mark it is the jump that hurt: `1 234 |567` counted four
    // digits, and the caret has to sit behind three once the 4th is gone.
    expect(caretAfterDigits(`123${NBSP}567`, digitsBefore(`1234${NBSP}567`, 4) - 1, 0)).toBe(3);
  });
});
