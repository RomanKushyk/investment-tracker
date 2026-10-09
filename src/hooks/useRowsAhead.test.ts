// @vitest-environment jsdom
// Mounted, because the step at midnight reaches the hook through the clock it subscribes to
// (*Review, gates, tests*).
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ledgerAsOf } from '@quirenote/core/view/build';
import type { Transaction } from '@quirenote/core/types';
import { CHIP_EXIT_MS, dropFade, rowAhead, settle, useRowsAhead } from './useRowsAhead';

/** jsdom has no `matchMedia`; the fade timer reads it at every step. */
function prefersReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
  }));
}

const mouse = { pointerType: 'mouse' };
const touch = { pointerType: 'touch' };

describe('settle', () => {
  it('returns the same object when nothing moves, or the render that settles it loops', () => {
    const m = { day: '2026-07-28' };
    expect(settle(m, '2026-07-28', false)).toBe(m);
    expect(settle(m, '2026-07-28', true)).toBe(m);
    const fading = { day: '2026-07-29', fadeFrom: '2026-07-28' };
    expect(settle(fading, '2026-07-29', false)).toBe(fading);
  });

  it('steps forward at once: the passed days fade, held only under a pointer', () => {
    expect(settle({ day: '2026-07-28' }, '2026-07-29', false)).toEqual({
      day: '2026-07-29',
      fadeFrom: '2026-07-28',
    });
    expect(settle({ day: '2026-07-28' }, '2026-07-29', true)).toEqual({
      day: '2026-07-29',
      fadeFrom: '2026-07-28',
      holdFrom: '2026-07-28',
    });
  });

  it('keeps the earliest range over a second step, so a folded line never reopens', () => {
    const held = { day: '2026-07-29', fadeFrom: '2026-07-28', holdFrom: '2026-07-28' };
    expect(settle(held, '2026-07-30', true)).toEqual({
      day: '2026-07-30',
      fadeFrom: '2026-07-28',
      holdFrom: '2026-07-28',
    });
    // The 29th folded with no pointer over the list; a pointer at the next step holds only the 30th.
    const folded = { day: '2026-07-29', fadeFrom: '2026-07-28' };
    expect(settle(folded, '2026-07-30', true)).toEqual({
      day: '2026-07-30',
      fadeFrom: '2026-07-28',
      holdFrom: '2026-07-29',
    });
  });

  it('folds a held line once the pointer leaves', () => {
    const held = { day: '2026-07-29', fadeFrom: '2026-07-28', holdFrom: '2026-07-28' };
    expect(settle(held, '2026-07-29', false)).toEqual({
      day: '2026-07-29',
      fadeFrom: '2026-07-28',
    });
  });

  it('steps back at once with no pointer, and waits under one', () => {
    const m = { day: '2026-07-29', fadeFrom: '2026-07-28' };
    expect(settle(m, '2026-07-28', false)).toEqual({ day: '2026-07-28' });
    expect(settle(m, '2026-07-28', true)).toBe(m);
  });
});

describe('dropFade', () => {
  it('ends the fade and keeps a hold', () => {
    expect(dropFade({ day: '2026-07-29', fadeFrom: '2026-07-28', holdFrom: '2026-07-28' })).toEqual(
      { day: '2026-07-29', holdFrom: '2026-07-28' },
    );
  });
});

describe('rowAhead', () => {
  const today = '2026-07-28';
  const still = { day: today };

  it('marks a row dated after today, and nothing on or before it', () => {
    expect(rowAhead('2026-07-29', still, today)).toEqual({ wide: 'in', narrow: 'in', open: true });
    expect(rowAhead('2026-07-28', still, today)).toEqual({
      wide: undefined,
      narrow: undefined,
      open: false,
    });
    expect(rowAhead('2026-07-27', still, today)).toEqual({
      wide: undefined,
      narrow: undefined,
      open: false,
    });
  });

  it('fades the chip of a row whose day has come, and folds its line', () => {
    const stepped = { day: '2026-07-29', fadeFrom: '2026-07-28' };
    expect(rowAhead('2026-07-29', stepped, '2026-07-29')).toEqual({
      wide: 'out',
      narrow: 'out',
      open: false,
    });
    expect(rowAhead('2026-07-30', stepped, '2026-07-29')).toEqual({
      wide: 'in',
      narrow: 'in',
      open: true,
    });
    expect(rowAhead('2026-07-28', stepped, '2026-07-29').narrow).toBeUndefined();
  });

  it('holds the empty line open under a pointer once the chip is gone', () => {
    const held = { day: '2026-07-29', holdFrom: '2026-07-28' };
    expect(rowAhead('2026-07-29', held, '2026-07-29')).toEqual({
      wide: undefined,
      narrow: undefined,
      open: true,
    });
  });

  it('shows a set-back chip on line 1 at once, and holds only the narrow line', () => {
    const deferred = { day: '2026-07-29' };
    expect(rowAhead('2026-07-29', deferred, '2026-07-28')).toEqual({
      wide: 'in',
      narrow: undefined,
      open: false,
    });
  });

  it('marks exactly the rows the figures leave out', () => {
    const row = (date: string): Transaction => ({
      id: date,
      date,
      type: 'deposit',
      assetId: '',
      amount: 1000,
    });
    const transactions = ['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-08-01'].map(
      row,
    );
    const counted = new Set(
      ledgerAsOf({ assets: [], snapshots: [], transactions, today }).transactions.map((t) => t.id),
    );
    for (const tx of transactions) {
      const mark = rowAhead(tx.date, still, today);
      expect(mark.narrow === 'in', tx.date).toBe(!counted.has(tx.id));
      expect(mark.wide === 'in', tx.date).toBe(!counted.has(tx.id));
    }
  });
});

describe('useRowsAhead', () => {
  const ahead = '2026-07-29';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 23, 59, 30)); // local 28.07, half a minute to midnight
    prefersReducedMotion(false);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const read = (r: { current: ReturnType<typeof useRowsAhead> }) =>
    rowAhead(ahead, r.current.mark, r.current.today);

  it('drops the mark when the day comes, without a reload, and unmounts the chip on a timer', () => {
    const { result } = renderHook(useRowsAhead);
    expect(read(result)).toEqual({ wide: 'in', narrow: 'in', open: true });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.today).toBe('2026-07-29');
    // The weight returns in this render: no cue still says the row is ahead.
    expect(read(result)).toEqual({ wide: 'out', narrow: 'out', open: false });

    act(() => {
      vi.advanceTimersByTime(CHIP_EXIT_MS - 1);
    });
    expect(read(result).narrow).toBe('out');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(read(result)).toEqual({ wide: undefined, narrow: undefined, open: false });
  });

  it('unmounts the chip at once under prefers-reduced-motion', () => {
    prefersReducedMotion(true);
    const { result } = renderHook(useRowsAhead);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(read(result)).toEqual({ wide: undefined, narrow: undefined, open: false });
  });

  it('holds the line open while a pointer is over the list, and folds it when it leaves', () => {
    const { result } = renderHook(useRowsAhead);
    act(() => {
      result.current.enter(mouse);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(read(result)).toEqual({ wide: 'out', narrow: 'out', open: true });
    // The fade's timer starts with the render the step causes, so it runs in an act of its own.
    act(() => {
      vi.advanceTimersByTime(CHIP_EXIT_MS);
    });
    expect(read(result)).toEqual({ wide: undefined, narrow: undefined, open: true });

    act(() => {
      result.current.leave();
    });
    expect(read(result).open).toBe(false);
  });

  it('ignores a touch pointer: with no hover, the line folds at once', () => {
    const { result } = renderHook(useRowsAhead);
    act(() => {
      result.current.enter(touch);
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(read(result).open).toBe(false);
  });

  it('brings a set-back chip, line and weight back together once no pointer is over the list', () => {
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0));
    const { result } = renderHook(useRowsAhead);
    expect(read(result).narrow).toBeUndefined();

    act(() => {
      result.current.enter(mouse);
      vi.setSystemTime(new Date(2026, 6, 28, 12, 0, 0));
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.today).toBe('2026-07-28');
    expect(read(result)).toEqual({ wide: 'in', narrow: undefined, open: false });

    act(() => {
      result.current.leave();
    });
    expect(read(result)).toEqual({ wide: 'in', narrow: 'in', open: true });
  });

  it('leaves no timer behind when it unmounts mid-fade', () => {
    const { unmount } = renderHook(useRowsAhead);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles the same under StrictMode', () => {
    const { result } = renderHook(useRowsAhead, { reactStrictMode: true });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(read(result)).toEqual({ wide: 'out', narrow: 'out', open: false });
    act(() => {
      vi.advanceTimersByTime(CHIP_EXIT_MS);
    });
    expect(read(result).narrow).toBeUndefined();
  });
});
