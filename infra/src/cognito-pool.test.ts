import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO, skipped } from '../../src/repo-root';
import { PROVIDERS } from './pre-signup';
import { envVars, grantAt, intrinsicAt } from './template-intrinsic';

// THE ONE RESOURCE IN THIS SYSTEM THAT CANNOT BE EDITED INTO CORRECTNESS. Three of the pool's
// parameters are fixed at `CreateUserPool` — `UsernameAttributes`, `UsernameConfiguration` and
// `Schema`'s required flags — and getting one wrong is not an edit, it is recreating the pool
// with users already in it. `docs/reference/COGNITO-POOL-PARAMS.md` is where the rehearsal that
// established them is written down; this file is what holds the template to them.
//
// Parsed the way `stack-split.test.ts` parses: `parseDocument`, asserting `errors` and never
// `warnings`, because every CloudFormation intrinsic is an unresolved tag to a YAML parser.
// `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]` arrives as
// the three-element array `['IsProd', 'a', 'b']`, which is what the paired assertions match —
// and where the tag itself is what matters, `intrinsicAt` reads it off the document node.

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

  // THE RUNNER CAN MINT AN IDENTITY, AND THE GRANT SAYS WHICH POOL'S. Bootstrapping the
  // first super-admin needs a `sub`, which only `AdminCreateUser` produces — so the thing
  // that can rewrite the schema can also create a user. That cost is taken deliberately
  // (it is already the one function invoked by hand and by nothing else) and bounded
  // here: ONE pool, named, never `userpool/*`. Written inline on the function rather than
  // as a separate policy, which the trigger's grant cannot be — `MigrateFunction` is not
  // in the pool's `DependsOn` chain, so naming the pool from it closes no cycle.
  it('lets the runner create a user in one named pool, and nothing wider', () => {
    const policies = props('MigrateFunction').Policies as {
      Statement: Record<string, unknown>[];
    }[];
    // The action matched WHOLE rather than as a substring, which a longer action beginning
    // with this one would satisfy; `Action` is a list here and a bare string elsewhere.
    const mints = (s: Record<string, unknown>) =>
      [s.Action].flat().includes('cognito-idp:AdminCreateUser');
    const policy = policies.findIndex((p) => p.Statement.some(mints));
    expect(policy).toBeGreaterThanOrEqual(0);
    const statement = policies[policy].Statement.findIndex(mints);
    expect(statement).toBeGreaterThanOrEqual(0);
    // THE POOL, AS THE INTRINSIC. `toJS()` discards the tag and keeps the value, so a pinned
    // `UserPool.Arn` reads identically here and deploys a statement matching no ARN at all —
    // and the exact match is also what says this is one pool rather than `userpool/*`.
    expect(
      intrinsicAt(
        doc,
        'Resources',
        'MigrateFunction',
        'Properties',
        'Policies',
        policy,
        'Statement',
        statement,
        'Resource',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserPool.Arn' });
    // And the pool id reaches the handler as an environment variable, since the event
    // carries no pool for a hand-typed invoke the way a Cognito trigger's does.
    expect(intrinsicAt(doc, ...envVars('MigrateFunction'), 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
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

  // A PUBLIC CLIENT. The SPA cannot hold a secret, and a client with one makes every
  // browser-side call fail on a missing SECRET_HASH rather than on anything that names itself.
  it('generates no client secret', () => {
    expect(props('UserPoolClient').GenerateSecret).toBe(false);
  });

  // ONE DAY ABSOLUTE, which answers the three refresh requirements the browser BCP singles out —
  // two of them alternatives, the third a flat MUST NOT. "MUST either set a maximum lifetime on
  // refresh tokens OR expire if the refresh token has not been used within some amount of time"
  // is answered by the bound, so Cognito having no inactivity expiry is not a gap; the idle
  // timeout general practice pairs with a cap is the session cookie's and belongs to #162. The
  // section incorporates RFC 9700's refresh-token recommendations besides, and what a server
  // does on a detected replay is open against this pool — `COGNITO-POOL-PARAMS.md` holds it.
  //
  // Access and ID stay at 60 minutes. An access token's life governs authentication freshness
  // only and never what the holder may do — `authorize.ts` reads `status` and `role` from
  // `app_user` on every request — so shortening it would buy nothing.
  //
  // FIELD BY FIELD RATHER THAN `toMatchObject`, which passed while every one of these could go
  // missing. `TokenValidityUnits` is compared whole for the same reason: a dropped unit silently
  // re-defaults, and the default for a refresh token is DAYS, which would read 24 days.
  it('holds a refresh token for a day and access tokens for an hour', () => {
    const client = props('UserPoolClient');
    expect(client.RefreshTokenValidity).toBe(24);
    expect(client.AccessTokenValidity).toBe(60);
    expect(client.IdTokenValidity).toBe(60);
    expect(client.TokenValidityUnits).toEqual({
      RefreshToken: 'hours',
      AccessToken: 'minutes',
      IdToken: 'minutes',
    });
  });

  // THE GRACE PERIOD IS 60 SECONDS AND NOT 0, for a reason the SPA creates: the access token is
  // held in memory, so every page load refreshes, and two tabs opening together race. AWS
  // provides the window for exactly that — at 0 "a successful request immediately invalidates
  // the submitted refresh token", which would sign one of the two tabs out.
  it('rotates the refresh token, with a window for the second tab', () => {
    expect(props('UserPoolClient').RefreshTokenRotation).toEqual({
      Feature: 'ENABLED',
      RetryGracePeriodSeconds: 60,
    });
  });

  // STATED, NOT INHERITED. Revocation defaults on for a new client, so this line changes
  // nothing today and asserts that nobody turns it off later — the difference between a
  // property that is true and a property that happens to be true.
  it('states that a token can be revoked', () => {
    expect(props('UserPoolClient').EnableTokenRevocation).toBe(true);
  });

  // THE WHOLE LIST, because a `toContain` on one entry let the other two move unwatched.
  // `ALLOW_REFRESH_TOKEN_AUTH` is ABSENT and that is rotation's doing, not an oversight: AWS
  // refuses the pair — "you must disable this authentication flow in your app client". Which
  // path replaces it is recorded as unsettled in `docs/reference/COGNITO-POOL-PARAMS.md`, since
  // AWS says it two ways. Nothing calls refresh yet, so removing the flow breaks no caller.
  it('offers selection-based sign-in and SRP, and no refresh flow', () => {
    expect(props('UserPoolClient').ExplicitAuthFlows).toEqual([
      'ALLOW_USER_AUTH',
      'ALLOW_USER_SRP_AUTH',
    ]);
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
  // keeps the value, so the parsed assertion above cannot tell the two apart.
  //
  // A `DependsOn` would be the wrong instrument rather than a second-best one: the provider
  // is conditional, and naming a resource that may not exist is an error in itself.
  it('depends on the provider rather than naming it in a string', () => {
    // Inside the `!If`'s middle arm, which the assertion above pins as the shape: the arm is
    // a sequence, and its second entry is the one that has to resolve rather than be typed.
    expect(
      intrinsicAt(
        doc,
        'Resources',
        'UserPoolClient',
        'Properties',
        'SupportedIdentityProviders',
        1,
        1,
      ),
    ).toEqual({ tag: '!Ref', value: 'GoogleIdentityProvider' });
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
    expect(
      intrinsicAt(doc, 'Resources', 'UserPool', 'Properties', 'LambdaConfig', 'PreSignUp'),
    ).toEqual({ tag: '!GetAtt', value: 'PreSignUpFunction.Arn' });
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
    const granted = JSON.stringify(policy?.Properties?.PolicyDocument);
    expect(granted).toContain('cognito-idp:AdminLinkProviderForUser');
    expect(granted).toContain('cognito-idp:ListUsers');
    // THE POOL AS THE INTRINSIC, which a text match cannot be: `toContain('UserPool.Arn')` reads
    // the same with the `!GetAtt` gone, and the literal deploys a grant matching no ARN — so the
    // trigger fails on `ListUsers` and every federated sign-in is refused. The exact match is
    // also what says this is ONE pool rather than `userpool/*`, which is the reach a separate
    // policy resource exists to avoid.
    // BOTH ACTIONS, not only the first. They share one statement today, so one read would cover
    // them — but "this pool and no other" is a claim about the grant that ATTACHES an identity as
    // much as about the one that finds it, and splitting them into two statements is an edit
    // nothing here would notice.
    const statements = [
      'Resources',
      'PreSignUpPolicy',
      'Properties',
      'PolicyDocument',
      'Statement',
    ];
    // AND ONE STATEMENT, so "on this pool alone" is a claim about the POLICY rather than about the
    // two actions read below: a third action on a wider resource is found by neither of them.
    const document = policy?.Properties?.PolicyDocument as { Statement: unknown[] };
    expect(document.Statement).toHaveLength(1);
    for (const action of ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser']) {
      expect([action, grantAt(doc, statements, action)]).toEqual([
        action,
        { tag: '!GetAtt', value: 'UserPool.Arn' },
      ]);
    }
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

// The lifetime was load-bearing for two decisions and it is not any more, so the prose that
// leaned on it has to go with it — this repository reviews prose as factual claims, and a
// shortened token otherwise leaves every one of them false. Both conclusions survive on
// arguments that hold at ANY lifetime: authorization belongs to the API because a claim stamped
// at issue time is never current, and that is the same reason a group in a token cannot carry
// the role.
//
// THE NEEDLES ARE BUILT FROM PARTS so this file does not match itself. Spelling either one out
// here would make the guard pass by describing its own text, which is the failure mode a
// grep-shaped test has.
describe('nothing explains itself by a lifetime that is gone', () => {
  // CASE-FOLDED, and the miss that taught it was this file's own retired comment, which spelled
  // the unit in caps — so a lower-cased needle was blind to the guard's own file. The bare
  // number is a needle by itself because the spellings a revert actually produces are a
  // property and a CLI flag, neither of which carries a word to match on.
  const NEEDLES = ['36' + '50', 'refresh token ' + 'lasts years', 'token that ' + 'lasts years'];

  // The retired sentences, verbatim, as the positive control for EVERY needle — the text that
  // used to be in the tree, so a needle that no longer matches it has been mistyped. It lives in
  // a `.txt` the walk does not read: held inline it would make this file the guard's own first
  // offender, and exempting this file would blind the guard to itself, which is the miss the
  // control exists to catch.
  const RETIRED = readFileSync(
    new URL('./__fixtures__/retired-lifetime-prose.txt', import.meta.url),
    'utf8',
  ).toLowerCase();

  // `docs/reference/COGNITO-POOL-PARAMS.md` is EXEMPT and that is not a loophole. It records
  // what Cognito permits — the ceiling, and the exact CLI call the rehearsal made — which is a
  // measured fact about the product rather than a reason for our own number. Deleting it would
  // lose the measurement that told us the ceiling exists.
  const EXEMPT = 'docs/reference/COGNITO-POOL-PARAMS.md';

  // `skipped` rather than a local list, so this walk cannot start reading a nested checkout
  // under `.claude/worktrees/` and reporting its copies as offenders.
  const walk = (dir: string): string[] =>
    readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
      // `.tsx` is most of `src/` and `\.ts$` does not match it — the trailing x defeats the
      // anchor. `.sql` because `infra/migrations/**` carries the same comment-heavy prose.
      return /\.(tsx?|md|ya?ml|sql)$/.test(e.name) ? [rel] : [];
    });

  const searched = ['docs', 'infra', 'src'].flatMap(walk);
  const hits = (file: string) => {
    const text = readFileSync(join(REPO, file), 'utf8').toLowerCase();
    return NEEDLES.filter((n) => text.includes(n));
  };

  // THE TWO WAYS THE GUARD BELOW PASSES WITHOUT CHECKING ANYTHING, closed before it runs: a
  // walk that returned nothing, and a needle that matches nothing because its concatenation was
  // mistyped. Without these the guard's own blindness is indistinguishable from a clean tree.
  it('is actually looking, and every needle actually matches', () => {
    expect(searched.length).toBeGreaterThan(200);
    expect(searched.some((f) => f.endsWith('.tsx'))).toBe(true);
    expect(searched).toContain(EXEMPT);
    // Every needle, against the text that used to be here — one anchor per needle rather than
    // one anchor standing in for three.
    expect(NEEDLES.filter((n) => !RETIRED.includes(n))).toEqual([]);
  });

  it('carries no sentence anywhere that reasons from the old lifetime', () => {
    const offenders = searched.filter((f) => f !== EXEMPT && hits(f).length > 0);
    expect(offenders).toEqual([]);
  });

  it('still rejects a group in the token as the role, and on the durable argument', () => {
    const decisions = readFileSync(join(REPO, 'docs/DECISIONS.md'), 'utf8');
    // The topic spells it "Cognito groups", in prose, where the code spells it `cognito:groups`.
    const entry = /Cognito groups as the role[^·]*/.exec(decisions)?.[0] ?? '';
    expect(entry).not.toBe('');
    // The verdict rests on status and role being APPLICATION state — one place, which a group
    // would duplicate — and not on how long a token lives. Freshness is the secondary point and
    // belongs to the ID and access tokens, which last an hour; the entry once put it on the
    // refresh token, which never carried a group at all.
    expect(entry).toMatch(/application state/);
    expect(entry).toMatch(/hour/);
  });

  // THE ROOT CAUSE OF THREE REVIEW ROUNDS, closed structurally rather than by editing a third
  // copy. One compliance claim lives in three files in three phrasings — a decision topic, a
  // template comment and a comment here — and nothing bound them, so each round narrowed one
  // copy and left the others asserting what had just been corrected. The claim is bounded: the
  // BCP's §6.3.2.3 singles three requirements out and incorporates RFC 9700 besides, so a
  // statement of unqualified compliance is wrong wherever it appears.
  it('claims only what was checked about the BCP, in every file that mentions it', () => {
    // Concatenated for the reason NEEDLES is: spelled out, this list would be the first thing
    // the guard found, in the guard.
    const OVERCLAIM = ['bcp ' + 'whole', 'bcp ' + 'outright', 'meets the ' + 'bcp'];
    // READ AS SENTENCES, NOT LINES, and two things break that. Every one of these files is
    // hand-wrapped and `.md` is prettier-ignored, so `DECISIONS.md` wraps this very claim
    // between "browser" and "BCP"; and in the template and here the wrap carries a comment
    // marker, so collapsing whitespace alone leaves "singles # out". Strip the marker, then
    // collapse — a phrase guard over commented prose needs both or it reports a clean file.
    const prose = (f: string) =>
      readFileSync(join(REPO, f), 'utf8')
        .toLowerCase()
        .replace(/^[ \t]*(#|\/\/)[ \t]?/gm, '')
        .replace(/\s+/g, ' ');
    const mentions = searched.filter((f) => /browser-based-apps|browser bcp/.test(prose(f)));
    // A floor, because "no file mentions it" would otherwise pass every assertion below.
    expect(mentions.length).toBeGreaterThanOrEqual(3);
    for (const f of mentions) {
      const text = prose(f);
      expect([f, OVERCLAIM.filter((p) => text.includes(p))]).toEqual([f, []]);
      // Every site says which three it answers, and that the section binds more than three.
      expect([f, text.includes('singles out')]).toEqual([f, true]);
      expect([f, /rfc 9700/.test(text)]).toEqual([f, true]);
    }
  });

  it('records that the idle half of the practice is not Cognito to give', () => {
    // Scoped to the Auth model topic rather than the whole file, which any future use of the
    // word anywhere would have satisfied.
    const auth = /## Auth model[\s\S]*?\n## /.exec(
      readFileSync(join(REPO, 'docs/DECISIONS.md'), 'utf8'),
    )?.[0];
    expect(auth).toMatch(/no inactivity expiry/i);
  });
});
