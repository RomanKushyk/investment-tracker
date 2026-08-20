import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `/transactions` is two columns, and the number that decides when they ARE two
// lives in three places across two files:
//
//   1. the flex bases       — `flex-[1_1_360px]` / `flex-[1_1_560px]` (TransactionPanel.tsx)
//   2. the column gap       — `gap-x-6` = 24            (Transactions.tsx)
//   3. the container query  — `@min-[944px]`            (both files)
//
// `flex-wrap` breaks the line when 360 + 24 + 560 exceeds the container, so the
// wrap point is a CONSEQUENCE of 1 and 2 — while the caps that make the layout
// correct are keyed to 3. They agree today at 944 and nothing made them.
//
// Change the row to `gap-x-8` and the real wrap point becomes 952 while the
// queries still fire at 944: between 944 and 951 the form wraps onto a line of
// its own AND is capped at 360, stranding it beside ~590 px of nothing — which
// is exactly the failure the grow-1-plus-cap design exists to prevent (D77).
// navigation-map.md used to claim the two "cannot disagree"; they can, so this
// is what makes the claim true.
//
// Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative read
// takes the whole suite down the moment vitest is given a different root.
const here = dirname(fileURLToPath(import.meta.url));
const SCREEN = readFileSync(join(here, 'Transactions.tsx'), 'utf8');
const PANEL = readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8');

/** Tailwind's `gap-x-N` is N × 4 px. */
function columnGap(source: string): number {
  const m = source.match(/className="@container[^"]*\bgap-x-(\d+)\b/);
  if (m === null) throw new Error('no `gap-x-N` on the @container row');
  return Number(m[1]) * 4;
}

/** Every `flex-[1_1_<n>px]` basis in source order — form first, ledger second. */
function bases(source: string): number[] {
  return [...source.matchAll(/flex-\[1_1_(\d+)px\]/g)].map((m) => Number(m[1]));
}

/** Every `@min-[<n>px]` threshold used across both files. */
function thresholds(source: string): number[] {
  return [...source.matchAll(/@min-\[(\d+)px\]/g)].map((m) => Number(m[1]));
}

describe('/transactions — the wrap point and the container query are one number', () => {
  it('reads the two bases and the gap the layout actually ships', () => {
    expect(bases(PANEL)).toEqual([360, 560]);
    expect(columnGap(SCREEN)).toBe(24);
  });

  it('pins base + gap + base to the container query, in both files', () => {
    const [form, ledger] = bases(PANEL);
    const wrapPoint = form + columnGap(SCREEN) + ledger;
    expect(wrapPoint).toBe(944);

    const used = new Set([...thresholds(PANEL), ...thresholds(SCREEN)]);
    expect(used.size).toBe(1);
    expect([...used][0]).toBe(wrapPoint);
  });

  it('keeps a width cap at every size, so a wrapped form is never stranded', () => {
    // Below the query both columns cap at the 560 this screen shipped with;
    // above it the form takes 360 and the ledger is bounded by `/`'s own 884.
    expect(PANEL).toContain('max-w-[560px]');
    expect(PANEL).toContain('@min-[944px]:max-w-[360px]');
    expect(PANEL).toContain('@min-[944px]:max-w-[884px]');
    expect(PANEL).not.toContain('max-w-none');
  });

  it('floors the ledger height so a short viewport cannot collapse it to zero', () => {
    // A `max-height` calc that resolves negative is clamped to 0, not ignored.
    expect(PANEL).toMatch(/max-h-\[max\(200px,calc\(100dvh-var\(--ledger-top/);
  });
});
