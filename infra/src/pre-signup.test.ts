import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type IdentityClient, type PreSignUpEvent, REFUSAL, preSignUp } from './pre-signup';

// The trigger that keeps "one account per email" true across a provider boundary. The pool's
// own refusal (`docs/reference/COGNITO-POOL-PARAMS.md`) covers two LOCAL sign-ups on one
// address; it cannot see a Google identity arriving at an address that already has a local
// user, because that is not a duplicate to Cognito — it is a new profile. Linking is what
// makes it one account, and the two things worth a test are the CONDITION it links under and
// the DIRECTION it links in.

const LOCAL_SUB = '7f3c1b2a-0000-4000-8000-0000000000aa';
const GOOGLE_SUB = '109876543210';

const event = (overrides: Partial<PreSignUpEvent> = {}): PreSignUpEvent => ({
  triggerSource: 'PreSignUp_ExternalProvider',
  userPoolId: 'eu-north-1_EXAMPLE',
  // Cognito spells a federated username `<provider>_<subject>`, and it is the only place
  // the incoming provider's name appears in the event.
  userName: `Google_${GOOGLE_SUB}`,
  request: { userAttributes: { email: 'owner@quirenote.com', email_verified: 'true' } },
  response: {},
  ...overrides,
});

// Records what the handler asked for rather than mocking a shape back at it: every
// assertion below is about the calls, so the calls are what the double keeps.
const spy = (users: { Username?: string; UserStatus?: string }[] = []) => {
  const listed: unknown[] = [];
  const linked: unknown[] = [];
  const idp: IdentityClient = {
    listUsers: async (input) => {
      listed.push(input);
      return { Users: users };
    },
    adminLinkProviderForUser: async (input) => {
      linked.push(input);
      return {};
    },
  };
  return { idp, listed, linked };
};

const native = [{ Username: LOCAL_SUB, UserStatus: 'CONFIRMED' }];

// CLOSED IS SET RATHER THAN ASSUMED, for every test in this file. The refusals below read
// `process.env`, so a shell that happened to export `OPEN_REGISTRATION=true` would turn them
// red for a reason naming nothing. `stubEnv` also RESTORES what the process arrived with,
// which `delete` does not.
beforeEach(() => {
  vi.stubEnv('OPEN_REGISTRATION', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the pre-sign-up trigger links a federated identity to the account that already owns the data', () => {
  it('links when the provider asserts the address verified', async () => {
    const { idp, linked } = spy(native);
    await preSignUp(event(), idp);
    expect(linked).toHaveLength(1);
  });

  // THE DIRECTION, AND IT IS NOT SYMMETRIC. The destination survives the link and the source
  // is absorbed into it, so the local user — the one the portfolio's rows hang off by
  // `user_id` — must be the destination. Reversed, removing Google later would take the
  // account with it.
  it('makes the local user the destination and the federated identity the source', async () => {
    const { idp, linked } = spy(native);
    await preSignUp(event(), idp);
    expect(linked[0]).toEqual({
      UserPoolId: 'eu-north-1_EXAMPLE',
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: LOCAL_SUB },
      SourceUser: {
        ProviderName: 'Google',
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: GOOGLE_SUB,
      },
    });
  });

  // AWS's own warning about `AdminLinkProviderForUser` is to use it only with providers and
  // attributes you trust, and an unverified address is the whole attack: claim someone's
  // mailbox at a provider that never checked, and the link hands you their portfolio. Google
  // does assert the claim — the trigger reads it anyway, because the day a second provider is
  // added is the day the assumption becomes a takeover.
  it('refuses to link when the address is not verified', async () => {
    const { idp, linked } = spy(native);
    const unverified = event();
    unverified.request.userAttributes.email_verified = 'false';
    await preSignUp(unverified, idp);
    expect(linked).toEqual([]);
  });

  // ABSENT IS NOT VERIFIED, and it is the likelier of the two: a provider that never sends the
  // claim, or an `AttributeMapping` that forgot to map it, both arrive here as `undefined`.
  it('refuses to link when the claim is missing entirely', async () => {
    const { idp, linked } = spy(native);
    const silent = event();
    delete silent.request.userAttributes.email_verified;
    await preSignUp(silent, idp);
    expect(linked).toEqual([]);
  });

  // A federated user carries `UserStatus: EXTERNAL_PROVIDER`, so once a link exists `ListUsers`
  // on that address answers with it too. Linking a federated identity to a federated identity
  // is not what this trigger is for, and picking one as the destination would make the local
  // account — the one holding the rows — the thing that disappears.
  //
  // A list holding ONLY such a profile is therefore an address with no local account, which
  // is now a refusal rather than a passthrough — but the assertion that matters here is
  // unchanged and is the second one: whatever the answer, nothing was linked to it.
  it('ignores an already-federated profile when choosing the destination', async () => {
    const { idp, linked } = spy([{ Username: 'Google_other', UserStatus: 'EXTERNAL_PROVIDER' }]);
    await expect(preSignUp(event(), idp)).rejects.toThrow(REFUSAL);
    expect(linked).toEqual([]);
  });

  // THE MIXED LIST IS THE REAL CASE, and the single-element one above cannot exercise it:
  // `find` over a list whose first row is federated has to keep looking rather than stop.
  // The federated row is first deliberately — `ListUsers` specifies no ordering.
  it('picks the local account out of a list that starts with a federated one', async () => {
    const { idp, linked } = spy([
      { Username: 'Google_other', UserStatus: 'EXTERNAL_PROVIDER' },
      { Username: LOCAL_SUB, UserStatus: 'CONFIRMED' },
    ]);
    await preSignUp(event(), idp);
    expect(linked).toHaveLength(1);
    expect(
      (linked[0] as { DestinationUser: { ProviderAttributeValue: string } }).DestinationUser,
    ).toEqual({ ProviderName: 'Cognito', ProviderAttributeValue: LOCAL_SUB });
  });

  // The case of the username in this event is not something AWS documents, and there are
  // field reports of a first federated sign-in arriving lower-cased. Matched literally,
  // `google_1` would name a provider `google` that does not exist, throw, and fail EVERY
  // Google sign-in — so the lookup does not depend on the question being settled.
  it('resolves the provider whatever case the username arrives in', async () => {
    const { idp, linked } = spy(native);
    await preSignUp(event({ userName: `google_${GOOGLE_SUB}` }), idp);
    expect(linked).toHaveLength(1);
    expect((linked[0] as { SourceUser: { ProviderName: string } }).SourceUser.ProviderName).toBe(
      'Google',
    );
  });

  it('does not link a provider the pool does not carry', async () => {
    const { idp, linked } = spy(native);
    await preSignUp(event({ userName: 'Facebook_9' }), idp);
    expect(linked).toEqual([]);
  });

  // `indexOf` answers -1 with no underscore, and `slice(0, -1)` drops the last character
  // rather than returning nothing — so `Googlex` yields the prefix `Google` and MATCHES.
  // What refuses it is the separator check running first, which is the kind of correctness
  // that stops being true the moment two clauses are reordered.
  //
  // The lookup HAS run by the time the username is read — the approval test comes first now —
  // so what this asserts is that nothing was linked, not that nothing was asked.
  it('does not read a provider out of a username that has no prefix', async () => {
    for (const userName of ['Googlex', 'Google', '_Google']) {
      const { idp, linked } = spy(native);
      await preSignUp(event({ userName }), idp);
      expect([userName, linked]).toEqual([userName, []]);
    }
  });

  // The filter is Cognito's grammar and the address comes from the provider. A quote cannot
  // broaden the match — the grammar has no `or` — but it malforms the filter, and the
  // resulting `InvalidParameterException` would fail the sign-up rather than skip the link.
  it('asks for the address lower-cased, and declines one it cannot express', async () => {
    const { idp, listed } = spy(native);
    await preSignUp(event(), idp);
    expect(listed).toEqual([
      { UserPoolId: 'eu-north-1_EXAMPLE', Filter: 'email = "owner@quirenote.com"', Limit: 60 },
    ]);

    // THE INCOMING HALF, which the provider controls. The pool stores an address in the case
    // it was typed and `ListUsers` does not say whether it matches `email` case-sensitively —
    // so a mixed-case claim against a lower-cased account could read as "no local account"
    // and mint the duplicate. Lower-casing here makes the two halves agree either way.
    const { idp: idp3, listed: listed3 } = spy(native);
    const shouty = event();
    shouty.request.userAttributes.email = 'Owner@Quirenote.com';
    await preSignUp(shouty, idp3);
    expect((listed3[0] as { Filter: string }).Filter).toBe('email = "owner@quirenote.com"');

    // AN ADDRESS THE FILTER CANNOT EXPRESS IS AN ADDRESS WHOSE APPROVAL CANNOT BE ESTABLISHED,
    // so it is refused rather than waved past — and still never sent, which is the assertion
    // that keeps `InvalidParameterException` out of the sign-up.
    const { idp: idp2, listed: listed2, linked } = spy(native);
    const quoted = event();
    quoted.request.userAttributes.email = 'a"b@quirenote.com';
    await expect(preSignUp(quoted, idp2)).rejects.toThrow(REFUSAL);
    expect([listed2, linked]).toEqual([[], []]);
  });

  // EVERY ERROR FROM THE LINK IS ALLOWED OUT, `AliasExistsException` INCLUDED. It was briefly
  // swallowed as "already linked"; AWS documents it as an address already supplied as an alias
  // for a DIFFERENT user profile, which this code cannot tell from the benign reading — and
  // swallowing the wrong one logs reassurance while Cognito mints the standalone profile.
  it('fails the sign-up rather than guessing what a link error meant', async () => {
    for (const name of ['AliasExistsException', 'TooManyRequestsException']) {
      const { idp } = spy(native);
      idp.adminLinkProviderForUser = async () => {
        throw Object.assign(new Error(name), { name });
      };
      await expect(preSignUp(event(), idp)).rejects.toThrow(name);
    }
  });

  // `Google_` parses as a valid prefix and an EMPTY subject. Unguarded it reaches
  // `AdminLinkProviderForUser`, which rejects it — and because that call's errors are
  // deliberately allowed out, one malformed username would fail the sign-up where every other
  // unrecognised shape passes through.
  it('passes through a username with a prefix but no subject', async () => {
    const { idp, linked } = spy(native);
    const malformed = event({ userName: 'Google_' });
    // Passed through, not refused: the address is approved — `native` holds its local account —
    // and only the LINK is impossible. Refusing here would lock an approved person out.
    await expect(preSignUp(malformed, idp)).resolves.toBe(malformed);
    expect(linked).toEqual([]);
  });

  // NO LOCAL ACCOUNT MEANS NEVER APPROVED, and that is the whole test. `AdminCreateUser` on
  // approval is the only thing that ever creates one, so the lookup that already ran answers
  // the question the approval gate would ask — with no database call and no second source of
  // truth. Refused rather than passed through: a passthrough leaves a standalone federated
  // profile, which reads nothing but is an identity and a monthly active user.
  it('refuses a federated sign-in for an address with no local account', async () => {
    const { idp, linked } = spy([]);
    await expect(preSignUp(event(), idp)).rejects.toThrow(REFUSAL);
    expect(linked).toEqual([]);
  });

  // A local sign-up is the other route to `SignUp`, and it is refused for the same reason. It
  // must reach neither call — there is nothing to look up and nothing to link.
  it('refuses a local sign-up, listing and linking nothing', async () => {
    const { idp, linked, listed } = spy(native);
    await expect(
      preSignUp(event({ triggerSource: 'PreSignUp_SignUp', userName: LOCAL_SUB }), idp),
    ).rejects.toThrow(REFUSAL);
    expect([linked, listed]).toEqual([[], []]);
  });

  // SEVEN EXITS, NOT ONE. The refusal used to guard only the no-local-account branch, and
  // every check ahead of it returned the event — so an address whose claim was unverified, or
  // whose username was malformed, still got a standalone federated profile and a monthly
  // active user. These are the two that an outside party can actually reach: a provider that
  // stops asserting `email_verified`, or an `AttributeMapping` that drops `email` entirely.
  it('refuses an unverified claim for an address with no local account', async () => {
    const { idp, linked } = spy([]);
    const unverified = event();
    unverified.request.userAttributes.email_verified = 'false';
    await expect(preSignUp(unverified, idp)).rejects.toThrow(REFUSAL);
    expect(linked).toEqual([]);
  });

  it('refuses an event carrying no address at all, without asking the pool', async () => {
    const { idp, listed } = spy(native);
    const anonymous = event();
    delete anonymous.request.userAttributes.email;
    await expect(preSignUp(anonymous, idp)).rejects.toThrow(REFUSAL);
    // There is nothing to look up, so approval cannot be established and the pool is not asked.
    expect(listed).toEqual([]);
  });

  // THE ONE SOURCE THAT MUST NEVER BE REFUSED, and AWS is explicit that it reaches here:
  // the trigger fires "on user creation with AdminCreateUser". That call IS approval — the
  // only thing that creates a local account — so a refusal covering it would close the door
  // on the people who were let in, and the failure would land in the approve endpoint rather
  // than in this file.
  it('never refuses the approval path, even with registration closed', async () => {
    const { idp, linked, listed } = spy([]);
    const admin = event({ triggerSource: 'PreSignUp_AdminCreateUser', userName: LOCAL_SUB });
    await expect(preSignUp(admin, idp)).resolves.toBe(admin);
    expect([linked, listed]).toEqual([[], []]);
  });

  it('returns the event so Cognito can continue the sign-up', async () => {
    const { idp } = spy(native);
    const original = event();
    await expect(preSignUp(original, idp)).resolves.toBe(original);
  });
});

describe('open registration turns both refusals off', () => {
  // ONE PARAMETER DRIVES THIS AND THE POOL'S `AllowAdminCreateUserOnly` TOGETHER, so the two
  // cannot disagree — a half-open door, where the trigger admits a sign-up the pool still
  // refuses, has no symptom to notice. The template holds that end; here it is only read.
  it('lets a local sign-up through while it is on', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    const { idp, linked, listed } = spy(native);
    const open = event({ triggerSource: 'PreSignUp_SignUp', userName: LOCAL_SUB });
    await expect(preSignUp(open, idp)).resolves.toBe(open);
    // Still neither call: opening registration decides WHO may in, never what gets linked.
    expect([linked, listed]).toEqual([[], []]);
  });

  it('lets a federated sign-in with no local account through while it is on', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    const { idp, linked } = spy([]);
    const passed = await preSignUp(event(), idp);
    expect(passed).toEqual(event());
    expect(linked).toEqual([]);
  });

  // READ AS THE EXACT STRING, so the absent variable and every value but one mean closed. An
  // environment variable arrives as text and `Boolean('false')` is `true` — the trap that
  // would open registration on every environment that set it to anything at all.
  for (const value of ['false', 'TRUE', '1', 'yes', '']) {
    it(`stays closed when the variable says ${JSON.stringify(value)}`, async () => {
      vi.stubEnv('OPEN_REGISTRATION', value);
      const { idp } = spy(native);
      await expect(
        preSignUp(event({ triggerSource: 'PreSignUp_SignUp', userName: LOCAL_SUB }), idp),
      ).rejects.toThrow(REFUSAL);
    });
  }

  // "The refusal needs no database" is asserted on the TEMPLATE rather than here — the grant
  // is what makes it true, and `cognito-pool.test.ts` holds `PreSignUpFunction` to having no
  // `Policies:` block and no cluster endpoint. A source scan for import spellings passes for
  // every spelling it did not think of.
});
