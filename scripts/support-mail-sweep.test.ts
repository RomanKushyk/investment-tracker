import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO } from '../src/repo-root';

// The page's own script, run against a fake Gmail: the owner's mailbox holds personal mail too, so
// it must reach the support label alone and keep /privacy's 12 months (*Legal documents*).
const PAGE = join(REPO, 'docs', 'reference', 'SUPPORT-MAIL-SWEEP.md');
const LABEL = 'quirenote.com/support';
const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

type Thread = {
  id: string;
  first: Date;
  last: Date;
  replyAfterScan?: Date;
  inTrash?: boolean;
  trashed: boolean;
};

function load({ labelExists = true } = {}) {
  const fences = [...readFileSync(PAGE, 'utf8').matchAll(/```js\r?\n([\s\S]*?)```/g)];
  expect(fences, 'the page holds exactly one js fence').toHaveLength(1);
  const threads: Thread[] = [];
  const asked: string[] = [];
  const logs: string[] = [];
  // A thread trashed mid-run leaves the list and shifts the next page; one trashed on an earlier
  // day stays listed. A thread object holds the date it loaded until refresh() reloads it.
  const label = {
    getThreads: (start: number, max: number) =>
      threads
        .filter((t) => !t.trashed)
        .slice(start, start + max)
        .map((t) => {
          let loaded = t.last;
          const view = {
            getId: () => t.id,
            getMessages: () => [{ getDate: () => t.first }],
            getLastMessageDate: () => loaded,
            isInTrash: () => t.inTrash === true,
            refresh: () => {
              loaded = t.replyAfterScan ?? t.last;
              return view;
            },
            moveToTrash: () => {
              t.trashed = true;
            },
          };
          return view;
        }),
  };
  const GmailApp = {
    getUserLabelByName: (name: string) => {
      asked.push(name);
      return labelExists && name === LABEL ? label : null;
    },
  };
  const Logger = { log: (line: unknown) => logs.push(String(line)) };
  const run = new Function(
    'GmailApp',
    'Logger',
    `${fences[0][1]}\nreturn { sweep, dryRun, run_, MAX_AGE_DAYS };`,
  ) as (
    g: typeof GmailApp,
    l: typeof Logger,
  ) => {
    sweep: () => void;
    dryRun: () => void;
    run_: (trash?: unknown) => void;
    MAX_AGE_DAYS: number;
  };
  const thread = (id: string, daysOld: number, more: Partial<Thread> = {}) =>
    threads.push({
      id,
      first: ago(daysOld),
      last: ago(daysOld),
      trashed: false,
      ...more,
    });
  return { ...run(GmailApp, Logger), threads, asked, logs, thread };
}

describe('the support mail sweep on docs/reference/SUPPORT-MAIL-SWEEP.md', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the support label alone, by its exact name', () => {
    const sweep = load();
    sweep.thread('old', 400);
    sweep.sweep();
    expect(sweep.asked).toEqual([LABEL]);
  });

  // A renamed label would otherwise sweep nothing with no failure email.
  it('fails, trashing nothing, when the label is gone', () => {
    const sweep = load({ labelExists: false });
    expect(() => sweep.sweep()).toThrow(`No label named ${LABEL}`);
  });

  it('keeps 12 months: 330 days, a day to the next run and the Trash’s 30', () => {
    // The page's 361 days and its four-day margin, from the fence's own figure.
    const worst = load().MAX_AGE_DAYS + 1 + 30;
    expect(worst).toBe(361);
    expect(365 - worst).toBe(4);
  });

  it('skips a thread already in the Trash', () => {
    const sweep = load();
    sweep.thread('binned', 400, { inTrash: true });
    sweep.dryRun();
    expect(sweep.logs.join('\n')).not.toContain('binned');
  });

  it('trashes a thread whose last message is over 330 days old, and keeps one at 330', () => {
    const sweep = load();
    sweep.thread('over', 331);
    sweep.thread('at', 330);
    sweep.thread('young', 10);
    sweep.sweep();
    expect(sweep.threads.filter((t) => t.trashed).map((t) => t.id)).toEqual(['over']);
  });

  it('dates a thread by its last message, so a recent reply keeps it', () => {
    const sweep = load();
    sweep.thread('replied', 5, { first: ago(400) });
    sweep.sweep();
    expect(sweep.threads[0].trashed).toBe(false);
  });

  it('keeps a thread a reply reached between the scan and the trash', () => {
    const sweep = load();
    sweep.thread('late-reply', 400, { replyAfterScan: ago(0) });
    sweep.sweep();
    expect(sweep.threads[0].trashed).toBe(false);
  });

  it('trashes nothing on a dry run, and logs what it would trash', () => {
    const sweep = load();
    sweep.thread('over', 331);
    sweep.thread('young', 10);
    sweep.dryRun();
    expect(sweep.threads.some((t) => t.trashed)).toBe(false);
    expect(sweep.logs.join('\n')).toContain('over');
    expect(sweep.logs.join('\n')).not.toContain('young');
  });

  // A trigger wired to the helper directly would pass its event object, which is truthy.
  it('trashes on true alone', () => {
    const sweep = load();
    sweep.thread('over', 331);
    sweep.run_();
    sweep.run_({ triggerUid: '1' });
    expect(sweep.threads.some((t) => t.trashed)).toBe(false);
  });

  it('collects every page before it trashes, so a moved thread shifts no page', () => {
    const sweep = load();
    for (let i = 0; i < 250; i++) sweep.thread(`t${i}`, 400);
    sweep.sweep();
    expect(sweep.threads.filter((t) => !t.trashed)).toEqual([]);
  });
});
