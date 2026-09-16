// How a provider REF is compared. A LEAF with no imports at all, because four
// call sites across three layers ask about the same string and every private
// copy of the rule has been a bug: `matchKey`, `sameRef`, `legacyUnitsOf` and
// `inzhurRefOptions`. Not a member of `parse.ts` for the reason `ovdp.ts` is a
// leaf — `core/asset-builder.ts` and `components/forms/` reach this, and pointing
// them at the feed parser would hand a form mapper a zod dependency.

/** Trimmed and lower-cased: ISINs are published upper-case but may be typed
 *  either way, and slugs are lower-case by convention. */
export function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase();
}

/**
 * Do two refs name the same instrument, IGNORING the kind?
 *
 * THE KIND IS DELIBERATELY EXCLUDED, which is the difference from `matchKey`: a
 * unit count was counted for an INSTRUMENT, and the kind is metadata about where
 * to look it up. Comparing kind+ref read a REPAIR as a re-point and deleted the
 * only unit count an asset had. The two namespaces cannot collide — an ISIN is
 * twelve upper-case alphanumerics and a slug is lower-case kebab.
 */
export function sameInstrument(a: string, b: string): boolean {
  return normalizeRef(a) === normalizeRef(b);
}
