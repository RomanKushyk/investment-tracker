import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { PROVIDERS } from './pre-signup';

// THE ONE RESOURCE IN THIS SYSTEM THAT CANNOT BE EDITED INTO CORRECTNESS. Three of the pool's
// parameters are fixed at `CreateUserPool` — `UsernameAttributes`, `UsernameConfiguration` and
// `Schema`'s required flags — and getting one wrong is not an edit, it is recreating the pool
// with users already in it. `docs/reference/COGNITO-POOL-PARAMS.md` is where the rehearsal that
// established them is written down; this file is what holds the template to them.
//
// Parsed the way `stack-split.test.ts` parses: `parseDocument`, asserting `errors` and never
// `warnings`, because every CloudFormation intrinsic is an unresolved tag to a YAML parser.
// `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]` arrives as
// the three-element array `['IsProd', 'a', 'b']`, which is what the paired assertions match.

type Resource = {
  Type: string;
  Condition?: string;
  DependsOn?: string | string[];
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Properties?: Record<string, unknown>;
};
type Template = {
  Parameters?: Record<string, { Type: string; Default?: string; NoEcho?: boolean }>;
  Conditions?: Record<string, unknown>;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, unknown>;
};

const source = readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8');
const doc = parseDocument(source);
const user = doc.toJS() as Template;

const props = (id: string) => user.Resources[id]?.Properties ?? {};
const DEV_AUTH = 'auth.dev.quirenote.com';
const PROD_AUTH = 'auth.quirenote.com';

describe('the pool is created with the parameters it can never be given later', () => {
  // The anchor `stack-split.test.ts` opens with, for the same reason: an empty or unparsed
  // file passes every absence assertion below.
  it('parses, and the pool is in it', () => {
    expect(doc.errors).toEqual([]);
    expect(user.Resources.UserPool?.Type).toBe('AWS::Cognito::UserPool');
  });

  // CREATE-TIME ONLY #1, the one the decision names. Not in `UpdateUserPool` at all.
  it('signs in by email address', () => {
    expect(props('UserPool').UsernameAttributes).toEqual(['email']);
  });

  // NEVER `AliasAttributes`, and asserted across every resource rather than the pool alone —
  // the two are alternatives, so a pool that gained one would not fail the assertion above.
  // Aliases let several users hold one address and resolve it as "only the last user who
  // verified it can sign in", which takes sign-in away from an existing account silently:
  // the precise failure `UsernameAttributes` is chosen to prevent.
  //
  // On the PARSED template, not the raw source. Matching the text would also match the
  // comment above the pool that explains why the property is not there, which is a sentence
  // worth keeping.
  it('uses no alias attribute anywhere', () => {
    for (const [id, r] of Object.entries(user.Resources)) {
      expect([id, r.Properties?.AliasAttributes]).toEqual([id, undefined]);
    }
  });

  // CREATE-TIME ONLY #2, and the rehearsal found it by omitting it (#53). `DescribeUserPool`
  // returns it ABSENT rather than defaulted, so the effective default cannot be read off a
  // pool — it can only be observed by signing up twice, which is what the rehearsal did:
  // `rehearsal-one@` and `REHEARSAL-ONE@` became two accounts with two subs. One mailbox
  // spelled two ways is one account only if this is sent at creation.
  it('matches an address case-insensitively', () => {
    expect(props('UserPool').UsernameConfiguration).toEqual({ CaseSensitive: false });
  });

  // CREATE-TIME ONLY #3 — "You can't change required attributes after you create a user pool",
  // and `Schema` is not an `UpdateUserPool` parameter. The issue body names the first two; the
  // reference file names this one, so it is held here too.
  it('requires the email attribute', () => {
    expect(props('UserPool').Schema).toEqual([
      { Name: 'email', AttributeDataType: 'String', Required: true, Mutable: true },
    ]);
  });

  // Passkeys are not in Lite. Changeable later, unlike the three above, but wrong from the
  // start would mean a pool that cannot do the thing onboarding is built around.
  it('is on the Essentials tier', () => {
    expect(props('UserPool').UserPoolTier).toBe('ESSENTIALS');
  });

  // Retained and protected exactly as both DSQL clusters are, and for the same reason applied
  // to a different thing: a `sam delete` must not be able to destroy the identities that the
  // portfolio rows hang off by `user_id`.
  it('is retained and deletion-protected', () => {
    expect(user.Resources.UserPool.DeletionPolicy).toBe('Retain');
    expect(user.Resources.UserPool.UpdateReplacePolicy).toBe('Retain');
    expect(props('UserPool').DeletionProtection).toBe('ACTIVE');
  });

  // Registration is an application, not an open door (`docs/DECISIONS.md`, **Auth model**):
  // approval calls `AdminCreateUser`. Changeable, and the open-registration parameter below
  // is what changes it.
  //
  // NAMED FOR WHAT IT ACTUALLY CLOSES, which is `SignUp` and nothing else. AWS: with
  // self-registration off, users are still created "by sign-in with federated providers" —
  // so the moment Google is configured, any Google account mints a pool identity with no
  // `app_user` row behind it. It reads nothing (the API checks `status` and `role` on every
  // request) but it is an identity and a monthly active user. Closing that path is the
  // pre-sign-up refusal in `pre-signup.ts`; calling this test "closes self-service sign-up"
  // would assert something the pool does not do.
  it('closes the SignUp API, which is not the same as closing the door', () => {
    const config = props('UserPool').AdminCreateUserConfig as {
      AllowAdminCreateUserOnly: unknown[];
    };
    // The CLOSED arm, which is what the parameter's own default selects. The full shape and
    // the inversion are the next describe's; this one is about the pool's standing state.
    expect(config.AllowAdminCreateUserOnly[2]).toBe(true);
  });
});

describe('one parameter opens registration, in both places at once', () => {
  // THE HALF-OPEN DOOR IS THE FAILURE THIS SHAPE PREVENTS. Opening registration needs two
  // things true together: the pool must accept `SignUp` at all, and the trigger must stop
  // refusing addresses with no application. Driven separately — a settings row for one and a
  // deploy for the other — they can disagree, and the disagreement has NO symptom: the trigger
  // waves people through a door the pool still holds shut. So both read the same condition,
  // and the condition reads one parameter.
  it('drives the pool and the trigger from the same condition', () => {
    const pool = props('UserPool').AdminCreateUserConfig as { AllowAdminCreateUserOnly: string[] };
    const trigger = (
      props('PreSignUpFunction').Environment as { Variables: Record<string, string[]> }
    ).Variables;
    expect(pool.AllowAdminCreateUserOnly[0]).toBe('IsRegistrationOpen');
    expect(trigger.OPEN_REGISTRATION[0]).toBe('IsRegistrationOpen');
    expect(user.Conditions?.IsRegistrationOpen).toEqual(['OpenRegistration', 'open']);
  });

  // THE REFUSAL COSTS NO DATABASE, and the grant is what makes that true rather than the
  // handler's current imports. A trigger on a path a stranger reaches must not hold a
  // connection to the portfolio cluster, which is why this function is the one Lambda in the
  // stack with no `Policies:` block — its only grant is `PreSignUpPolicy`, two Cognito calls
  // on the pool. Asserted here because a source scan passes for every import spelling it did
  // not think of.
  it('gives the trigger no database of any kind', () => {
    expect(props('PreSignUpFunction')).not.toHaveProperty('Policies');
    const vars = (props('PreSignUpFunction').Environment as { Variables: Record<string, unknown> })
      .Variables;
    expect(vars).not.toHaveProperty('DSQL_ENDPOINT');
    expect(JSON.stringify(vars)).not.toContain('Cluster');
  });

  // CLOSED IS THE DEFAULT, asserted as the default rather than as whatever an environment
  // happens to pass — an environment that passes nothing is the case that matters, and it is
  // the one a test reading a passed value would never see.
  it('defaults to closed', () => {
    const p = user.Parameters?.OpenRegistration as { Default?: string; AllowedValues?: string[] };
    expect(p?.Default).toBe('closed');
    expect(p?.AllowedValues).toEqual(['closed', 'open']);
  });

  // AND THE TWO ARMS POINT THE OPPOSITE WAYS ROUND, which is the one thing a shared condition
  // does not guarantee. `AllowAdminCreateUserOnly` is TRUE when registration is closed and the
  // trigger's variable is 'true' when it is OPEN, so a copied `!If` would read plausibly and
  // invert one of them.
  it('points each arm the way its own property reads', () => {
    const pool = props('UserPool').AdminCreateUserConfig as { AllowAdminCreateUserOnly: unknown[] };
    const trigger = (
      props('PreSignUpFunction').Environment as { Variables: Record<string, string[]> }
    ).Variables;
    expect(pool.AllowAdminCreateUserOnly).toEqual(['IsRegistrationOpen', false, true]);
    expect(trigger.OPEN_REGISTRATION).toEqual(['IsRegistrationOpen', 'true', 'false']);
  });
});

describe('three sign-in methods reach the pool', () => {
  // Passkey-first does not work without both halves: the factor on the pool, and the flow on
  // the client. The rehearsal's pool defaulted to `["PASSWORD"]` alone and its client carried
  // no `ALLOW_USER_AUTH`, which is the note it left for whoever built the real one.
  it('offers a passkey as a first factor, beside a password', () => {
    const factors = (
      props('UserPool').Policies as { SignInPolicy?: { AllowedFirstAuthFactors?: string[] } }
    )?.SignInPolicy?.AllowedFirstAuthFactors;
    expect(factors).toContain('WEB_AUTHN');
    expect(factors).toContain('PASSWORD');
  });

  it('lets the client select a factor rather than declaring one', () => {
    expect(props('UserPoolClient').ExplicitAuthFlows).toContain('ALLOW_USER_AUTH');
  });

  // A PUBLIC CLIENT. The SPA cannot hold a secret, and a client with one makes every
  // browser-side call fail on a missing SECRET_HASH rather than on anything that names itself.
  it('generates no client secret', () => {
    expect(props('UserPoolClient').GenerateSecret).toBe(false);
  });

  // "Refresh token measured in years" resolves to 3650 DAYS: `TokenValidityUnits` has no
  // `years` unit and 315360000 seconds is the documented ceiling. Access and ID stay at 60
  // minutes — nothing decided at token-issue time can revoke anything, so the API checks
  // `status` and `role` on every request instead.
  it('holds a refresh token for years and access tokens for an hour', () => {
    expect(props('UserPoolClient')).toMatchObject({
      RefreshTokenValidity: 3650,
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      TokenValidityUnits: { RefreshToken: 'days', AccessToken: 'minutes', IdToken: 'minutes' },
    });
  });

  // Google's client id and secret are NOT in this repository — it is public. They arrive as
  // stack parameters from the environment's GitHub secrets, and the provider exists only when
  // they do, so the stack deploys green before the Google client has been created.
  it('adds Google only when its credentials were supplied', () => {
    expect(user.Resources.GoogleIdentityProvider?.Condition).toBe('HasGoogle');
    expect(user.Parameters?.GoogleClientSecret?.NoEcho).toBe(true);
    expect(user.Parameters?.GoogleClientId?.Default).toBe('');
    // BOTH HALVES, not just the id. Two secrets are added to an environment one at a time,
    // and an id without a secret would build the provider with an empty `client_secret` —
    // present in managed login, broken at the token exchange.
    expect(JSON.stringify(user.Conditions?.HasGoogle)).toContain('GoogleClientSecret');
    // The middle arm holds the RESOURCE name, because it is a `!Ref` rather than the
    // literal `Google` — see the test below for why that distinction is the ordering.
    expect(props('UserPoolClient').SupportedIdentityProviders).toEqual([
      'HasGoogle',
      ['COGNITO', 'GoogleIdentityProvider'],
      ['COGNITO'],
    ]);
  });

  // The trigger cannot read a claim the pool never maps, and an unmapped `email_verified`
  // arrives as `undefined` — which the trigger treats as unverified, so Google sign-in would
  // silently stop linking and start making second accounts.
  // A `Ref` to an identity provider returns its `ProviderName`, so `!Ref
  // GoogleIdentityProvider` and the literal `Google` render identically — and only one of
  // them is a dependency. With the literal, CloudFormation derives no ordering, and on the
  // deploy where the credentials first arrive it may update the client before creating the
  // provider: "identity provider Google does not exist". `toJS()` discards the tag and
  // keeps the value, so the parsed assertion above cannot tell the two apart; the raw
  // source is the only place the intrinsic survives.
  //
  // A `DependsOn` would be the wrong instrument rather than a second-best one: the provider
  // is conditional, and naming a resource that may not exist is an error in itself.
  it('depends on the provider rather than naming it in a string', () => {
    // Matched loosely on purpose: the parsed assertion above already pins the structure, so
    // all this has to prove is that the intrinsic is a `!Ref`. A regex spanning the whole
    // line would fail on prettier reflowing it, which is formatting rather than meaning.
    expect(source).toContain('!Ref GoogleIdentityProvider');
    expect(user.Resources.UserPoolClient.DependsOn).toBeUndefined();
  });

  // THE TWO HALVES OF THE PROVIDER'S NAME LIVE IN DIFFERENT FILES. The template creates the
  // IdP; the trigger matches the incoming `<provider>_<subject>` prefix against its own list
  // to decide what to link. Nothing but this test reads both.
  //
  // Google itself cannot drift far — Cognito refuses a social provider whose `ProviderName`
  // differs from its `ProviderType`, so that rename fails the deploy on its own. The guard is
  // for the provider after it: an OIDC or SAML name is free-form, and with the client holding
  // a `!Ref` rather than a literal, a mismatch would leave the stack green while every
  // federated sign-in fell past the lookup and made a second account.
  it('gives the trigger the provider name the template actually creates', () => {
    const name = props('GoogleIdentityProvider').ProviderName as string;
    expect(PROVIDERS).toContain(name);
    // AND A NAME THE TRIGGER CAN PARSE BACK OUT. It splits the username on the FIRST
    // underscore, while CloudFormation permits one inside a provider name — so an `Entra_ID`
    // added to both files would satisfy the assertion above, parse as `Entra`, miss the
    // lookup, and make second accounts with both files agreeing.
    expect([name, name.includes('_')]).toEqual([name, false]);
  });

  it('maps the verified flag Google asserts', () => {
    expect(props('GoogleIdentityProvider').AttributeMapping).toMatchObject({
      email: 'email',
      email_verified: 'email_verified',
    });
  });
});

describe('managed login runs on a domain the passkeys can keep', () => {
  // THE RELYING PARTY ID IS EFFECTIVELY PERMANENT. A passkey is registered against one RP ID
  // and a browser will not offer it to any other, and AWS states that adding a custom domain
  // later "will cause passkey integration for your prefix domain to stop working due to a
  // mismatch in RP ID". An `amazoncognito.com` RP ID is also not a registrable suffix of a
  // `quirenote.com` origin, so the prefix domain is not a stop on the way here — it is a
  // different, one-way road. Hence the custom domain from the first deploy.
  it('serves managed login from the custom domain', () => {
    expect(props('UserPoolDomain').Domain).toEqual(['IsProd', PROD_AUTH, DEV_AUTH]);
    expect(props('UserPoolDomain').ManagedLoginVersion).toBe(2);
    expect(props('UserPoolDomain').CustomDomainConfig).toBeDefined();
  });

  // The same pair, and that is the assertion rather than the value: an RP ID that is not the
  // domain managed login is served from registers passkeys no browser will offer back.
  it('pins the relying party to that same domain', () => {
    expect(props('UserPool').WebAuthnRelyingPartyID).toEqual(props('UserPoolDomain').Domain);
  });

  // Cognito requires an app client before a custom domain, and CloudFormation has no way to
  // know that.
  it('creates the client before the domain', () => {
    expect(user.Resources.UserPoolDomain.DependsOn).toContain('UserPoolClient');
  });

  // A DOMAIN WITHOUT A STYLE SERVES A BROKEN PAGE. AWS: when an app client has no style
  // assigned, managed login pages for that client are nonfunctional until one is created —
  // branding version 2 does not fall back to the classic UI, it fails. Same failure shape as
  // the missing DNS record: a green stack and an endpoint nobody can sign in through.
  it('gives the client a branding style, without which managed login does not render', () => {
    const branding = user.Resources.ManagedLoginBranding;
    expect(branding?.Type).toBe('AWS::Cognito::ManagedLoginBranding');
    expect(branding?.Properties?.UseCognitoProvidedValues).toBe(true);
    // `UseCognitoProvidedValues: true` requires both of these to be omitted.
    expect(branding?.Properties?.Settings).toBeUndefined();
    expect(branding?.Properties?.Assets).toBeUndefined();
  });
});

describe('the linking trigger is wired without closing a cycle', () => {
  it('is the pool trigger', () => {
    expect(props('UserPool').LambdaConfig).toEqual({
      PreSignUp: 'PreSignUpFunction.Arn',
    });
    expect(source).toMatch(/PreSignUp:\s*!GetAtt\s/);
  });

  it('runs the handler this repository tests', () => {
    expect(props('PreSignUpFunction').Handler).toBe('pre-signup.handler');
  });

  // THE CYCLE, AND THE TWO PLACES IT IS BROKEN. The pool names the function, so nothing the
  // pool depends on may name the pool. The invoke permission is scoped by `SourceAccount`
  // instead of `SourceArn` and the pool waits on it; the IAM grant is a separate policy
  // resource, created after both, which is what lets it keep the real pool ARN rather than a
  // wildcard over every pool in the account — including the other environment's.
  it('grants the invoke by account, and the pool waits for it', () => {
    expect(props('PreSignUpPermission').SourceAccount).toBeDefined();
    expect(props('PreSignUpPermission').SourceArn).toBeUndefined();
    expect(user.Resources.UserPool.DependsOn).toContain('PreSignUpPermission');
  });

  it('grants the link on this pool alone, from a policy of its own', () => {
    const policy = user.Resources.PreSignUpPolicy;
    expect(policy?.Type).toBe('AWS::IAM::Policy');
    const doc = JSON.stringify(policy?.Properties?.PolicyDocument);
    expect(doc).toContain('cognito-idp:AdminLinkProviderForUser');
    expect(doc).toContain('cognito-idp:ListUsers');
    expect(doc).toContain('UserPool.Arn');
  });
});

describe('the stack still takes its environment the way it did', () => {
  // The certificate lives in us-east-1 and its ARN carries the account id, so it is a
  // parameter rather than a literal — this repository is public.
  it('takes the certificate as a parameter with no default', () => {
    expect(user.Parameters?.AuthCertificateArn?.Type).toBe('String');
    expect(user.Parameters?.AuthCertificateArn).not.toHaveProperty('Default');
  });

  // AND CONSTRAINS IT, because the empty string is what an unset secret renders as and an
  // unconstrained String accepts it. The pool would be created, the domain would fail, and
  // `Retain` + `DeletionProtection: ACTIVE` mean the rollback KEEPS the pool — so each retry
  // leaves another deletion-protected orphan behind it.
  it('refuses an empty or non-us-east-1 certificate before it creates anything', () => {
    const p = user.Parameters?.AuthCertificateArn as {
      MinLength?: number;
      AllowedPattern?: string;
    };
    expect(p?.MinLength).toBe(1);
    expect(p?.AllowedPattern).toContain('us-east-1');
    const pattern = new RegExp(p.AllowedPattern as string);
    expect(pattern.test('')).toBe(false);
    expect(pattern.test('arn:aws:acm:eu-north-1:123456789012:certificate/abc')).toBe(false);
    expect(pattern.test('arn:aws:acm:us-east-1:123456789012:certificate/abc')).toBe(true);
  });

  // The template comment says what these must not be, so something has to hold them to it:
  // a client with no callback cannot complete a managed-login redirect at all.
  it('gives the client somewhere to come back to', () => {
    expect(props('UserPoolClient').CallbackURLs).toBeDefined();
    expect(props('UserPoolClient').LogoutURLs).toBeDefined();
    expect(props('UserPoolClient').PreventUserExistenceErrors).toBe('ENABLED');
  });

  // `OFF` is a YAML 1.1 BOOLEAN, and CloudFormation's parser reads it as one unless it is
  // quoted — which would send `false` where a string is required.
  it('keeps MFA off as a string rather than a YAML boolean', () => {
    expect(props('UserPool').MfaConfiguration).toBe('OFF');
    expect(props('UserPool').WebAuthnUserVerification).toBe('required');
    expect(props('UserPool').AutoVerifiedAttributes).toEqual(['email']);
  });

  // NO `app` TAG ON THE POOL, deliberately. That tag is the backup decision — the AWS Backup
  // selection matches `app=quirenote` and puts what it matches in a Locked vault — and a
  // Cognito pool is not a selectable type, so tagging it would say something true of nothing.
  it('leaves the backup tag to the resource backups can take', () => {
    expect(props('UserPool').UserPoolTags).toBeUndefined();
    expect(props('UserPool').Tags).toBeUndefined();
  });
});
