// The device's copy of the account's settings (*Persistence today*). A paint comes before the
// account's answer, so the store holds a copy: every `/view` answer overwrites it, a change on the
// device is written to it at once and sent as `PATCH /settings` after a quiet half second. A
// signed-out page has no token to send under, so there the copy is all there is.
import { SETTING_NAMES, sanitiseSettings, type AccountSettings } from '@quirenote/core/settings';

/** The half second in which the route's two requests per second refill one token (*Auth model*),
 *  quiet before a run of changes is sent as one patch: the run cannot send faster than the route
 *  takes. A change can be lost when the tab closes before its write is answered: while it waits
 *  here, or behind an earlier write still on the wire. */
export const SETTINGS_PATCH_DELAY_MS = 500;

/** The store, as far as the copy reads and writes it: the account's ten fields, and the tab's
 *  currency, which follows the default when the default moves. */
type Held = AccountSettings & { currency: AccountSettings['defaultCurrency'] };
export interface CopyStore {
  getState(): Held;
  setState(partial: Partial<Held>): void;
  subscribe(listener: (state: Held, previous: Held) => void): () => void;
}

export interface SettingsCopyDeps {
  store: CopyStore;
  /** Merges the fields into the account's settings. Rejects when it could not. */
  patch: (fields: Partial<AccountSettings>) => Promise<unknown>;
}

export interface SettingsCopy {
  /** Runs a read of the view, and puts the settings it answers on the copy. */
  read<V extends { settings: AccountSettings }>(load: () => Promise<V>): Promise<V>;
  /** Starts sending the copy's changes; the result stops it and drops what it had not sent. */
  start(): () => void;
  /** The account has changed: what was waiting to be sent, or on the wire, was the last one's. The
   *  copy stays, and the next account's first answer overwrites it. */
  forget(): void;
}

const same = (a: unknown, b: unknown) =>
  a === b ||
  (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));

export function createSettingsCopy({ store, patch }: SettingsCopyDeps): SettingsCopy {
  /** Changed since the last write was sent. */
  let unsent: Partial<AccountSettings> = {};
  /** The write on the wire: one at a time, so a field changed twice reaches the account in order. */
  let sending: Partial<AccountSettings> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** True while the copy writes the account's answer, which is not a change to send back. */
  let applying = false;
  /** How many times the account has changed. */
  let accounts = 0;
  /** Whether the account has answered since it last changed. Before that a list on the copy may be
   *  the last account's, and a list changed on it is not sent. */
  let answered = false;
  // A CLOCK THAT MOVES AT THE ANSWER TO EVERY WRITE OF THE ACCOUNT THAT SENT IT. A field is the
  // device's, not the account's, from its change until its write is answered, and so for a read begun
  // before then: that read may have been answered before the write landed.
  let clock = 0;
  const touched = new Map<keyof AccountSettings, number>();

  const namesOf = (fields: Partial<AccountSettings>) =>
    Object.keys(fields) as (keyof AccountSettings)[];
  const owned = (name: keyof AccountSettings, begun: number) =>
    Object.hasOwn(unsent, name) ||
    (sending !== undefined && Object.hasOwn(sending, name)) ||
    (touched.get(name) ?? 0) > begun;

  const drop = () => {
    clearTimeout(timer);
    timer = undefined;
    unsent = {};
  };

  async function send(): Promise<void> {
    timer = undefined;
    // A write on the wire sends what waited, once it is answered.
    if (sending !== undefined || namesOf(unsent).length === 0) return;
    const at = accounts;
    const fields = unsent;
    sending = fields;
    unsent = {};
    try {
      await patch(fields);
    } catch {
      // The copy stays, and the next answer of the view says what the account holds.
    }
    if (accounts !== at) return;
    sending = undefined;
    clock += 1;
    for (const name of namesOf(fields)) touched.set(name, clock);
    if (namesOf(unsent).length > 0 && timer === undefined) void send();
  }

  function answer(settings: AccountSettings, begun: number): void {
    answered = true;
    // Through the fields' own rules: a value this build does not know is not painted.
    const account = sanitiseSettings(settings);
    const held = store.getState();
    const next: Partial<Held> = {};
    for (const name of SETTING_NAMES) {
      if (!owned(name, begun) && !same(held[name], account[name])) {
        Object.assign(next, { [name]: account[name] });
      }
    }
    if (namesOf(next).length === 0) return;
    // A default that moves takes the tab's currency with it, as its setter does; one that stays
    // leaves the tab where its owner flipped it.
    if (next.defaultCurrency !== undefined) next.currency = next.defaultCurrency;
    applying = true;
    try {
      store.setState(next);
    } finally {
      applying = false;
    }
  }

  return {
    async read(load) {
      const begun = clock;
      const at = accounts;
      const view = await load();
      if (accounts === at) answer(view.settings, begun);
      return view;
    },

    start() {
      const unsubscribe = store.subscribe((state, previous) => {
        if (applying) return;
        // A list is sent whole, so one changed before the account has answered would carry the rest
        // of a list that may be the last account's. It is not sent, and the answer replaces it.
        const changed = SETTING_NAMES.filter(
          (name) => !same(state[name], previous[name]) && (answered || !Array.isArray(state[name])),
        );
        if (changed.length === 0) return;
        for (const name of changed) Object.assign(unsent, { [name]: state[name] });
        clearTimeout(timer);
        timer = setTimeout(() => void send(), SETTINGS_PATCH_DELAY_MS);
      });
      return () => {
        unsubscribe();
        drop();
      };
    },

    forget() {
      drop();
      sending = undefined;
      accounts += 1;
      answered = false;
    },
  };
}
