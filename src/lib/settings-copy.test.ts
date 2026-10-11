// The device's copy of the account's settings (*Persistence today*): every `/view` answer overwrites
// it, a change on the device is written to it at once and sent as `PATCH /settings` after a quiet
// half second, naming only the fields that changed, and a signed-out page keeps it alone.
import { createStore } from 'zustand/vanilla';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_NAMES, SETTINGS_DEFAULTS, type AccountSettings } from '@quirenote/core/settings';
import { SETTINGS_PATCH_DELAY_MS, createSettingsCopy } from './settings-copy';

// What the device holds beside the account's ten: the tab's currency glance and the theme.
type Device = AccountSettings & { currency: 'UAH' | 'USD'; theme: 'light' | 'dark' | 'system' };

/** Every account field away from its default, and from `ACCOUNT` below. */
const COPY: AccountSettings = {
  defaultCurrency: 'USD',
  language: 'en',
  autoQuoteSuggest: false,
  couponSuggest: false,
  remindersEnabled: false,
  reminderLeadDays: 14,
  dismissedReminders: ['quote-missing'],
  collapsedNavGroups: ['entry'],
  sidebarCollapsed: true,
  period: '3m',
};
const ACCOUNT: AccountSettings = {
  defaultCurrency: 'UAH',
  language: 'uk',
  autoQuoteSuggest: true,
  couponSuggest: true,
  remindersEnabled: true,
  reminderLeadDays: 21,
  dismissedReminders: ['coupon-due'],
  collapsedNavGroups: ['analytics'],
  sidebarCollapsed: false,
  period: '12m',
};

function harness(device: Partial<Device> = {}) {
  const store = createStore<Device>()(() => ({
    ...SETTINGS_DEFAULTS,
    dismissedReminders: [],
    collapsedNavGroups: [],
    currency: 'UAH',
    theme: 'system',
    ...device,
  }));
  const state = { fails: false, gate: undefined as Promise<void> | undefined };
  const sent: Partial<AccountSettings>[] = [];
  const patch = vi.fn(async (fields: Partial<AccountSettings>) => {
    sent.push(fields);
    await state.gate;
    if (state.fails) throw new Error('refused');
  });
  const copy = createSettingsCopy({ store, patch });
  const stop = copy.start();
  /** Holds every write until `release` is called. */
  const hold = () => {
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => (release = resolve));
    return () => {
      state.gate = undefined;
      release();
    };
  };
  return { store, state, sent, patch, copy, stop, hold };
}
const quiet = () => vi.advanceTimersByTimeAsync(SETTINGS_PATCH_DELAY_MS);
/** A read of the view answering `settings`, begun by hand so a test can say when it answers. */
function reading(copy: ReturnType<typeof harness>['copy']) {
  let answer!: (settings: AccountSettings) => void;
  const done = copy.read(
    () =>
      new Promise<{ settings: AccountSettings }>(
        (resolve) => (answer = (s) => resolve({ settings: s })),
      ),
  );
  return { answer: (settings: AccountSettings) => (answer(settings), done) };
}
/** The account has answered with what the copy already holds, so a change that follows is the
 *  person's, made on the account's own settings. */
function answered({ store, copy }: Pick<ReturnType<typeof harness>, 'store' | 'copy'>) {
  const held = store.getState();
  const settings = Object.fromEntries(SETTING_NAMES.map((name) => [name, held[name]]));
  return copy.read(async () => ({ settings: settings as unknown as AccountSettings }));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the fixtures differ in every field', () => {
  it('so an overwrite of any one of them shows', () => {
    expect(SETTING_NAMES.filter((name) => COPY[name] === ACCOUNT[name])).toEqual([]);
  });
});

describe('the account answers', () => {
  it('overwrites every account field of the copy, and never the theme', async () => {
    const { store, copy } = harness({ ...COPY, theme: 'dark' });

    await copy.read(async () => ({ settings: ACCOUNT }));

    const held = store.getState();
    expect(Object.fromEntries(SETTING_NAMES.map((name) => [name, held[name]]))).toEqual(ACCOUNT);
    expect(held.theme).toBe('dark');
  });

  it('hands the view back as it was read', async () => {
    const { copy } = harness();
    const view = { settings: ACCOUNT, tag: '"1"' };

    expect(await copy.read(async () => view)).toBe(view);
  });

  it('sends nothing for what it wrote, which is the account already', async () => {
    const { copy, patch } = harness({ ...COPY });

    await copy.read(async () => ({ settings: ACCOUNT }));
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
  });

  it('tells no one when it is the copy already, so a screen does not render again', async () => {
    const { store, copy } = harness({ ...ACCOUNT });
    const heard = vi.fn();
    store.subscribe(heard);

    await copy.read(async () => ({ settings: { ...ACCOUNT, dismissedReminders: ['coupon-due'] } }));

    expect(heard).not.toHaveBeenCalled();
  });

  it('keeps the tab’s currency where its owner put it, unless the default itself moves', async () => {
    const { store, copy } = harness({ defaultCurrency: 'UAH', currency: 'USD' });

    await copy.read(async () => ({ settings: { ...ACCOUNT, defaultCurrency: 'UAH' } }));
    expect(store.getState().currency).toBe('USD');

    await copy.read(async () => ({ settings: { ...ACCOUNT, defaultCurrency: 'USD' } }));
    await copy.read(async () => ({ settings: { ...ACCOUNT, defaultCurrency: 'UAH' } }));
    expect(store.getState()).toMatchObject({ defaultCurrency: 'UAH', currency: 'UAH' });
  });

  it('reads what it is given through the fields’ own rules', async () => {
    const { store, copy } = harness();

    await copy.read(async () => ({
      settings: { ...ACCOUNT, period: 'decade', dismissedReminders: ['a', 7] } as never,
    }));

    expect(store.getState()).toMatchObject({ period: 'all', dismissedReminders: ['a'] });
  });
});

describe('a change on the device', () => {
  it('is sent as one patch naming only the field, however many changes it took', async () => {
    const { store, sent, patch } = harness();

    for (const period of ['1m', '3m', '6m', '12m', 'ytd'] as const) {
      store.setState({ period });
      await vi.advanceTimersByTimeAsync(SETTINGS_PATCH_DELAY_MS - 1);
    }
    expect(patch).not.toHaveBeenCalled();
    await quiet();

    expect(sent).toEqual([{ period: 'ytd' }]);
  });

  it('is in the copy at once, and sent only once the half second has passed', async () => {
    const { store, patch } = harness();

    store.setState({ language: 'en' });
    expect(store.getState().language).toBe('en');
    await vi.advanceTimersByTimeAsync(SETTINGS_PATCH_DELAY_MS - 1);
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('names every field that changed in the run and no other', async () => {
    const { store, sent, copy } = harness();
    await answered({ store, copy });

    store.setState({ language: 'en' });
    store.setState({ sidebarCollapsed: true });
    store.setState({ collapsedNavGroups: ['entry'] });
    await quiet();

    expect(sent).toEqual([
      { language: 'en', sidebarCollapsed: true, collapsedNavGroups: ['entry'] },
    ]);
  });

  it('sends a list whole', async () => {
    const { store, sent, copy } = harness();
    await answered({ store, copy });

    store.setState({ dismissedReminders: ['a'] });
    store.setState({ dismissedReminders: ['a', 'b'] });
    await quiet();

    expect(sent).toEqual([{ dismissedReminders: ['a', 'b'] }]);
  });

  it('sends nothing for a theme, the tab’s currency, or a field set to what it was', async () => {
    const { store, patch, copy } = harness({ ...COPY });
    await answered({ store, copy });

    store.setState({ theme: 'dark', currency: 'USD', period: '3m' });
    store.setState({ dismissedReminders: ['quote-missing'] });
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
  });

  it('is sent one write at a time, and the next change after the answer to the last', async () => {
    const { store, sent, patch, hold } = harness();
    const release = hold();

    store.setState({ period: '3m' });
    await quiet();
    store.setState({ language: 'en' });
    await quiet();
    expect(patch).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual([{ period: '3m' }, { language: 'en' }]);
  });

  it('is kept in the copy when the write fails, and the next answer restores the account’s', async () => {
    const { store, state, patch, copy } = harness();
    state.fails = true;

    store.setState({ period: '3m' });
    await quiet();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.getState().period).toBe('3m');
    await copy.read(async () => ({ settings: { ...ACCOUNT, period: 'all' } }));

    expect(store.getState().period).toBe('all');
  });

  it('is not sent once the copy has stopped listening', async () => {
    const { store, patch, stop } = harness();

    store.setState({ period: '3m' });
    stop();
    store.setState({ language: 'en' });
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
  });
});

describe('an answer and a change that meet', () => {
  it('leaves a change made while the read was in flight, and takes the rest', async () => {
    const { store, copy } = harness({ ...COPY });
    const read = reading(copy);

    store.setState({ period: '6m' });
    await read.answer(ACCOUNT);

    expect(store.getState()).toMatchObject({
      period: '6m',
      language: 'uk',
      sidebarCollapsed: false,
    });
  });

  it('leaves a change waiting to be sent when a read begun after it answers', async () => {
    const { store, copy } = harness({ ...COPY });
    store.setState({ period: '6m' });
    const read = reading(copy);

    await read.answer(ACCOUNT);

    expect(store.getState()).toMatchObject({ period: '6m', language: 'uk' });
  });

  it('leaves a change whose write is in flight when the read answers', async () => {
    const { store, copy, hold } = harness({ ...COPY });
    const release = hold();
    store.setState({ period: '6m' });
    await quiet();

    await copy.read(async () => ({ settings: ACCOUNT }));

    expect(store.getState().period).toBe('6m');
    release();
  });

  it('leaves a change whose write was answered while a read begun before it was in flight', async () => {
    const { store, copy, patch } = harness({ ...COPY });
    const read = reading(copy);

    store.setState({ period: '6m' });
    await quiet();
    expect(patch).toHaveBeenCalledTimes(1);
    await read.answer(ACCOUNT);

    expect(store.getState().period).toBe('6m');
  });

  it('leaves a change whose write was answered while a read begun during it was in flight', async () => {
    const { store, copy, hold } = harness({ ...COPY });
    const release = hold();
    store.setState({ period: '6m' });
    await quiet();
    const read = reading(copy);

    release();
    await vi.advanceTimersByTimeAsync(0);
    await read.answer(ACCOUNT);

    expect(store.getState().period).toBe('6m');
  });

  it('is overwritten by a read begun after the write was answered, which is the account’s now', async () => {
    const { store, copy } = harness({ ...COPY });
    store.setState({ period: '6m' });
    await quiet();

    await copy.read(async () => ({ settings: ACCOUNT }));

    expect(store.getState().period).toBe('12m');
  });
});

describe('a list changed before the account has answered', () => {
  it('is not sent, and the answer puts the account’s list back', async () => {
    const { store, copy, patch } = harness({ ...COPY });

    store.setState({ collapsedNavGroups: ['entry', 'analytics'] });
    await copy.read(async () => ({ settings: ACCOUNT }));
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
    expect(store.getState().collapsedNavGroups).toEqual(ACCOUNT.collapsedNavGroups);
  });

  it('is not sent when it is changed while the first read is in flight', async () => {
    const { store, copy, patch } = harness({ ...COPY });
    const read = reading(copy);

    store.setState({ dismissedReminders: [] });
    await read.answer(ACCOUNT);
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
    expect(store.getState().dismissedReminders).toEqual(ACCOUNT.dismissedReminders);
  });

  it('is sent once the account has answered, though the answer left the copy as it was', async () => {
    const { store, copy, sent } = harness({ ...ACCOUNT });

    await copy.read(async () => ({ settings: ACCOUNT }));
    store.setState({ collapsedNavGroups: ['entry'] });
    await quiet();

    expect(sent).toEqual([{ collapsedNavGroups: ['entry'] }]);
  });

  it('is not sent after the account has changed, until the next account has answered', async () => {
    const { store, copy, patch } = harness({ ...COPY });
    await copy.read(async () => ({ settings: ACCOUNT }));

    copy.forget();
    store.setState({ collapsedNavGroups: ['entry'] });
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
  });

  it('holds back the list and sends the other fields of the run', async () => {
    const { store, sent } = harness({ ...COPY });

    store.setState({ period: '6m', collapsedNavGroups: ['entry', 'analytics'] });
    await quiet();

    expect(sent).toEqual([{ period: '6m' }]);
  });
});

describe('the account ends', () => {
  it('sends no change the last account was waiting to send', async () => {
    const { store, copy, patch } = harness();

    store.setState({ period: '3m' });
    copy.forget();
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patch).not.toHaveBeenCalled();
  });

  it('puts nothing on the copy from a read the last account began', async () => {
    const { store, copy } = harness({ ...COPY });
    const read = reading(copy);

    copy.forget();
    await read.answer(ACCOUNT);

    expect(store.getState()).toMatchObject(COPY);
  });

  it('leaves the copy as it is, for the next account’s first answer to overwrite', async () => {
    const { store, copy } = harness({ ...COPY });

    copy.forget();
    expect(store.getState()).toMatchObject(COPY);
    await copy.read(async () => ({ settings: SETTINGS_DEFAULTS }));

    expect(store.getState()).toMatchObject(SETTINGS_DEFAULTS);
  });

  it('is not held against the next account by a write of the last still in flight', async () => {
    const { store, copy, hold } = harness({ ...COPY });
    const release = hold();
    store.setState({ period: '6m' });
    await quiet();

    copy.forget();
    await copy.read(async () => ({ settings: ACCOUNT }));

    expect(store.getState().period).toBe('12m');
    release();
  });

  it('is not held against the next account by a write of the last answered during its read', async () => {
    const { store, copy, hold } = harness({ ...COPY });
    const release = hold();
    store.setState({ period: '6m' });
    await quiet();

    copy.forget();
    const read = reading(copy);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await read.answer(ACCOUNT);

    expect(store.getState().period).toBe('12m');
  });

  it('is not sent to the next account by a change that was waiting on the last’s write', async () => {
    const { store, copy, sent, hold } = harness();
    const release = hold();
    store.setState({ period: '6m' });
    await quiet();
    store.setState({ language: 'en' });

    copy.forget();
    release();
    await vi.advanceTimersByTimeAsync(0);
    store.setState({ sidebarCollapsed: true });
    await quiet();

    expect(sent).toEqual([{ period: '6m' }, { sidebarCollapsed: true }]);
  });
});
