import { beforeEach, describe, expect, it } from 'vitest';

import { quotesUnsaved, useDraft } from './draft';
import { groupedForInput, inputValue, valueFromInput } from '@quirenote/core/money';
import { SEED_ASSETS } from '@quirenote/core/seed';

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
    // origin on purpose — typing claims the row — and `fillQuote` always
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

  // The baseline is one day's: another day starts with none, until `/` reads that day.
  it('drops the day it compares against on a date change', () => {
    useDraft.getState().setBaseline({ recorded: { reit: 68702.1 }, ids: ['reit'] });
    useDraft.getState().setDate('2026-09-12');
    expect(useDraft.getState().baseline).toEqual({ recorded: {}, ids: [] });
  });
});

describe('quotesUnsaved — a draft that differs from what the day records', () => {
  const ids = SEED_ASSETS.map((a) => a.id);
  const recorded = { reit: 68629.36, energy: 60086.09 };

  it('is nothing for an untouched draft, and for one equal to the day, however written', () => {
    expect(quotesUnsaved({}, ids, recorded, 'uk')).toBe(false);
    expect(quotesUnsaved({ reit: '68 629,36', energy: '60086,090' }, ids, recorded, 'uk')).toBe(
      false,
    );
  });

  it('is unsaved for a changed quote, and for a quote the day does not record', () => {
    expect(quotesUnsaved({ reit: '68 629,37' }, ids, recorded, 'uk')).toBe(true);
    expect(quotesUnsaved({ ovdp8976: '1000' }, ids, recorded, 'uk')).toBe(true);
  });

  // The save would clear it, or refuse the row.
  it('is unsaved for a recorded quote blanked, and for a draft it cannot read', () => {
    expect(quotesUnsaved({ reit: '' }, ids, recorded, 'uk')).toBe(true);
    expect(quotesUnsaved({ reit: '12abc' }, ids, recorded, 'uk')).toBe(true);
  });

  // The prefill writes the day's quote at two decimals, so that is the grain a change is read at.
  it('is nothing for a prefilled row whose recorded quote has a third decimal', () => {
    expect(quotesUnsaved({ reit: '1.01' }, ids, { reit: 1.005 }, 'en')).toBe(false);
    expect(quotesUnsaved({ reit: '1.00' }, ids, { reit: 1.005 }, 'en')).toBe(true);
  });

  it('is nothing for a blank row the day does not record either', () => {
    expect(quotesUnsaved({ ovdp8976: '  ' }, ids, recorded, 'uk')).toBe(false);
  });

  // The screen reads only the assets it shows; a row kept for another is not one it could save.
  it('is nothing for a row of an asset it does not show', () => {
    expect(quotesUnsaved({ gone: '1000' }, ids, recorded, 'uk')).toBe(false);
  });
});
