import { describe, expect, it } from 'vitest';

import { backupAgeHours, NO_BACKUP_HOURS } from './backup-age';

// The rule two stacks share: recovery points in, an AGE in hours out. Both freshness
// checks read it — `capture.ts` and `backup-freshness.ts` — so it is tested once here
// rather than twice against copies that can disagree about what "backed up" means.

const NOW = new Date('2026-09-15T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('backupAgeHours', () => {
  it('measures from the NEWEST completed point', () => {
    const { value, completedAt } = backupAgeHours(
      [
        { Status: 'COMPLETED', CompletionDate: at('2026-09-13T12:00:00Z') },
        { Status: 'COMPLETED', CompletionDate: at('2026-09-15T02:00:00Z') },
        { Status: 'COMPLETED', CompletionDate: at('2026-09-14T02:00:00Z') },
      ],
      NOW,
    );
    expect(value).toBe(10);
    expect(completedAt).toBe('2026-09-15T02:00:00.000Z');
  });

  // A job still running, or one that finished with part of the resource missing, is
  // not something anything can be restored from, and its NEWER timestamp is what makes
  // it win if the status is not read.
  it('ignores a NEWER point that did not complete', () => {
    const { value, completedAt } = backupAgeHours(
      [
        { Status: 'COMPLETED', CompletionDate: at('2026-09-14T12:00:00Z') },
        { Status: 'CREATING', CompletionDate: at('2026-09-15T11:00:00Z') },
        { Status: 'PARTIAL', CompletionDate: at('2026-09-15T11:30:00Z') },
      ],
      NOW,
    );
    expect(value).toBe(24);
    expect(completedAt).toBe('2026-09-14T12:00:00.000Z');
  });

  // `CompletionDate` is optional on the API's own shape, and treating an absent one
  // as the epoch — or as now — is a wrong answer rather than no answer.
  it('ignores a completed point with no completion date', () => {
    expect(backupAgeHours([{ Status: 'COMPLETED' }], NOW)).toEqual({
      value: NO_BACKUP_HOURS,
      completedAt: null,
    });
  });

  it('reports NO_BACKUP_HOURS for an empty vault', () => {
    expect(backupAgeHours([], NOW)).toEqual({ value: NO_BACKUP_HOURS, completedAt: null });
  });

  // Why it is large and not zero is on `NO_BACKUP_HOURS` itself. The thresholds are
  // held against this value in `stack-split.test.ts`, where the templates are parsed.
  it('puts the absence of a backup at the bad end of the scale', () => {
    const { value } = backupAgeHours([], NOW);
    const fresh = backupAgeHours(
      [{ Status: 'COMPLETED', CompletionDate: at('2026-09-15T11:00:00Z') }],
      NOW,
    ).value;
    expect(value).toBeGreaterThan(fresh);
  });

  it('rounds to whole hours', () => {
    expect(
      backupAgeHours([{ Status: 'COMPLETED', CompletionDate: at('2026-09-15T09:10:00Z') }], NOW)
        .value,
    ).toBe(3);
  });
});
