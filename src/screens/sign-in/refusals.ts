import type { SignInRefusal } from '../../auth/sign-in';

/** What a step can be told: a sign-in's refusals, the passkey offer's two of its own, and a Google
 *  flow that came back without a sign-in. */
export type Reason = SignInRefusal | 'notCreated' | 'passkeyFailed' | 'googleFailed';

/** Said on the new password's line, in the rule's place (`password-reuse.dc.html`). */
export const ON_THE_RULE: readonly Reason[] = ['rule', 'reused'];
/** Said under a field; every other reason is said under the step's button. */
export const ON_THE_FIELD: readonly Reason[] = [
  'emailMissing',
  'emailInvalid',
  'passwordMissing',
  ...ON_THE_RULE,
];
