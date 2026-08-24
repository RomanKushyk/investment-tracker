import { describe, expect, it } from 'vitest';

import {
  easeProgress,
  retargetTween,
  tweenDisplayValue,
  tweenValue,
  type TweenState,
} from './useTweenedNumber';

describe('easeProgress', () => {
  it('starts at 0 and ends at 1 across the full duration', () => {
    expect(easeProgress(0, 300)).toBe(0);
    expect(easeProgress(300, 300)).toBe(1);
  });

  it('clamps outside the [0, duration] range', () => {
    expect(easeProgress(-50, 300)).toBe(0);
    expect(easeProgress(1000, 300)).toBe(1);
  });

  it('eases out — decelerates, so it is already past the halfway point at 50% elapsed', () => {
    const halfway = easeProgress(150, 300);
    expect(halfway).toBeGreaterThan(0.5);
    expect(halfway).toBeLessThan(1);
  });

  it('is monotonically increasing over time', () => {
    const a = easeProgress(50, 300);
    const b = easeProgress(150, 300);
    const c = easeProgress(250, 300);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe('tweenValue', () => {
  it('returns the start value at progress 0 and the end value at progress 1', () => {
    expect(tweenValue(100, 200, 0)).toBe(100);
    expect(tweenValue(100, 200, 1)).toBe(200);
  });

  it('interpolates linearly for a given progress', () => {
    expect(tweenValue(0, 100, 0.5)).toBe(50);
    expect(tweenValue(149016, 3324, 0.5)).toBeCloseTo((149016 + 3324) / 2);
  });

  it('handles a decreasing from -> to just as well as increasing', () => {
    expect(tweenValue(200, 100, 0.25)).toBe(175);
  });
});

describe('retargetTween', () => {
  // Reproduces the mid-tween retargeting bug: interrupting an in-flight tween
  // (e.g. double-tapping the currency toggle) must continue from wherever the
  // number is currently displayed, not snap backward to the old tween's origin.
  it("continues from the currently-displayed value, not the interrupted tween's original origin", () => {
    const inFlight: TweenState = { from: 0, to: 100, startedAt: 0 };
    const interruptAt = 50; // mid-flight (duration 300ms) — well past 0% progress

    const displayedWhenInterrupted = tweenDisplayValue(inFlight, interruptAt);
    expect(displayedWhenInterrupted).toBeGreaterThan(0);

    const retargeted = retargetTween(inFlight, 30, interruptAt);

    // The new tween's `from` must be where the old one visually was...
    expect(retargeted.from).toBeCloseTo(displayedWhenInterrupted);
    // ...not the old tween's original starting value (that would be the snap-back bug).
    expect(retargeted.from).not.toBe(inFlight.from);
  });

  it('produces no visual jump at the instant of retargeting', () => {
    const inFlight: TweenState = { from: 0, to: 100, startedAt: 0 };
    const interruptAt = 50;

    const displayedJustBefore = tweenDisplayValue(inFlight, interruptAt);
    const retargeted = retargetTween(inFlight, 30, interruptAt);
    const displayedJustAfter = tweenDisplayValue(retargeted, interruptAt);

    expect(displayedJustAfter).toBeCloseTo(displayedJustBefore);
  });

  it('a tween that already reached its target retargets from that target (no-op continuity)', () => {
    const settled: TweenState = { from: 100, to: 100, startedAt: 0 };
    const retargeted = retargetTween(settled, 50, 1000);
    expect(retargeted.from).toBe(100);
  });
});
