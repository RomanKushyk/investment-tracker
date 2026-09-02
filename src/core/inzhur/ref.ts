// How a provider REF is compared. A leaf with no imports at all, because four
// call sites across three layers ask a question about the same string and every
// private copy of the rule has been a bug:
//
//   `matchKey`          — does this link reach a feed entry
//   `sameRef`           — do these two links name the same instrument
//   `legacyUnitsOf`     — does a stored unit count survive this edit
//   `inzhurRefOptions`  — is the current ref already in the picker list
//
// The last two held their own comparisons: `legacyUnitsOf` a hand-written trim +
// lower-case, and the picker a bare `===` that showed `ua4000238976` and
// `UA4000238976` as two rows for one bond.
//
// A LEAF and not a member of `parse.ts` for the reason `ovdp.ts` is one: this
// file is reached from `core/asset-builder.ts` and `components/forms/`, and
// pointing those at the feed parser would hand a form mapper a zod dependency
// it does not have — `asset-builder` imports `./schemas` for TYPES only, which
// erases.

/**
 * Refs are compared trimmed and lower-cased: ISINs are published upper-case but
 * may be typed either way, and slugs are lower-case by convention.
 */
export function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase();
}

/**
 * Do two refs name the same instrument, IGNORING the kind?
 *
 * THE KIND IS DELIBERATELY NOT PART OF THIS, and that is the difference between
 * this and `matchKey`. A unit count was counted for an INSTRUMENT; the kind is
 * metadata about where to look it up. A `dev`-era asset could store
 * `{kind:'bond', ref:'inzhur-reit'}` — the retired segment was a free choice —
 * and the only way to repair it is re-picking the same instrument, which writes
 * the derived kind. Comparing kind+ref there read a REPAIR as a re-point and
 * deleted the only unit count the asset had, which is the exact loss that made
 * mount-clearing unacceptable in the first place.
 *
 * The two namespaces cannot collide: an ISIN is twelve upper-case alphanumerics
 * and a fund slug is lower-case kebab, so an identical ref string under two
 * kinds is one instrument wearing two labels, never two instruments.
 */
export function sameInstrument(a: string, b: string): boolean {
  return normalizeRef(a) === normalizeRef(b);
}
