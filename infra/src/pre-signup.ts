import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Pre-sign-up: the trigger that keeps one account per email true across a provider boundary.
//
// The pool refuses a second LOCAL sign-up on an address it already holds, which is what the
// rehearsal established (`docs/reference/COGNITO-POOL-PARAMS.md`). It does not refuse a Google
// identity arriving at that address, because to Cognito that is not a duplicate — it is a new
// profile with its own `sub`, and the portfolio hangs off the old one. Linking before Cognito
// mints that profile is what makes the two one account.
//
// The ceiling worth knowing before a second provider is added: five federated identities per
// user.

export type PreSignUpEvent = {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: { userAttributes: Record<string, string> };
  response: Record<string, boolean>;
};

type PoolUser = { Username?: string; UserStatus?: string };

// Narrowed to the two calls this file makes, so the tests inject a double rather than the SDK.
// The same shape `migrate.ts` takes its `SqlClient` in.
export type IdentityClient = {
  listUsers(input: {
    UserPoolId: string;
    Filter: string;
    Limit: number;
  }): Promise<{ Users?: PoolUser[] }>;
  adminLinkProviderForUser(input: {
    UserPoolId: string;
    DestinationUser: { ProviderName: string; ProviderAttributeValue: string };
    SourceUser: {
      ProviderName: string;
      ProviderAttributeName: string;
      ProviderAttributeValue: string;
    };
  }): Promise<unknown>;
};

// The federated providers this pool can carry, spelled as `AdminLinkProviderForUser`
// needs them — the call matches `SourceUser.ProviderName` against the IdP's name exactly.
//
// Matched case-INSENSITIVELY, and deliberately without claiming to know why it would differ:
// the username's case in this event is not something AWS documents, and there are field
// reports of a first federated sign-in arriving lower-cased. An exact match would link
// against an IdP named `Google` with the string `google` and throw, failing every Google
// sign-in; an insensitive one costs nothing and does not depend on the question being
// settled. Adding a provider means adding its name here.
// EXPORTED so a test can hold it to the template's `ProviderName`. Before the client
// referenced the provider, a rename broke the deploy loudly; now it renders through a
// `!Ref` and would propagate silently, leaving a green stack where every federated
// sign-in falls past the lookup below and makes a second account instead of linking.
export const PROVIDERS = ['Google'];

// WHAT A REFUSED PERSON READS, and it says the same thing on every path on purpose: whether an
// address has an application is not something an unauthenticated stranger may learn by trying.
// AWS renders a thrown error's message to the person signing up.
//
// EXPORTED so the tests assert the message rather than merely that something threw — a bare
// `rejects.toThrow()` is satisfied by a `TypeError` from a future dereference, which would read
// as a refusal while being a crash.
export const REFUSAL =
  'Registration is by application. Apply at quirenote.com and sign in once approved.';

// THE EXACT STRING, so an absent variable and every other value mean closed. An environment
// variable arrives as text and `Boolean('false')` is `true`, which would open registration on
// any environment that set this to anything at all. Read per call rather than at module load so
// the value cannot be captured by a container that started before it changed.
const registrationIsOpen = () => process.env.OPEN_REGISTRATION === 'true';

export async function preSignUp(
  event: PreSignUpEvent,
  idp: IdentityClient,
): Promise<PreSignUpEvent> {
  // APPROVAL ITSELF REACHES HERE, and it must never be refused. AWS invokes this trigger "on
  // user creation with AdminCreateUser" as well as on sign-up and first federated sign-in —
  // and `AdminCreateUser` IS the approval call, the only thing that ever creates a local
  // account. A refusal that covered this source would close the door on exactly the people who
  // were let through it, and it would fail inside the approve endpoint rather than here.
  if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;

  // EVERY OTHER NON-FEDERATED SOURCE IS REFUSED WHILE REGISTRATION IS CLOSED, which is
  // `PreSignUp_SignUp` today and whatever AWS adds tomorrow. Written as a default-DENY rather
  // than as an equality on the one known value, because the alternative is a catch-all
  // `return event` sitting after two checks in a file that already argues at length that
  // safety must not depend on the order clauses happen to be in. Nothing is looked up: a
  // local sign-up has no provider identity to link, and the pool holds this path shut on its
  // own while `AllowAdminCreateUserOnly` is true — this is the half that answers if the two
  // ever drift.
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') {
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    return event;
  }

  const { email, email_verified: verified } = event.request.userAttributes;

  // THE APPROVAL TEST RUNS FIRST, AHEAD OF EVERY LINKING QUESTION, and the order is the whole
  // of what closes the door. Written the other way round — the shape this file had while
  // refusing was somebody else's job — each check below returned the event, and Cognito went
  // on to mint a standalone federated profile: an identity and a monthly active user, for an
  // address with no application. Only one of seven exits refused. Now the two questions are
  // separated and asked in the order they matter: MAY this address have an identity at all,
  // and only then, SHOULD this identity be linked to the local one.
  //
  // Nothing about the linking decisions below changed, and none of them may move above this
  // line: they are the reason a verified claim is required and an unrecognised provider is
  // passed over, and answering them first is what left the hole.

  if (!email) {
    // SAID SEPARATELY from the unverified case, because the likeliest cause is a dropped
    // `email` mapping on the provider, and one shared message would send whoever reads it
    // looking at the wrong thing. There is no address to look up, so approval cannot be
    // established at all.
    console.warn(`pre-signup: no address on the event (${event.userName})`);
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    return event;
  }

  // The filter is Cognito's own grammar and the address is provider-supplied. The grammar
  // has no `or`, so this cannot broaden the match; what a quote WOULD do is malform the
  // filter, and a thrown `InvalidParameterException` fails the sign-up outright. Unaskable is
  // treated as unapproved rather than waved through.
  if (/["\\]/.test(email)) {
    console.warn(`pre-signup: address is not expressible as a filter (${event.userName})`);
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    return event;
  }

  // 60, THE MAXIMUM, AND IT WIDENS THE WINDOW RATHER THAN CLOSING IT — it does not even
  // promise 60 rows. `ListUsers` specifies no order, is eventually consistent, may return
  // fewer than `Limit` without having reached the end, and hands back a `PaginationToken`
  // this does not read. What fills that window is the passthroughs: each one leaves another
  // unlinked `EXTERNAL_PROVIDER` row on the address, and past the boundary the local account
  // reads as absent, which makes yet another.
  //
  // The refusal below removes the UNAPPROVED half of that loop, which is the half that had no
  // ceiling — anyone could drive it. What remains is an APPROVED address whose link keeps
  // being declined, which is bounded by the four passthroughs further down and unreachable
  // today, since Google always asserts the claim they turn on.
  //
  // LOWER-CASED ON THE WAY IN, WHICH MAKES AN UNANSWERED QUESTION MOOT. `ListUsers` marks
  // some attributes case-sensitive and says nothing about `email`, and the pool does not
  // normalise: `CaseSensitive: false` is a MATCHING rule for sign-in, so an address is stored
  // in the case it was typed and read back that way. If the filter is exact, a mixed-case
  // claim from the provider reads as "no local account" and mints the duplicate this file
  // exists to prevent. The stored side is already lower-case — approval creates the account
  // from the address the database insists on (`app_user_email_lower_ck`) — so lower-casing
  // the incoming half makes the two agree without needing to know which rule applies.
  const { Users = [] } = await idp.listUsers({
    UserPoolId: event.userPoolId,
    Filter: `email = "${email.toLowerCase()}"`,
    Limit: 60,
  });

  // A linked profile answers this filter too, carrying `EXTERNAL_PROVIDER`. Linking one of
  // those would make the local account — the one holding the rows — the side that disappears.
  const local = Users.find((u) => u.UserStatus !== 'EXTERNAL_PROVIDER' && u.Username);
  if (!local?.Username) {
    // NO LOCAL ACCOUNT MEANS NEVER APPROVED — WHILE REGISTRATION IS CLOSED, which is the only
    // state this branch runs in. Then `AdminCreateUser` on approval is the only thing that
    // creates a local account, so the lookup that just ran is the whole test: no database, no
    // second record of who was invited. (An open-registration window creates local accounts
    // too, and they stay afterwards — so this is a coarse "has an account" filter, and the
    // real gate is the `status`/`role` check on every request.) Refused rather than passed
    // through: a passthrough leaves a standalone federated profile which reads nothing, but is
    // an identity and a monthly active user.
    //
    // `ListUsers` IS EVENTUALLY CONSISTENT, so someone approved seconds ago can read this
    // refusal once; retrying is the remedy, and a loud refusal beats the silent duplicate this
    // branch used to make.
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    console.warn(`pre-signup: not linking, address has no local account (${event.userName})`);
    return event;
  }

  // FROM HERE THE ADDRESS IS APPROVED AND EVERY REMAINING QUESTION IS ABOUT THE LINK ALONE.
  // These are #42's and are unchanged; each one still PASSES THROUGH, because the cost of
  // getting them wrong points the other way — refusing would lock an approved person out of
  // an account they own, where not linking leaves them a second profile and their access.
  //
  // LOGGED, BECAUSE NOT LINKING IS HOW A SECOND ACCOUNT GETS MADE. Each line names the
  // username — the provider and its subject, not an address — so a duplicate can be traced
  // back to the decision that made it.
  //
  // EXPLICITLY, and against the string it actually arrives as — Cognito passes every user
  // attribute as text. AWS's own guidance is to link only with providers and attributes you
  // trust, and an unverified address is the whole attack: claim someone's mailbox at a
  // provider that never checked and the link hands over their portfolio. Google does assert
  // the claim; this reads it anyway, because the day a second provider is added is the day
  // the assumption becomes a takeover.
  if (verified !== 'true') {
    console.warn(`pre-signup: not linking, address not asserted verified (${event.userName})`);
    return event;
  }

  // `Username` is `<provider>_<subject>` for a federated sign-up, and the only place the
  // incoming provider's name appears in the event.
  //
  // THE SEPARATOR IS CHECKED BEFORE THE PREFIX IS TAKEN, and the order is load-bearing
  // rather than tidy: `indexOf` answers -1 when there is no underscore, and `slice(0, -1)`
  // is not the empty string — it is everything but the last character, so `Googlex` would
  // yield the prefix `Google` and match. Combined into one condition it happens to be safe;
  // separated, it cannot stop being safe when someone reorders the clauses.
  const separator = event.userName.indexOf('_');
  if (separator < 1) {
    console.warn(
      `pre-signup: not linking, username carries no provider prefix (${event.userName})`,
    );
    return event;
  }
  const prefix = event.userName.slice(0, separator);
  const provider = PROVIDERS.find((p) => p.toLowerCase() === prefix.toLowerCase());
  if (!provider) {
    console.warn(`pre-signup: not linking, unrecognised provider prefix (${event.userName})`);
    return event;
  }
  // AND THE SUBJECT HAS TO BE THERE. `Google_` parses as a valid prefix and an empty subject,
  // which `AdminLinkProviderForUser` rejects — and since every error from that call is
  // deliberately allowed out, a malformed username would FAIL the sign-up where every other
  // unrecognised shape passes through it.
  const providerSubject = event.userName.slice(separator + 1);
  if (!providerSubject) {
    console.warn(`pre-signup: not linking, username carries no subject (${event.userName})`);
    return event;
  }

  // THE DIRECTION IS NOT SYMMETRIC. The destination survives and the source is absorbed into
  // it, so the local user is the destination: the account that owns the portfolio must not be
  // the one that disappears when an external provider is removed.
  //
  // NOTHING IS CAUGHT HERE, AND THE ONE CANDIDATE WAS WITHDRAWN. `AliasExistsException` was
  // swallowed on the reading that it means "the link you asked for already exists"; AWS
  // documents it as an address already supplied as an alias FOR A DIFFERENT USER PROFILE,
  // which is close to the opposite and is not something this code can tell apart. Swallowing
  // it would log a reassuring line and let Cognito mint the standalone profile — the exact
  // outcome every other error is allowed out to prevent. This trigger also fires only where
  // Cognito is about to create a NEW profile, so a repeat sign-in by an already-linked user
  // never reaches it, and the case the catch existed for does not arise.
  await idp.adminLinkProviderForUser({
    UserPoolId: event.userPoolId,
    DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: local.Username },
    SourceUser: {
      ProviderName: provider,
      ProviderAttributeName: 'Cognito_Subject',
      ProviderAttributeValue: providerSubject,
    },
  });

  return event;
}

// The pool id comes off the event, so there is no environment variable and no second place for
// it to be wrong.
const client = new CognitoIdentityProviderClient({});

const sdk: IdentityClient = {
  listUsers: (input) => client.send(new ListUsersCommand(input)),
  adminLinkProviderForUser: (input) => client.send(new AdminLinkProviderForUserCommand(input)),
};

export const handler = (event: PreSignUpEvent) => preSignUp(event, sdk);
