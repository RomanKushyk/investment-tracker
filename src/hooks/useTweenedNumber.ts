// Numeric tween for headline figures (D7 motion): sidebar Total capital +
// Overview's 4 KPIs animate their digits over ~300ms whenever the underlying
// number changes (currency toggle, new data). Pure step math is exported
// separately so it's unit-testable without touching rAF/DOM (D4 — vitest
// covers pure logic only; the rAF wiring itself is browser-verified).
import { useEffect, useRef, useState } from 'react';

const DURATION = 300;

// Elapsed ms -> eased progress 0..1. Ease-out cubic: fast start, soft landing
// — matches the app's --ease-soft deceleration character.
export function easeProgress(elapsedMs: number, duration = DURATION): number {
  const t = Math.min(1, Math.max(0, elapsedMs / duration));
  return 1 - Math.pow(1 - t, 3);
}

export function tweenValue(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

// A tween in flight: interpolates from `from` to `to`, timed from `startedAt`
// (a performance.now() timestamp). Kept as plain data (not refs/closures) so
// retargeting can be unit-tested without touching rAF/DOM.
export interface TweenState {
  from: number;
  to: number;
  startedAt: number;
}

// The value a tween shows on screen at a given moment.
export function tweenDisplayValue(state: TweenState, now: number, duration = DURATION): number {
  return tweenValue(state.from, state.to, easeProgress(now - state.startedAt, duration));
}

// Redirects a (possibly in-flight) tween toward a new target. Continues from
// wherever the tween is currently displayed at `now`, so an interrupted tween
// never snaps backward to its original `from`.
export function retargetTween(state: TweenState, to: number, now: number, duration = DURATION): TweenState {
  return { from: tweenDisplayValue(state, now, duration), to, startedAt: now };
}

// Animates `value` over ~300ms via requestAnimationFrame; snaps instantly
// when prefers-reduced-motion is set (D7 kill-switch).
export function useTweenedNumber(value: number, duration = DURATION): number {
  const [display, setDisplay] = useState(value);
  const stateRef = useRef<TweenState>({ from: value, to: value, startedAt: 0 });

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const now = performance.now();

    if (reduceMotion || stateRef.current.to === value) {
      stateRef.current = { from: value, to: value, startedAt: now };
      setDisplay(value);
      return;
    }

    stateRef.current = retargetTween(stateRef.current, value, now, duration);

    let raf = requestAnimationFrame(function tick(tickNow: number) {
      const progress = easeProgress(tickNow - stateRef.current.startedAt, duration);
      setDisplay(tweenDisplayValue(stateRef.current, tickNow, duration));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}
