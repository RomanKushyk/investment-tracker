import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO, skipped } from '../../src/repo-root';
import { PROVIDERS } from './pre-signup';
import { envVars, grantAt, intrinsicAt } from './template-intrinsic';

// THE ONE RESOURCE IN THIS SYSTEM THAT CANNOT BE EDITED INTO CORRECTNESS. Three of the pool's
// parameters are fixed at `CreateUserPool` — `UsernameAttributes`, `UsernameConfiguration` and
// `Schema`'s required flags — so getting one wrong is not an edit, it is recreating the pool with
// users already in it. `docs/reference/COGNITO-POOL-PARAMS.md` records the rehearsal that
// established them; this file holds the template to them.
//
// `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]` arrives as the
// array `['IsProd', 'a', 'b']`; where the tag is what matters, `intrinsicAt` reads the node.

type Resource = {
  Type: string;
  Condition?: string;
  DependsOn?: string | string[];
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Properties?: Record<string, unknown>;
};
type Template = {
  Parameters?: Record<
    string,
    { Type: string; Default?: string; AllowedValues?: string[]; NoEcho?: boolean }
  >;
  Rules?: Record<
    string,
    { RuleCondition?: unknown; Assertions?: { Assert: unknown; AssertDescription?: string }[] }
  >;
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
const DEV_APEX = 'dev.quirenote.com';
const PROD_APEX = 'quirenote.com';

describe('the pool is created with the parameters it can never be given later', () => {
  it('parses, and the pool is in it', () => {
    expect(doc.errors).toEqual([]);
    expect(user.Resources.UserPool?.Type).toBe('AWS::Cognito::UserPool');
  });

  // Create-time only #1: not in `UpdateUserPool` at all.
  it('signs in by email address', () => {
    expect(props('UserPool').UsernameAttributes).toEqual(['email']);
  });

  // NEVER `AliasAttributes`, and asserted across every resource because the two are alternatives:
  // aliases let several users hold one address and resolve it as "only the last user who verified
  // it can sign in", taking sign-in away from an existing account silently.
  //
  // On the PARSED template, not the raw source — matching the text would also match the comment
  // above the pool that explains why the property is not there.
  it('uses no alias attribute anywhere', () => {
    for (const [id, r] of Object.entries(user.Resources)) {
      expect([id, r.Properties?.AliasAttributes]).toEqual([id, undefined]);
    }
  });

  // Create-time only #2. `DescribeUserPool` returns it ABSENT rather than defaulted, so the
  // effective default can only be observed by signing up twice: one mailbox spelled two ways is
  // one account only if this is sent at creation.
  it('matches an address case-insensitively', () => {
    expect(props('UserPool').UsernameConfiguration).toEqual({ CaseSensitive: false });
  });

  // Create-time only #3 — "You can't change required attributes after you create a user pool", and
  // `Schema` is not an `UpdateUserPool` parameter.
  it('requires the email attribute', () => {
    expect(props('UserPool').Schema).toEqual([
      { Name: 'email', AttributeDataType: 'String', Required: true, Mutable: true },
    ]);
  });

  // Passkeys are not in Lite. Changeable later, unlike the three above.
  it('is on the Essentials tier', () => {
    expect(props('UserPool').UserPoolTier).toBe('ESSENTIALS');
  });

  // A `sam delete` must not be able to destroy the identities the portfolio rows hang off.
  it('is retained and deletion-protected', () => {
    expect(user.Resources.UserPool.DeletionPolicy).toBe('Retain');
    expect(user.Resources.UserPool.UpdateReplacePolicy).toBe('Retain');
    expect(props('UserPool').DeletionProtection).toBe('ACTIVE');
  });

  // Registration is an application, not an open door: approval calls `AdminCreateUser`.
  // [*Auth model*]
  //
  // NAMED FOR WHAT IT ACTUALLY CLOSES, which is `SignUp` and nothing else: with self-registration
  // off, users are still created "by sign-in with federated providers", so any Google account
  // mints a pool identity with no `app_user` row behind it. Closing that path is the pre-sign-up
  // refusal, so calling this test "closes self-service sign-up" would assert what the pool does
  // not do.
  it('closes the SignUp API, which is not the same as closing the door', () => {
    const config = props('UserPool').AdminCreateUserConfig as {
      AllowAdminCreateUserOnly: unknown[];
    };
    expect(config.AllowAdminCreateUserOnly[2]).toBe(true);
  });
});

describe('one parameter opens registration, in both places at once', () => {
  // The half-open door is the failure this shape prevents: driven separately, the pool and the
  // trigger can disagree, and the disagreement has NO symptom. So both read the same condition.
  it('drives the pool and the trigger from the same condition', () => {
    const pool = props('UserPool').AdminCreateUserConfig as { AllowAdminCreateUserOnly: string[] };
    const trigger = (
      props('PreSignUpFunction').Environment as { Variables: Record<string, string[]> }
    ).Variables;
    expect(pool.AllowAdminCreateUserOnly[0]).toBe('IsRegistrationOpen');
    expect(trigger.OPEN_REGISTRATION[0]).toBe('IsRegistrationOpen');
    expect(user.Conditions?.IsRegistrationOpen).toEqual(['OpenRegistration', 'open']);
  });

  // The refusal costs no database, and the GRANT is what makes that true rather than the handler's
  // current imports: this is the one Lambda with no `Policies:` block, its only grant being
  // `PreSignUpPolicy`. Asserted here because a source scan passes for every spelling it missed.
  it('gives the trigger no database of any kind', () => {
    expect(props('PreSignUpFunction')).not.toHaveProperty('Policies');
    const vars = (props('PreSignUpFunction').Environment as { Variables: Record<string, unknown> })
      .Variables;
    expect(vars).not.toHaveProperty('DSQL_ENDPOINT');
    expect(JSON.stringify(vars)).not.toContain('Cluster');
  });

  // Bootstrapping the first super-admin needs a `sub`, which only `AdminCreateUser` produces, so
  // the thing that can rewrite the schema can also create a user — bounded here to ONE pool,
  // named, never a wildcard. Written inline rather than as a separate policy, which the trigger's
  // grant cannot be: `MigrateFunction` is not in the pool's `DependsOn` chain, so it closes no
  // cycle.
  it('lets the runner create a user in one named pool, and nothing wider', () => {
    // ONE statement carrying either action, read whole, on the pool AS THE INTRINSIC; the counts
    // bound a grant carrying neither, which the read passes by.
    const policies = props('MigrateFunction').Policies as { Statement: unknown[] }[];
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(2);
    expect(
      grantAt(
        doc,
        ['Resources', 'MigrateFunction', 'Properties', 'Policies', 0, 'Statement'],
        ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser'],
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserPool.Arn' });
    expect(intrinsicAt(doc, ...envVars('MigrateFunction'), 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
  });

  it('defaults to closed', () => {
    const p = user.Parameters?.OpenRegistration as { Default?: string; AllowedValues?: string[] };
    expect(p?.Default).toBe('closed');
    expect(p?.AllowedValues).toEqual(['closed', 'open']);
  });

  // The two arms point the OPPOSITE ways round, which a shared condition does not guarantee: a
  // copied `!If` would read plausibly and invert one of them.
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
  it('offers a passkey as a first factor, beside a password', () => {
    const factors = (
      props('UserPool').Policies as { SignInPolicy?: { AllowedFirstAuthFactors?: string[] } }
    )?.SignInPolicy?.AllowedFirstAuthFactors;
    expect(factors).toContain('WEB_AUTHN');
    expect(factors).toContain('PASSWORD');
  });

  // A CONFIDENTIAL CLIENT, and that is what keeps every sign-in inside the relay: with a secret,
  // each call needs a `SECRET_HASH` or the secret itself, and only the relay can read it. RFC 10017
  // §6.2.3.1: "the token-mediating backend MUST act as a confidential client". [*Auth model*]
  it('holds a client secret, so no sign-in can skip the relay', () => {
    expect(props('UserPoolClient').GenerateSecret).toBe(true);
    // ONE CLIENT: a second, public one beside it would be the way round.
    expect(
      Object.values(user.Resources).filter((r) => r.Type === 'AWS::Cognito::UserPoolClient'),
    ).toHaveLength(1);
    // The code grant alone: an implicit grant hands tokens to the browser with no secret at all.
    expect(props('UserPoolClient').AllowedOAuthFlows).toEqual(['code']);
  });

  // THE SECRET IS READ AT RUNTIME, NEVER RENDERED: a `!GetAtt UserPoolClient.ClientSecret` in any
  // form would put it in a function's configuration or an output. Read off the parsed template,
  // where the short, long and `!Sub` spellings all leave the attribute's name behind.
  it('reads the client secret nowhere in the template', () => {
    const rendered = JSON.stringify(user);
    expect(rendered).not.toContain('UserPoolClient.ClientSecret');
    expect(rendered).not.toContain('"UserPoolClient","ClientSecret"');
  });

  // The absolute bound answers the three refresh requirements the browser BCP singles out; the
  // section incorporates RFC 9700 besides, so this is no claim about the section. Cognito has no
  // inactivity expiry and that is not a gap. [*Auth model* · docs/reference/COGNITO-POOL-PARAMS.md]
  // Shortening the access token buys nothing: `authorize.ts` reads `status` and `role` per request.
  // Field by field, and `TokenValidityUnits` compared entire — a dropped unit re-defaults, and a
  // refresh token's default unit is DAYS.
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

  // The grace period is not 0: at 0 "a successful request immediately invalidates the submitted
  // refresh token", so a refresh retried after a lost answer signs the user out. It does not settle
  // two tabs racing — measured in `docs/reference/COGNITO-POOL-PARAMS.md`.
  it('rotates the refresh token, with a window for a retried refresh', () => {
    expect(props('UserPoolClient').RefreshTokenRotation).toEqual({
      Feature: 'ENABLED',
      RetryGracePeriodSeconds: 60,
    });
  });

  // Stated, not inherited: revocation defaults on, so this asserts nobody turns it off later.
  it('states that a token can be revoked', () => {
    expect(props('UserPoolClient').EnableTokenRevocation).toBe(true);
  });

  // The whole list: `ALLOW_REFRESH_TOKEN_AUTH` is ABSENT and that is rotation's doing, not an
  // oversight — AWS refuses the pair. The relay refreshes through `GetTokensFromRefreshToken`, the
  // path AWS names for rotation (`docs/reference/COGNITO-POOL-PARAMS.md`).
  it('offers selection-based sign-in and SRP, and no refresh flow', () => {
    expect(props('UserPoolClient').ExplicitAuthFlows).toEqual([
      'ALLOW_USER_AUTH',
      'ALLOW_USER_SRP_AUTH',
    ]);
  });

  // Google's credentials are not in this repository — it is public — so the provider exists only
  // when the deploy switches it on: a pair left out keeps its previous values, never reaching `''`.
  it('adds Google only when the switch says so', () => {
    expect(user.Resources.GoogleIdentityProvider?.Condition).toBe('HasGoogle');
    expect(user.Parameters?.GoogleClientSecret?.NoEcho).toBe(true);
    expect(user.Parameters?.GoogleClientId?.Default).toBe('');
    expect(user.Conditions?.HasGoogle).toEqual(['GoogleSignIn', 'enabled']);
    // The parameter AS THE INTRINSIC: a literal `GoogleSignIn` reads identically through `toJS()`
    // and compares two constant strings, so Google would be off everywhere.
    expect(intrinsicAt(doc, 'Conditions', 'HasGoogle', 0)).toEqual({
      tag: '!Ref',
      value: 'GoogleSignIn',
    });
    expect(props('UserPoolClient').SupportedIdentityProviders).toEqual([
      'HasGoogle',
      ['COGNITO', 'GoogleIdentityProvider'],
      ['COGNITO'],
    ]);
  });

  it('defaults to off', () => {
    const p = user.Parameters?.GoogleSignIn;
    expect(p?.Default).toBe('disabled');
    expect(p?.AllowedValues).toEqual(['disabled', 'enabled']);
  });

  // A HAND-RUN DEPLOY IS REFUSED as its change set executes, before any resource moves. Creating the
  // change set still succeeds, so a probe that only creates one cannot see this rule.
  it('refuses the switch on without both halves of the pair', () => {
    const rule = user.Rules?.GoogleNeedsBothHalves;
    // A rule cannot read a Condition, so it restates `HasGoogle` and is held equal to it.
    expect(rule?.RuleCondition).toEqual(user.Conditions?.HasGoogle);
    // Each description beside its own assertion: swapped, the refusal names the half that is set.
    expect(rule?.Assertions).toEqual([
      {
        Assert: [['GoogleClientId', '']],
        AssertDescription: 'GoogleSignIn=enabled needs GoogleClientId',
      },
      {
        Assert: [['GoogleClientSecret', '']],
        AssertDescription: 'GoogleSignIn=enabled needs GoogleClientSecret',
      },
    ]);
    const path = ['Rules', 'GoogleNeedsBothHalves'];
    expect(intrinsicAt(doc, ...path, 'RuleCondition', 0)).toEqual({
      tag: '!Ref',
      value: 'GoogleSignIn',
    });
    for (const [i, name] of ['GoogleClientId', 'GoogleClientSecret'].entries())
      expect(intrinsicAt(doc, ...path, 'Assertions', i, 'Assert', 0, 0)).toEqual({
        tag: '!Ref',
        value: name,
      });
  });

  // An unmapped `email_verified` arrives as `undefined`, which the trigger treats as unverified,
  // so Google sign-in would silently stop linking and start making second accounts.
  //
  // A `!Ref` to the provider and the literal `Google` RENDER IDENTICALLY and only one is a
  // dependency: with the literal, CloudFormation derives no ordering and may update the client
  // before creating the provider. `toJS()` cannot tell the two apart. A `DependsOn` is the wrong
  // instrument, not a second-best one — the provider is conditional, and naming a resource that
  // may not exist is an error in itself.
  it('depends on the provider rather than naming it in a string', () => {
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

  // The two halves of the provider's name live in different files and nothing but this test reads
  // both. Google itself cannot drift far, but an OIDC or SAML name is free-form: a mismatch would
  // leave the stack green while every federated sign-in made a second account.
  it('gives the trigger the provider name the template actually creates', () => {
    const name = props('GoogleIdentityProvider').ProviderName as string;
    expect(PROVIDERS).toContain(name);
    // And a name the trigger can parse back out: it splits on the FIRST underscore, while
    // CloudFormation permits one inside a provider name, so `Entra_ID` would satisfy the assertion
    // above and still miss the lookup.
    expect([name, name.includes('_')]).toEqual([name, false]);
  });

  it('maps the verified flag Google asserts', () => {
    expect(props('GoogleIdentityProvider').AttributeMapping).toMatchObject({
      email: 'email',
      email_verified: 'email_verified',
    });
  });
});

describe('managed login runs on a custom domain the relying party can cover', () => {
  // THE RELYING PARTY ID IS EFFECTIVELY PERMANENT: a passkey is registered against one RP ID and a
  // browser will not offer it to any other, so adding a custom domain later "will cause passkey
  // integration for your prefix domain to stop working". The prefix domain is not a stop on the
  // way here but a different, one-way road — hence the custom domain from the first deploy.
  it('serves managed login from the custom domain', () => {
    expect(props('UserPoolDomain').Domain).toEqual(['IsProd', PROD_AUTH, DEV_AUTH]);
    expect(props('UserPoolDomain').ManagedLoginVersion).toBe(2);
    expect(props('UserPoolDomain').CustomDomainConfig).toBeDefined();
  });

  // The APEX, not the auth host: a relying party is matched by registrable suffix, so the apex
  // covers both the managed-login host and the SPA's origin where `auth.<env>` covers only the
  // first. Held as literals — an assertion comparing two fields passes for any pair that agrees.
  it('sets the relying party to the environment apex', () => {
    expect(props('UserPool').WebAuthnRelyingPartyID).toEqual(['IsProd', PROD_APEX, DEV_APEX]);
  });

  // The literals pin the VALUE; this pins the RELATION, which they cannot see: each surface must be
  // EQUAL TO the RP ID or a subdomain of it — the auth host takes the subdomain branch and the SPA
  // origin the equality branch, in both arms. An inconsistent move — `quirenote.app` with the hosts
  // left on `quirenote.com` — satisfies the literals once edited and fails here.
  //
  // Plain suffix, not the PUBLIC-suffix rule: `amplifyapp.com` satisfies this predicate and no
  // browser would accept it. What keeps a public suffix out is the pair of literals above.
  it('keeps the relying party equal to or a suffix of both surfaces', () => {
    const covers = (host: string, rp: string) => host === rp || host.endsWith(`.${rp}`);
    const arm = (v: unknown, i: number) => (v as string[])[i];
    const callbacks = props('UserPoolClient').CallbackURLs as unknown[];
    expect(callbacks).toHaveLength(1);
    // The arms below are read POSITIONALLY, so the condition has to be the environment one:
    // `template-conditionals.test.ts` pins that this carries `!If`, never which condition it reads.
    expect(arm(callbacks[0], 0)).toBe('IsProd');
    for (const [env, i] of [
      ['prod', 1],
      ['dev', 2],
    ] as const) {
      const rp = arm(props('UserPool').WebAuthnRelyingPartyID, i);
      const authHost = arm(props('UserPoolDomain').Domain, i);
      const origin = new URL(arm(callbacks[0], i)).hostname;
      expect([env, covers(authHost, rp), covers(origin, rp)]).toEqual([env, true, true]);
    }
  });

  // Cognito requires an app client before a custom domain and CloudFormation cannot know that.
  it('creates the client before the domain', () => {
    expect(user.Resources.UserPoolDomain.DependsOn).toContain('UserPoolClient');
  });

  // A domain without a style serves a broken page: branding version 2 does not fall back to the
  // classic UI, it fails — a green stack and an endpoint nobody can sign in through.
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

  // THE CYCLE, AND THE TWO PLACES IT IS BROKEN: the pool names the function, so nothing the pool
  // depends on may name the pool. The invoke permission is scoped by `SourceAccount` instead of
  // `SourceArn` and the pool waits on it; the IAM grant is a SEPARATE policy resource, created
  // after both, which is what lets it keep the real pool ARN rather than a wildcard over every
  // pool in the account.
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
    // The pool AS THE INTRINSIC, which `toContain('UserPool.Arn')` cannot see; BOTH ACTIONS IN ONE
    // READ, so a third beside them, or the two split into two statements, fails it.
    const statements = [
      'Resources',
      'PreSignUpPolicy',
      'Properties',
      'PolicyDocument',
      'Statement',
    ];
    // And ONE statement: a second carrying neither action, on a wider resource, is read past below.
    const document = policy?.Properties?.PolicyDocument as { Statement: unknown[] };
    expect(document.Statement).toHaveLength(1);
    expect(
      grantAt(doc, statements, ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser']),
    ).toEqual({ tag: '!GetAtt', value: 'UserPool.Arn' });
  });
});

describe('the stack still takes its environment the way it did', () => {
  // The ARN carries the account id, so it is a parameter rather than a literal — this repo is
  // public.
  it('takes the certificate as a parameter with no default', () => {
    expect(user.Parameters?.AuthCertificateArn?.Type).toBe('String');
    expect(user.Parameters?.AuthCertificateArn).not.toHaveProperty('Default');
  });

  // And CONSTRAINS it: an unset secret renders as the empty string, which an unconstrained String
  // accepts. `Retain` plus `DeletionProtection: ACTIVE` mean the rollback KEEPS the pool, so each
  // retry leaves another deletion-protected orphan behind it.
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

  it('gives the client somewhere to come back to', () => {
    expect(props('UserPoolClient').CallbackURLs).toBeDefined();
    expect(props('UserPoolClient').LogoutURLs).toBeDefined();
    expect(props('UserPoolClient').PreventUserExistenceErrors).toBe('ENABLED');
  });

  // `OFF` is a YAML 1.1 BOOLEAN unless quoted, which would send `false` where a string is required.
  it('keeps MFA off as a string rather than a YAML boolean', () => {
    expect(props('UserPool').MfaConfiguration).toBe('OFF');
    expect(props('UserPool').WebAuthnUserVerification).toBe('required');
    expect(props('UserPool').AutoVerifiedAttributes).toEqual(['email']);
  });

  // No `app` tag on the pool, deliberately: that tag is the backup selection, and a Cognito pool is
  // not a selectable type, so tagging it would say something true of nothing.
  it('leaves the backup tag to the resource backups can take', () => {
    expect(props('UserPool').UserPoolTags).toBeUndefined();
    expect(props('UserPool').Tags).toBeUndefined();
  });
});

// The lifetime was load-bearing for two decisions and is not any more, so the prose that leaned on
// it goes with it: this repository reviews prose as factual claims. Both conclusions survive on
// arguments that hold at ANY lifetime — a claim stamped at issue time is never current.
//
// THE NEEDLES ARE BUILT FROM PARTS so this file does not match itself: spelling one out here would
// make the guard pass by describing its own text, the failure mode a grep-shaped test has.
describe('nothing explains itself by a lifetime that is gone', () => {
  // CASE-FOLDED: a lower-cased needle was once blind to this file's own retired comment. The bare
  // number is a needle by itself because a revert produces a property and a CLI flag, neither of
  // which carries a word to match on.
  const NEEDLES = ['36' + '50', 'refresh token ' + 'lasts years', 'token that ' + 'lasts years'];

  // The retired sentences verbatim, as the positive control for EVERY needle: a needle that no
  // longer matches them has been mistyped. Held in a `.txt` THE WALK DOES NOT READ — inline it
  // would make this file the guard's own first offender, and exempting the file would blind the
  // guard to itself.
  const RETIRED = readFileSync(
    new URL('./__fixtures__/retired-lifetime-prose.txt', import.meta.url),
    'utf8',
  ).toLowerCase();

  // EXEMPT and not a loophole: it records what Cognito permits, a measured fact about the product
  // rather than a reason for our own number.
  const EXEMPT = 'docs/reference/COGNITO-POOL-PARAMS.md';

  const walk = (dir: string): string[] =>
    readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
      // `.tsx` is most of `src/` and `\.ts$` does not match it — the trailing x defeats the anchor.
      return /\.(tsx?|md|ya?ml|sql)$/.test(e.name) ? [rel] : [];
    });

  const searched = ['docs', 'infra', 'src'].flatMap(walk);
  const hits = (file: string) => {
    const text = readFileSync(join(REPO, file), 'utf8').toLowerCase();
    return NEEDLES.filter((n) => text.includes(n));
  };

  // THE TWO WAYS THE GUARD BELOW PASSES WITHOUT CHECKING ANYTHING: a walk that returned nothing,
  // and a needle that matches nothing because its concatenation was mistyped.
  it('is actually looking, and every needle actually matches', () => {
    expect(searched.length).toBeGreaterThan(200);
    expect(searched.some((f) => f.endsWith('.tsx'))).toBe(true);
    expect(searched).toContain(EXEMPT);
    expect(NEEDLES.filter((n) => !RETIRED.includes(n))).toEqual([]);
  });

  it('carries no sentence anywhere that reasons from the old lifetime', () => {
    const offenders = searched.filter((f) => f !== EXEMPT && hits(f).length > 0);
    expect(offenders).toEqual([]);
  });

  it('still rejects a group in the token as the role, and on the durable argument', () => {
    const decisions = readFileSync(join(REPO, 'docs/DECISIONS.md'), 'utf8');
    // The topic spells it "Cognito groups" in prose, where the code spells it `cognito:groups`.
    // Sliced to the next `·`, which is the separator between Rejected entries.
    const entry = /Cognito groups as the role[^·]*/.exec(decisions)?.[0] ?? '';
    expect(entry).not.toBe('');
    expect(entry).toMatch(/application state/);
    expect(entry).toMatch(/hour/);
  });

  // One compliance claim lives in three files in three phrasings and nothing bound them, so each
  // review round narrowed one copy and left the others asserting what had just been corrected. The
  // claim is bounded, so a statement of unqualified compliance is wrong wherever it appears.
  it('claims only what was checked about the BCP, in every file that mentions it', () => {
    // Concatenated for the reason NEEDLES is: spelled out, this list is the first thing the guard
    // would find, in the guard.
    const OVERCLAIM = ['bcp ' + 'whole', 'bcp ' + 'outright', 'meets the ' + 'bcp'];
    // READ AS SENTENCES, NOT LINES, and two things break that: these files are hand-wrapped, so a
    // claim wraps mid-phrase; and a wrap carries a comment marker, so collapsing whitespace alone
    // leaves "singles # out". STRIP THE MARKER, THEN COLLAPSE — both, or it reports a clean file.
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
    // Scoped to the Auth model topic rather than the whole file, which any use of the word
    // anywhere would have satisfied.
    const auth = /## Auth model[\s\S]*?\n## /.exec(
      readFileSync(join(REPO, 'docs/DECISIONS.md'), 'utf8'),
    )?.[0];
    expect(auth).toMatch(/no inactivity expiry/i);
  });
});
