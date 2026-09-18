import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type IdentityClient, type PreSignUpEvent, REFUSAL, preSignUp } from './pre-signup';

// The trigger that keeps "one account per email" true across a provider boundary. The pool's own
// refusal covers two LOCAL sign-ups on one address; it cannot see a Google identity arriving at an
// address that already has a local user, because that is not a duplicate to Cognito — it is a new
// profile. Linking is what makes it one account.

const LOCAL_SUB = '7f3c1b2a-0000-4000-8000-0000000000aa';
const GOOGLE_SUB = '109876543210';

const event = (overrides: Partial<PreSignUpEvent> = {}): PreSignUpEvent => ({
  triggerSource: 'PreSignUp_ExternalProvider',
  userPoolId: 'eu-north-1_EXAMPLE',
  userName: `Google_${GOOGLE_SUB}`,
  request: { userAttributes: { email: 'owner@quirenote.com', email_verified: 'true' } },
  response: {},
  ...overrides,
});

// Records what the handler asked for: every assertion below is about the calls.
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

// Closed is SET rather than assumed: the refusals read `process.env`, so an exported
// `OPEN_REGISTRATION=true` would turn them red for a reason naming nothing.
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

  // THE DIRECTION IS NOT SYMMETRIC: the destination survives the link and the source is absorbed,
  // so the local user — the one the portfolio's rows hang off — must be the destination. Reversed,
  // removing Google later would take the account with it.
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

  // An unverified address is the whole attack: claim someone's mailbox at a provider that never
  // checked, and the link hands you their portfolio. Read anyway, against a second provider.
  it('refuses to link when the address is not verified', async () => {
    const { idp, linked } = spy(native);
    const unverified = event();
    unverified.request.userAttributes.email_verified = 'false';
    await preSignUp(unverified, idp);
    expect(linked).toEqual([]);
  });

  it('refuses to link when the claim is missing entirely', async () => {
    const { idp, linked } = spy(native);
    const silent = event();
    delete silent.request.userAttributes.email_verified;
    await preSignUp(silent, idp);
    expect(linked).toEqual([]);
  });

  // A federated user carries `UserStatus: EXTERNAL_PROVIDER`, so once a link exists `ListUsers`
  // answers with it too; picking one as the destination would lose the local account.
  it('ignores an already-federated profile when choosing the destination', async () => {
    const { idp, linked } = spy([{ Username: 'Google_other', UserStatus: 'EXTERNAL_PROVIDER' }]);
    await expect(preSignUp(event(), idp)).rejects.toThrow(REFUSAL);
    expect(linked).toEqual([]);
  });

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

  // The case of the username here is not documented and a lower-cased first sign-in is reported,
  // so `google_1` matched literally would name a provider that does not exist and throw.
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

  // `indexOf` answers -1 with no underscore and `slice(0, -1)` drops the last character rather
  // than returning nothing, so `Googlex` yields the prefix `Google` and MATCHES. What refuses it
  // is the separator check running first — correctness that dies the moment two clauses swap.
  it('does not read a provider out of a username that has no prefix', async () => {
    for (const userName of ['Googlex', 'Google', '_Google']) {
      const { idp, linked } = spy(native);
      await preSignUp(event({ userName }), idp);
      expect([userName, linked]).toEqual([userName, []]);
    }
  });

  // A quote cannot broaden Cognito's filter grammar, but it malforms the filter and the resulting
  // `InvalidParameterException` would fail the sign-up rather than skip the link.
  it('asks for the address lower-cased, and declines one it cannot express', async () => {
    const { idp, listed } = spy(native);
    await preSignUp(event(), idp);
    expect(listed).toEqual([
      { UserPoolId: 'eu-north-1_EXAMPLE', Filter: 'email = "owner@quirenote.com"', Limit: 60 },
    ]);

    // The pool stores an address in the case it was typed and `ListUsers` does not say whether it
    // matches `email` case-sensitively, so lower-casing makes the two halves agree either way.
    const { idp: idp3, listed: listed3 } = spy(native);
    const shouty = event();
    shouty.request.userAttributes.email = 'Owner@Quirenote.com';
    await preSignUp(shouty, idp3);
    expect((listed3[0] as { Filter: string }).Filter).toBe('email = "owner@quirenote.com"');

    // An address the filter cannot express is one whose approval cannot be established.
    const { idp: idp2, listed: listed2, linked } = spy(native);
    const quoted = event();
    quoted.request.userAttributes.email = 'a"b@quirenote.com';
    await expect(preSignUp(quoted, idp2)).rejects.toThrow(REFUSAL);
    expect([listed2, linked]).toEqual([[], []]);
  });

  // Every error from the link is allowed out, `AliasExistsException` INCLUDED: AWS documents it as
  // an address already an alias for a DIFFERENT profile, which this code cannot tell from the
  // benign reading — and swallowing the wrong one logs reassurance while Cognito mints a profile.
  it('fails the sign-up rather than guessing what a link error meant', async () => {
    for (const name of ['AliasExistsException', 'TooManyRequestsException']) {
      const { idp } = spy(native);
      idp.adminLinkProviderForUser = async () => {
        throw Object.assign(new Error(name), { name });
      };
      await expect(preSignUp(event(), idp)).rejects.toThrow(name);
    }
  });

  // `Google_` parses as a valid prefix and an EMPTY subject, which the link would reject — and its
  // errors are deliberately allowed out, so one malformed username would fail the sign-up.
  it('passes through a username with a prefix but no subject', async () => {
    const { idp, linked } = spy(native);
    const malformed = event({ userName: 'Google_' });
    // Passed through, not refused: the address is approved and only the LINK is impossible.
    await expect(preSignUp(malformed, idp)).resolves.toBe(malformed);
    expect(linked).toEqual([]);
  });

  // No local account means never approved: `AdminCreateUser` on approval is the only thing that
  // creates one. Refused rather than passed through — a passthrough leaves a standalone profile.
  it('refuses a federated sign-in for an address with no local account', async () => {
    const { idp, linked } = spy([]);
    await expect(preSignUp(event(), idp)).rejects.toThrow(REFUSAL);
    expect(linked).toEqual([]);
  });

  // A local sign-up must reach neither call: nothing to look up and nothing to link.
  it('refuses a local sign-up, listing and linking nothing', async () => {
    const { idp, linked, listed } = spy(native);
    await expect(
      preSignUp(event({ triggerSource: 'PreSignUp_SignUp', userName: LOCAL_SUB }), idp),
    ).rejects.toThrow(REFUSAL);
    expect([linked, listed]).toEqual([[], []]);
  });

  // SEVEN EXITS, NOT ONE: every check ahead of the refusal used to return the event, so an
  // unverified claim or a dropped `email` mapping still got a standalone federated profile.
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

  // The one source that must never be refused: the trigger fires on `AdminCreateUser`, and that
  // call IS approval, so a refusal covering it would close the door on the people let in.
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
  // One parameter drives this and the pool's `AllowAdminCreateUserOnly` together, so a half-open
  // door — the trigger admitting a sign-up the pool refuses — has no symptom to notice.
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

  // Read as the exact string: a variable arrives as text and `Boolean('false')` is `true`.
  for (const value of ['false', 'TRUE', '1', 'yes', '']) {
    it(`stays closed when the variable says ${JSON.stringify(value)}`, async () => {
      vi.stubEnv('OPEN_REGISTRATION', value);
      const { idp } = spy(native);
      await expect(
        preSignUp(event({ triggerSource: 'PreSignUp_SignUp', userName: LOCAL_SUB }), idp),
      ).rejects.toThrow(REFUSAL);
    });
  }

  // "The refusal needs no database" is asserted on the TEMPLATE rather than here: a source scan
  // for import spellings passes for every spelling it did not think of.
});
