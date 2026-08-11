// The localStorage keys, and the one-time rename that carries a pre-Quirenote
// profile across (D42, Plan A E1). Infra, not domain: localStorage is a browser
// API and belongs in src/lib, never in src/core (G1).
//
// WHY THIS IS A MODULE SIDE EFFECT, and why every consumer imports its keys
// from here rather than writing the string inline: `lib/db.ts` reads the
// settings key SYNCHRONOUSLY at module init, before React, the stores or any
// query exist (G4 binds the active dataset's database there). So the rename has
// to have happened before the first read, and the only way to guarantee that
// without making import order load-bearing is to do it when the module holding
// the keys is evaluated. Whichever of db.ts / settings.ts / draft.ts loads
// first triggers it; none of them can read a stale key afterwards.
//
// Here the key IS the data. A bare rename would silently discard the user's
// currency, ₴/$ rate, dataset flag and every dismissed reminder — which is why
// this is a migration and not a find-and-replace.

export const SETTINGS_KEY = 'quirenote-settings';
export const DRAFT_KEY = 'quirenote-draft';

/** Pre-rename keys, in the order they are carried across. */
const RENAMES: readonly (readonly [from: string, to: string])[] = [
  ['kubushka-settings', SETTINGS_KEY],
  ['kubushka-draft', DRAFT_KEY],
];

function carryOldProfile(): void {
  for (const [from, to] of RENAMES) {
    const value = localStorage.getItem(from);
    if (value === null) continue;
    // Never clobber. A profile already written under the new key is the live
    // one and wins; the old value is dropped rather than merged, because two
    // profiles is a state this app has no rule for resolving.
    if (localStorage.getItem(to) === null) localStorage.setItem(to, value);
    // Removed, not kept: one live profile, no ambiguity about which is
    // authoritative. What is lost on a rollback is currency, rate and
    // dismissals — all re-enterable in seconds, unlike a divergence that
    // nobody notices.
    localStorage.removeItem(from);
  }
}

try {
  carryOldProfile();
} catch {
  // No localStorage at all (node tests, a locked-down browser). Nothing to
  // carry, and nothing here is worth failing a boot over.
}
