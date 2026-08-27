import { describe, expect, it } from 'vitest';
import { FACTS } from './facts';
import { derived, measured, renderFact } from './registry';

describe('the registry', () => {
  it('renders a derived fact from its function', () => {
    expect(renderFact(derived(() => 53))).toBe('53');
  });

  it('renders a measured fact as value and unit', () => {
    const f = measured({
      value: 0.25594,
      unit: 'DPU',
      at: '2026-08-26',
      method: 'EXPLAIN (ANALYZE, VERBOSE), warm, order alternated',
      samples: 8,
      reproduce: 'infra/scripts/replan.mjs',
    });
    expect(renderFact(f)).toBe('0.25594 DPU');
  });

  it('refuses samples below one — the type says `number`, which allows zero', () => {
    expect(() =>
      measured({
        value: 1,
        unit: 'DPU',
        at: '2026-08-26',
        method: 'x',
        samples: 0,
        reproduce: 'y',
      }),
    ).toThrow(/samples/);
  });

  it('refuses a date that is not ISO', () => {
    const bad = {
      value: 1,
      unit: 'DPU',
      at: '26 Aug 2026',
      method: 'x',
      samples: 1,
      reproduce: 'y',
    };
    // A bare /at/ also matches the "at" inside "date" — tighten to the
    // backticked field name so a message that never names `at` cannot pass.
    expect(() => measured(bad)).toThrow('measured fact needs an ISO date in `at`, got 26 Aug 2026');
  });

  it('refuses an empty `method` — presence without substance', () => {
    expect(() =>
      measured({
        value: 1,
        unit: 'DPU',
        at: '2026-08-26',
        method: '',
        samples: 1,
        reproduce: 'y',
      }),
    ).toThrow('measured fact needs a non-empty `method`, got ""');
  });

  it('refuses a whitespace-only `reproduce`', () => {
    expect(() =>
      measured({
        value: 1,
        unit: 'DPU',
        at: '2026-08-26',
        method: 'x',
        samples: 1,
        reproduce: '   ',
      }),
    ).toThrow('measured fact needs a non-empty `reproduce`, got "   "');
  });
});

describe('the first facts', () => {
  it('derives the seed counts D5 and D10 pin', () => {
    // 4/174/18 is a pinned contract, not an incidental total — a change here
    // means the seed moved, which D10 says needs a decision, not a green test.
    expect(renderFact(FACTS['seed.assets'])).toBe('4');
    expect(renderFact(FACTS['seed.snapshots'])).toBe('174');
    expect(renderFact(FACTS['seed.transactions'])).toBe('18');
  });

  it('derives the palette size, and a closed-task count that is actually read', () => {
    expect(renderFact(FACTS['app.colorSlots'])).toBe('4');
    // NOT pinned: it rises every time a task closes. What IS pinned is that the
    // ledger is readable — a regex that stopped matching would return 0 quietly.
    expect(Number(renderFact(FACTS['plan.closedTasks']))).toBeGreaterThan(40);
  });
});
