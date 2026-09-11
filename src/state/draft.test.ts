import { beforeEach, describe, expect, it } from 'vitest';

import { useDraft } from './draft';
import { groupedForInput, inputValue, valueFromInput } from '../core/money';

// The first tests for this store, and they exist for one question: whether a
// language switch has to rewrite what it holds. It does not — the strings are
// language-free since the shared field landed — and these pin the two reasons
// that matters, because getting it wrong is invisible.
//
// `persist` is inert here because node exposes no localStorage without
// `--localstorage-file` (the run says so), so zustand's accessor comes back
// undefined. Give the runner that flag — or take a Node that stabilises it — and
// persistence goes live, `PRISTINE` is captured before any rehydrate, and these
// tests start leaking into anything else that touches this store.
describe('the quote draft store', () => {
  // Through the store's OWN reset, not a snapshot of it: `setDate` is what
  // clears a day's drafts, so whatever a later field needs doing on that path
  // gets done here too — and nothing depends on state captured at module load,
  // which `persist` could rehydrate over.
  beforeEach(() => useDraft.getState().setDate(''));

  it('holds no language, so nothing has to be rewritten when one changes', () => {
    // What `NumberField` stores, whichever language typed it. Both readings of
    // the same text agree, which is the whole reason no reformat action exists.
    const stored = valueFromInput('1 234,56', '', 'uk', false);
    expect(stored).toBe('1234.56');
    expect(valueFromInput('1,234.56', '', 'en', false)).toBe(stored);
    useDraft.getState().setQuote('reit', stored);
    expect(useDraft.getState().quotes.reit).toBe('1234.56');
    // And the display is derived, so the switch is a re-render and no more.
    expect(groupedForInput(useDraft.getState().quotes.reit, 'uk')).toBe('1 234,56');
    expect(groupedForInput(useDraft.getState().quotes.reit, 'en')).toBe('1,234.56');
  });

  it('keeps provenance exactly where the two writers put it', () => {
    // The hazard a reformat action would have walked into: `setQuote` DROPS the
    // origin on purpose — typing claims the row for G5 — and `fillQuote` always
    // writes one. Rewriting a machine row through the first would relabel it as
    // the user's; rewriting a user row through the second would do the inverse.
    // Neither is reachable while the stored string carries no language.
    const at = '2026-09-11T10:00:00.000Z';
    useDraft.getState().fillQuote('reit', inputValue(68702.1, 2), { source: 'fetch', at });
    useDraft.getState().setQuote('energy', inputValue(60086.09, 2));
    const after = useDraft.getState();
    expect(after.quotes).toEqual({ reit: '68702.10', energy: '60086.09' });
    expect(after.origins).toEqual({ reit: { source: 'fetch', at } });
    expect(after.origins.energy).toBeUndefined();
  });

  it('drops a machine origin the moment the user types over that row', () => {
    const at = '2026-09-11T10:00:00.000Z';
    useDraft.getState().fillQuote('reit', '68702.10', { source: 'fetch', at });
    useDraft.getState().setQuote('reit', '68702.50');
    expect(useDraft.getState().origins.reit).toBeUndefined();
    expect(useDraft.getState().quotes.reit).toBe('68702.50');
  });

  it('clears both maps together, on a date change and on clear()', () => {
    const at = '2026-09-11T10:00:00.000Z';
    useDraft.getState().fillQuote('reit', '68702.10', { source: 'cache', at });
    useDraft.getState().setDate('2026-09-12');
    expect(useDraft.getState()).toMatchObject({ date: '2026-09-12', quotes: {}, origins: {} });

    useDraft.getState().fillQuote('reit', '68702.10', { source: 'cache', at });
    useDraft.getState().clear();
    expect(useDraft.getState().quotes).toEqual({});
    expect(useDraft.getState().origins).toEqual({});
    // `clear` leaves the date alone — the screen stays on the day it was showing.
    expect(useDraft.getState().date).toBe('2026-09-12');
  });
});
