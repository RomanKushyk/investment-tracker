// The localStorage keys of the two persisted stores, settings and the quote draft, and the
// one-time rename that carries a pre-Quirenote profile across (*Brand*). The feed caches' keys
// sit with the hooks that write them, through `device-meta.ts`.
//
// THE RENAME IS A MODULE SIDE EFFECT because the settings store reads its key
// synchronously when its module is evaluated; doing it when the module holding
// the keys is evaluated is the only way to beat that read without making import
// order load-bearing. Import these keys from here rather than inlining the string, or a
// consumer can read a stale one.

export const SETTINGS_KEY = 'quirenote-settings';
export const DRAFT_KEY = 'quirenote-draft';

const RENAMES: readonly (readonly [from: string, to: string])[] = [
  ['kubushka-settings', SETTINGS_KEY],
  ['kubushka-draft', DRAFT_KEY],
];

function carryOldProfile(): void {
  for (const [from, to] of RENAMES) {
    const value = localStorage.getItem(from);
    if (value === null) continue;
    // Never clobber: a profile already under the new key is the live one and wins.
    // Two profiles is a state this app has no rule for resolving.
    if (localStorage.getItem(to) === null) localStorage.setItem(to, value);
    // Removed rather than kept, so nothing is ambiguous about which is authoritative.
    // A rollback costs currency, rate and dismissals — seconds to re-enter, unlike a
    // divergence nobody notices.
    localStorage.removeItem(from);
  }
}

try {
  carryOldProfile();
} catch {
  // No localStorage at all (node tests, a locked-down browser): nothing to carry.
}
