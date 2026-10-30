// The step's write: the terms version `/terms` prints, which `POST /me/terms` accepts alone
// (*Legal documents*). A LEAF, as `auth/apply.ts` is, so the route's test can import it.
import { TERMS_VERSION } from '@quirenote/core/terms';

export const ACCEPTANCE = {
  method: 'POST',
  path: '/me/terms',
  body: JSON.stringify({ termsVersion: TERMS_VERSION }),
} as const;
