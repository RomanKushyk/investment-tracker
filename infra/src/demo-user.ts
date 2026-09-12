// The demo's identity, in one place.
//
// The seeded original is a row set under an `app_user` of its own — never under
// the super-admin, who is the owner's own account (`docs/DECISIONS.md`,
// **Auth model**). Three things have to name that row: the migration that
// creates it (`../migrations/005_demo_user.sql`), the seed that writes against
// it, and the public read that serves it. A second literal is a second source
// of truth, so the migration is asserted against these two rather than
// repeating them — `migrate.test.ts`, `the demo user`.

/**
 * Pinned, not generated. DSQL primary keys are immutable, so this value is a
 * contract from the moment the migration applies: changing it is a DELETE and
 * an INSERT of every row the demo owns, not an update.
 *
 * A v4-shaped constant rather than a random uuid, so the row is recognisable in
 * a query result without a join — the same reason `user-schema.test.ts` numbers
 * its throwaway ids instead of randomising them.
 */
export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000de70';

/**
 * Under the owner's own verified domain (`infra/docs/console-setup.md`), and
 * that is the whole of the reason it is not invented.
 *
 * `app_user_email_uq` was written to stop a second row for an address Cognito
 * already considers taken. This row inverts it — the database holds an address
 * Cognito has never seen, so the constraint would refuse a real applicant
 * before Cognito had anything to say about them. An address only the owner can
 * ever hold is what leaves that inversion without a victim.
 */
export const DEMO_USER_EMAIL = 'demo@quirenote.com';
