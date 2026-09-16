import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Pre-sign-up: the trigger that keeps one account per email true across a provider boundary.
//
// The pool refuses a second LOCAL sign-up on an address it already holds. It does NOT refuse a
// Google identity arriving at that address: to Cognito that is a new profile with its own `sub`,
// and the portfolio hangs off the old one. Linking before Cognito mints it makes the two one
// account. The ceiling before a second provider is added: five federated identities per user.

export type PreSignUpEvent = {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: { userAttributes: Record<string, string> };
  response: Record<string, boolean>;
};

type PoolUser = { Username?: string; UserStatus?: string };

/** Narrowed to the two calls this file makes, so a test injects a double rather than the SDK. */
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

// The federated providers this pool can carry, matched case-INSENSITIVELY: the username's case is
// undocumented and a first federated sign-in has been reported lower-cased, where an exact match
// would fail every Google sign-in. EXPORTED so a test holds this to the template's `ProviderName`,
// which renders through a `!Ref` and would otherwise rename silently.
export const PROVIDERS = ['Google'];

// AWS RENDERS A THROWN ERROR'S MESSAGE TO THE PERSON SIGNING UP, so this is prose rather than a
// log line — and the same on every path, because whether an address has an application is not
// something a stranger may learn by trying. EXPORTED so a test asserts the message itself.
export const REFUSAL =
  'Registration is by application. Apply at quirenote.com and sign in once approved.';

// THE EXACT STRING, so an absent variable and every other value mean closed: the value arrives as
// text and `Boolean('false')` is `true`. Read per call, not at module load.
const registrationIsOpen = () => process.env.OPEN_REGISTRATION === 'true';

export async function preSignUp(
  event: PreSignUpEvent,
  idp: IdentityClient,
): Promise<PreSignUpEvent> {
  // APPROVAL ITSELF REACHES HERE, and must never be refused: AWS invokes this trigger on
  // `AdminCreateUser` too, and that IS the approval call. A refusal covering this source would
  // close the door on exactly the people who were let through it.
  if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;

  // EVERY OTHER NON-FEDERATED SOURCE IS REFUSED WHILE REGISTRATION IS CLOSED — a default-DENY
  // rather than an equality on the one source known today, and nothing is looked up.
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') {
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    return event;
  }

  const { email, email_verified: verified } = event.request.userAttributes;

  // THE APPROVAL TEST RUNS FIRST, AHEAD OF EVERY LINKING QUESTION: asked the other way round, each
  // linking check returned the event and Cognito minted a standalone federated profile for an
  // address with no application. NONE OF THE CHECKS BELOW MAY MOVE ABOVE THIS LINE.

  if (!email) {
    // Its own message: the likeliest cause is a dropped `email` mapping on the provider.
    console.warn(`pre-signup: no address on the event (${event.userName})`);
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    return event;
  }

  // Cognito's filter grammar has no `or`, so a quote cannot broaden the match — it malforms the
  // filter and the thrown error fails the sign-up. Unaskable is unapproved, never waved through.
  if (/["\\]/.test(email)) {
    console.warn(`pre-signup: address is not expressible as a filter (${event.userName})`);
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    return event;
  }

  // 60 IS THE MAXIMUM AND IT WIDENS THE WINDOW RATHER THAN CLOSING IT: `ListUsers` specifies no
  // order, is eventually consistent, may return fewer than `Limit` without reaching the end, and
  // hands back a `PaginationToken` this does not read. LOWER-CASED ON THE WAY IN, and it is the
  // STORED side being canonical that makes that work: approval creates the account from the
  // address `app_user_email_lower_ck` insists on, while the pool normalises nothing of its own —
  // `CaseSensitive: false` is a MATCHING rule for sign-in, so it keeps the case that was typed.
  // Should the filter be exact, an unfolded claim reads as "no local account" and mints the
  // duplicate this file prevents.
  const { Users = [] } = await idp.listUsers({
    UserPoolId: event.userPoolId,
    Filter: `email = "${email.toLowerCase()}"`,
    Limit: 60,
  });

  // A linked profile answers this filter too, carrying `EXTERNAL_PROVIDER`. Linking one of those
  // would make the local account — the one holding the rows — the side that disappears.
  const local = Users.find((u) => u.UserStatus !== 'EXTERNAL_PROVIDER' && u.Username);
  if (!local?.Username) {
    // NO LOCAL ACCOUNT MEANS NEVER APPROVED while registration is closed, the only state this
    // branch runs in. Refused rather than passed through: a passthrough leaves a standalone
    // profile that reads nothing but is still an identity and a monthly active user.
    if (!registrationIsOpen()) throw new Error(REFUSAL);
    console.warn(`pre-signup: not linking, address has no local account (${event.userName})`);
    return event;
  }

  // FROM HERE THE ADDRESS IS APPROVED AND EVERY REMAINING QUESTION IS ABOUT THE LINK ALONE. Each
  // PASSES THROUGH rather than refusing: refusing would lock an approved person out of an account
  // they own, where not linking leaves them a second profile and their access. An unverified
  // address is the whole attack — claim someone's mailbox at a provider that never checked and the
  // link hands over their portfolio. Google does assert the claim; this reads it anyway, because a
  // second provider is where that assumption becomes a takeover.
  if (verified !== 'true') {
    console.warn(`pre-signup: not linking, address not asserted verified (${event.userName})`);
    return event;
  }

  // `Username` is `<provider>_<subject>`, the only place the incoming provider's name appears. THE
  // SEPARATOR IS CHECKED BEFORE THE PREFIX IS TAKEN: `indexOf` answers -1 with no underscore, and
  // `slice(0, -1)` is everything but the last character, so `Googlex` would match as `Google`.
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
  // AND THE SUBJECT HAS TO BE THERE: `Google_` parses as a valid prefix and an empty subject, and
  // since every error from the link call is allowed out, that would FAIL the sign-up.
  const providerSubject = event.userName.slice(separator + 1);
  if (!providerSubject) {
    console.warn(`pre-signup: not linking, username carries no subject (${event.userName})`);
    return event;
  }

  // THE DIRECTION IS NOT SYMMETRIC: the destination survives and the source is absorbed, so the
  // account that owns the portfolio must be the destination. NOTHING IS CAUGHT HERE —
  // `AliasExistsException` does not mean "the link already exists" but an address already aliased
  // to a DIFFERENT profile, which this code cannot tell apart, and swallowing it would let
  // Cognito mint the standalone profile.
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

// The pool id comes off the event, so there is no environment variable to be wrong.
const client = new CognitoIdentityProviderClient({});

const sdk: IdentityClient = {
  listUsers: (input) => client.send(new ListUsersCommand(input)),
  adminLinkProviderForUser: (input) => client.send(new AdminLinkProviderForUserCommand(input)),
};

export const handler = (event: PreSignUpEvent) => preSignUp(event, sdk);
