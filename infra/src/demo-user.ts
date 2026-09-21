// The demo's identity, in one place. The row sits under an `app_user` of its own,
// never under the super-admin, who is the owner's own account. Three sites have to name
// it — `../migrations/005_demo_user.sql`, and the seed and public read still to be
// written — so the migration is asserted against these constants rather than repeating
// them (`migrate.test.ts`, `the demo user`).
// [*Auth model* · ../migrations/005_demo_user.sql]

/** Pinned, not generated. DSQL primary keys are immutable, so changing this is a
 *  DELETE and an INSERT of every row the demo owns, not an update. v4-shaped rather
 *  than random, so the row is recognisable in a query result without a join. */
export const DEMO_USER_ID = '00000000-0000-4000-8000-00000000de70';

/** Under the owner's own verified domain (`infra/docs/console-setup.md`), and not
 *  invented. `app_user_email_uq` stops a second row for an address Cognito already
 *  considers taken; this row inverts that — the database holds an address Cognito has
 *  never seen — so only an address the owner alone can hold leaves it without a
 *  victim. */
export const DEMO_USER_EMAIL = 'demo@quirenote.com';

/** The one account the demo owns, pinned for `DEMO_USER_ID`'s reason and for one more: a literal id
 *  lets `008` conflict on the PRIMARY KEY, the target `infra/docs/dsql-constraints.md` measured,
 *  rather than on the secondary unique index it did not. */
export const DEMO_ACCOUNT_ID = '00000000-0000-4000-8000-00000000acc0';
