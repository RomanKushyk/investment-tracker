// ASCII by necessity: `006_email_lower.sql` constrains the column to `email = lower(email)`, and
// Postgres `lower()` parts company with JavaScript `toLowerCase()` outside ASCII, where one can
// fold a character into two. Shared by the applications endpoint and the migration runner's
// bootstrap so a single answer says what the cluster will accept.

/** Local part is the RFC 5322 dot-atom; domain is LDH labels under an alphabetic TLD. */
export const ADDRESS =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** The octet ceiling an SMTP path allows: longer is undeliverable, not merely long. */
export const MAX_ADDRESS = 254;

/**
 * The canonical form of `supplied`, or `undefined`. Length before pattern: `||` short-circuits,
 * so the regular expression never sees more than 254 characters from an unauthenticated caller.
 */
export function canonicalAddress(supplied: unknown): string | undefined {
  if (typeof supplied !== 'string') return undefined;
  const email = supplied.trim().toLowerCase();
  if (email.length > MAX_ADDRESS || !ADDRESS.test(email)) return undefined;
  return email;
}
