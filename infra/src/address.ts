// The one rule for an address this system will store, and it is ASCII by necessity rather
// than by taste.
//
// `006_email_lower.sql` constrains the column to `email = lower(email)`, so a row has to
// arrive already folded. Postgres `lower()` and JavaScript `toLowerCase()` agree on ASCII
// and part company outside it, where one of them can fold a single character into two —
// so restricting the input is what makes the fold done in TypeScript and the check done on
// the cluster the same operation. Anything else is refused before the cluster is asked,
// rather than sent for it to reject by constraint name.
//
// SHARED BECAUSE TWO PLACES NEED IT AND MUST NOT DISAGREE: the applications endpoint,
// where the address is typed by a stranger, and the migration runner's bootstrap, where it
// is typed by an operator. Same constraint, same fold, one source. A second copy is a
// second answer to "what will the cluster accept", and only one of them gets updated.

/** Local part is the RFC 5322 dot-atom; domain is LDH labels under an alphabetic TLD. */
const ADDRESS =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** The octet ceiling an SMTP path allows: longer is undeliverable, not merely long. */
const MAX_ADDRESS = 254;

/**
 * The canonical form of `supplied`, or `undefined` when there is none.
 *
 * The length is checked BEFORE the pattern, and the order is load-bearing rather than
 * tidy: `||` short-circuits, so the regular expression never sees more than 254
 * characters whatever an unauthenticated caller sends.
 */
export function canonicalAddress(supplied: unknown): string | undefined {
  if (typeof supplied !== 'string') return undefined;
  const email = supplied.trim().toLowerCase();
  if (email.length > MAX_ADDRESS || !ADDRESS.test(email)) return undefined;
  return email;
}
