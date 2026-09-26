# Cognito — the parameters a pool cannot change, and what it refuses

Rehearsed on a throwaway pool created and deleted the same day, because a wrong answer here is not an edit — it is recreating the pool with users already in it. The shape being checked is pinned under "Auth model" in [`../DECISIONS.md`](../DECISIONS.md): Essentials, one account per email, and a bounded refresh token that rotates.

**This file is the one place the retired ten-year spelling still appears, and deliberately so** — the rehearsal's own CLI call and Cognito's documented ceiling are measured facts about the product, not reasons for anything here. The guard in `infra/src/cognito-pool.test.ts` that keeps that spelling out of the rest of the tree exempts this file by name for exactly that reason.

**Three parameters are create-time only, not one.** `UsernameAttributes` is the one the decision names. `UsernameConfiguration` is the one it does not, and leaving it out is what breaks "one account per email". `Schema`'s required flags are the third.

Two sources are quoted throughout and never mixed with what the pool actually did: the developer guide's [Customizing sign-in attributes](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html#user-pool-settings-aliases) and the [`CreateUserPool`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPool.html) / [`UpdateUserPool`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserPool.html) API references. **What is changeable is decided by whether `UpdateUserPool` lists the parameter at all** — checkable without a pool, and the test used below. Its sample request is not: it echoes a `DescribeUserPool` body and shows fields that are not request parameters.

## The calls, verbatim

```json
{
  "PoolName": "quirenote-rehearsal-a54",
  "UsernameAttributes": ["email"],
  "UserPoolTier": "ESSENTIALS",
  "DeletionProtection": "INACTIVE",
  "Schema": [{ "Name": "email", "Required": true }]
}
```

```sh
aws cognito-idp create-user-pool --region eu-north-1 --cli-input-json "$(cat pool.json)"
# and, between the second and third sign-up below — no code was ever delivered,
# so ConfirmSignUp was impossible and only the admin path could confirm the user
aws cognito-idp admin-confirm-sign-up --region eu-north-1 \
  --user-pool-id "$POOL" --username rehearsal-one@quirenote.com
```

## Create-time only, chosen, or defaulted

`DescribeUserPool` read back immediately after creation says which values the pool ended up with. It does **not** say which of them can still change — that comes from `UpdateUserPool`'s parameter list.

| Parameter | Status | Value | Why |
|---|---|---|---|
| `UsernameAttributes` | **CREATE-TIME ONLY** | `["email"]` | "After you create a user pool, you can't change this setting." Not in `UpdateUserPool`. Never `AliasAttributes` — aliases let several users hold one address and resolve it as "only the last user who verified it can sign in" |
| `UsernameConfiguration` | **CREATE-TIME ONLY** | *absent* | "This configuration is immutable after you set it", and not in `UpdateUserPool` either — so a pool that omitted it cannot acquire it. Omitted here on purpose; see the next section |
| `Schema[].Required` | **CREATE-TIME ONLY** | `email` required | "You can't change required attributes after you create a user pool." `Schema` is not an `UpdateUserPool` parameter |
| `PoolName` | chosen | `quirenote-rehearsal-a54` | in `UpdateUserPool` |
| `UserPoolTier` | chosen | `ESSENTIALS` | in `UpdateUserPool`; passkeys are not in Lite |
| `DeletionProtection` | chosen | `INACTIVE` | in `UpdateUserPool`; rehearsal-only, see the deviations |
| `Policies.PasswordPolicy` | defaulted | min 8, upper + lower + number + symbol, temp password 7 days | nothing was sent for it |
| `Policies.SignInPolicy.AllowedFirstAuthFactors` | defaulted, changeable | `["PASSWORD"]` | **passkey-first needs `WEB_AUTHN` here.** `Policies` is an `UpdateUserPool` parameter and AWS's own sample sets `["PASSWORD","EMAIL_OTP","WEB_AUTHN"]`, so this is not a create-time trap |
| `AdminCreateUserConfig` | defaulted, changeable | self-service sign-up open | in `UpdateUserPool`; see the deviations — the real pool closes it |
| `MfaConfiguration` | defaulted | `OFF` | |
| `AliasAttributes` | defaulted | *absent* | not in `UpdateUserPool`; the guide presents it as the alternative to `UsernameAttributes`, and this pool sent neither together |
| `AutoVerifiedAttributes` | defaulted | *absent* | in `UpdateUserPool`; omitted on purpose, see the deviations |

**`UsernameConfiguration` comes back absent, not defaulted.** `DescribeUserPool` reports no value for it when the create call omitted one, so the effective default cannot be read off the pool — it can only be observed by signing up twice.

## What the pool refuses, and what it does not

One pool, one app client, four `SignUp` calls, no verification mail involved. Under username attributes `SignUp` writes a UUID into `username` and the submitted address into `email`, so the column below is the address as submitted, not the resulting username.

| Address signed up with | Pool state at the time | Result |
|---|---|---|
| `rehearsal-one@…` | empty | succeeded · `UserConfirmed: false` · **no `CodeDeliveryDetails`** |
| `rehearsal-one@…` | the above, `UNCONFIRMED` | `UsernameExistsException` — "User already exists" |
| `rehearsal-one@…` | the above, `CONFIRMED` | `UsernameExistsException` — "User already exists" |
| `REHEARSAL-ONE@…` | the above, `CONFIRMED` | **succeeded — a second account, its own `sub`** |

The refusal held in both states, so there is no window in which a duplicate slips through. Observed on this pool, under the deviations below — but the rule does not depend on them: the guide states it without reference to verification, "The email address or phone number must be unique, and it must not already be in use by another user. It doesn't have to be verified."

**The case variation is not refused, and that is the finding.** With `UsernameConfiguration` omitted the pool is case sensitive: `ListUsers` ended with two accounts and `EstimatedNumberOfUsers` read `2`, one mailbox spelled two ways, each with its own `sub`. So "one account per email" does not survive the default, and a pool must send `"UsernameConfiguration": { "CaseSensitive": false }` in the create call.

Note what that flag does and does not do. Case insensitivity is a **matching** rule — Cognito "treats any variation in case as the same user" — not a rewriting one; the address is still stored in the case the user typed it. Anything reading an address back still sees the original case, which is why a writer that must produce one canonical spelling has to lower-case it itself.

The database no longer takes that on trust: `app_user_email_lower_ck` (`infra/migrations/006_email_lower.sql`) refuses an address that is not already lower-cased, so a writer either canonicalises or fails. The division is deliberate — the provider keeps the case the user typed, the database keeps the one spelling everything else joins on.

## The client, and the token validity that is not a pool setting

Access, ID and refresh validity live on the **app client**, not the pool, and are changeable at any time.

```sh
aws cognito-idp create-user-pool-client --region eu-north-1 \
  --user-pool-id "$POOL" --client-name rehearsal-client --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --access-token-validity 60 --id-token-validity 60 --refresh-token-validity 3650 \
  --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days
```

**There is no `years` unit.** `TokenValidityUnits` accepts `seconds`, `minutes`, `hours` and `days` only, and the refresh maximum is 315360000 seconds — so **3650 days is the ceiling**, and a refresh lifetime asked for in years has to be spelled in days. Access and ID cap at 86400 seconds; 60 minutes is well inside.

This client is not a template for the real one: its `--explicit-auth-flows` carries no `ALLOW_USER_AUTH`, which is the flow choice-based sign-in — passkeys included — is selected through. Nor is its refresh validity, nor its missing secret: the shipped client is **24 hours with rotation** and **confidential** — every call carries the secret or its hash, and only the relay (`infra/src/auth-relay.ts`) can read it — and the ceiling above is a fact about the product rather than a setting anything here uses.

### What rotation does, measured on the dev pool with the 60-second grace period — and one question still open

- **The refresh path is `GetTokensFromRefreshToken`.** The developer guide settles what the two references left open: "Refresh token rotation isn't compatible with the authentication flow REFRESH_TOKEN_AUTH … design your application to submit token-refresh requests with the GetTokensFromRefreshToken API operation". The relay (`infra/src/auth-relay.ts`) refreshes that way, with the client secret.
- **A replay outside the window is refused, and revokes nothing.** A rotated-out token answers `RefreshTokenReuseException` ("Refresh token reuse detected"), and the newest token in the same family still refreshes afterwards. So Cognito meets RFC 9700 §4.14.2 only in part: the replay is detected, but the active token is not revoked.
- **Only two tokens end a family when revoked: the live one and the sign-in's original.** After `RevokeToken` on the newest token, it and the original both answer `NotAuthorizedException`. Revoking the original ends every branch: a plain chain, a fork of the original itself, and a fork of a mid-chain token, whose newest child refreshed before the revoke and answers `NotAuthorizedException` after it. Revoking any other rotated-out token, a mid-chain one or a sibling forked inside the window, leaves the newest refreshing. So the relay keeps the original in a cookie of its own, and revokes that on a replay, at sign-out and at the next sign-in.
- **A replay inside the window succeeds, and forks the family.** It mints a second child, and from then on only the newest child refreshes; the first answers `RefreshTokenReuseException`. The window therefore saves a retried request but not two tabs racing: a browser with one cookie keeps whichever answer landed last, so the app must refresh once at a time across tabs rather than lean on the window.
- **Revocation is idempotent.** `RevokeToken` succeeds on a token already revoked and on one that was never issued. Refreshing either answers `NotAuthorizedException`.
- **Open, not measured: whether the managed-login session cookie undoes the bound.** AWS's own pages disagree: one says such sessions "are set in a browser cookie and are valid for one hour", another that they "don't expire automatically, your user can re-authenticate with a session cookie, with no additional prompt for credentials". On the managed-login path that decides whether a twenty-four-hour refresh token actually forces a credential prompt or merely a silent redirect. It is the difference between a bound and a formality.

## Four deviations this pool made, which a real one must not copy

| Deviation | Why, here | What a real pool wants |
|---|---|---|
| no `UsernameConfiguration` | to find out what omitting it does | `{ "CaseSensitive": false }`, and it cannot be added later |
| `DeletionProtection: INACTIVE` | a protected pool refuses `DeleteUserPool` with `InvalidParameterException`, and this one had to be deleted the same day | `ACTIVE` |
| no `AutoVerifiedAttributes` | nothing then sends a verification code, so no mail reached a real mailbox — visible above as the missing `CodeDeliveryDetails` | `["email"]` |
| self-service sign-up left open | `SignUp` is the only way to probe the refusal from outside | `AdminCreateUserConfig.AllowAdminCreateUserOnly: true` — "Auth model" makes registration an application, so approval calls `AdminCreateUser` |

That last row limits what was rehearsed: the refusal proved here is `SignUp`'s. In production the call that creates the identity is `AdminCreateUser`, and its behaviour on a duplicate address was not exercised.

## The pool this produced

Built as `infra/template-user.yaml`, one per environment, and held to the table above by
`infra/src/cognito-pool.test.ts` — so the three create-time-only parameters are now asserted
rather than remembered. What the template adds beyond the rehearsal's four corrections:

| Property | Value | Why it is here rather than later |
|---|---|---|
| `Policies.SignInPolicy.AllowedFirstAuthFactors` | `["PASSWORD", "WEB_AUTHN"]` | the note this file left for whoever built the real pool. Changeable, but a pool that cannot offer the factor onboarding is built around is not worth deploying |
| client `ExplicitAuthFlows` | includes `ALLOW_USER_AUTH` | the other half of the same thing — the flow a passkey is selected through |
| `WebAuthnRelyingPartyID` | the environment's apex | see below; this one is not practically reversible |
| `WebAuthnUserVerification` | `required` | a passkey with user verification already satisfies MFA, which is why `MfaConfiguration` stays `OFF` |
| `LambdaConfig.PreSignUp` | the linking trigger | `infra/src/pre-signup.ts` |

**The relying party ID is the second irreversible decision, and it is not a pool parameter.**
A passkey is registered against one RP ID and no browser will offer it to another. AWS states
that creating a custom domain later "will cause passkey integration for your prefix domain to
stop working due to a mismatch in RP ID" — and a prefix domain cannot be kept as the RP ID once
managed login moves, because `<prefix>.auth.<region>.amazoncognito.com` is not a registrable
suffix of a `quirenote.com` origin. So the prefix domain is not a cheap first step toward a
custom one; it is a different road, and every passkey registered on it is lost at the turn.
The pool therefore ships with the custom domain from its first deploy: `auth.quirenote.com`
and `auth.dev.quirenote.com`, ACM certificate in **us-east-1** whatever region the pool is in,
because the domain is fronted by a CloudFront distribution Cognito builds and owns.

**And the RP ID is the apex rather than the auth host, which forecloses nothing and costs one
thing.** A relying party is matched by registrable suffix, so `quirenote.com` covers
`auth.quirenote.com` and the SPA's own origin at once, where `auth.quirenote.com` would cover only
the first and close off a native `StartWebAuthnRegistration` from the app. Each environment takes
its own apex, so which passkeys a page is OFFERED stays symmetric — a browser keys a credential to
the exact RP ID. **What is one-way is ORIGIN REACH, and that is the cost:** AWS says a passkey "can
authenticate for that domain **and subdomains**", so any origin under `quirenote.com` —
`dev.quirenote.com` included, and any future or dangling name — can ask the browser for a
production passkey, where under `auth.quirenote.com` neither host was a suffix of the other and
that was structurally impossible. Accepted knowingly; what it means in practice is that a subdomain
of the apex is part of the auth surface, and adding one is a decision about credentials as well as
about hosting. The Amplify default hostnames are the other side of it: they are live SPA origins in
`infra/template-user.yaml`'s CORS list, and THIS relying party does not reach them — a different
domain tree, so no value can cover them and `quirenote.com` at once — so a passkey ceremony run
from those URLs cannot work here.

**AWS documents this two ways, and they contradict each other.** The developer guide's
[authentication flows](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html)
page calls the custom domain's FQDN what a pool "defaults to" when you "don't specify otherwise"
and adds that you "can also configure your RP ID to be any domain name not in the public suffix
list (PSL)". The API reference for `WebAuthnConfigurationType` and the CloudFormation reference for
`AWS::Cognito::UserPool` both say the opposite in terms — the RP ID "must be the fully-qualified
domain name of your custom domain" when the pool is configured for passkeys, has a custom domain,
and authenticates through managed login — which is this pool exactly. Which one the service ACCEPTS
was measured, below; the ceremony is the half that measurement does not reach, and it has to be
settled before the first passkey, because changing it strands every one already registered.

**Two things the template cannot finish**, both in `reference/DEPLOYMENT.md`: the Cloudflare
record pointing at that distribution — DNS-only, never proxied — and the fact that until it
exists the stack is green and managed login resolves nowhere.

## What the real pool answered that this one could not

Measured on the deployed dev pool, which has the `UsernameConfiguration` this one omitted.

**`AdminCreateUser` refuses a duplicate, and refuses the case variant too.** The same address
twice gives `UsernameExistsException`; the same mailbox in capitals gives
`UsernameExistsException` as well, where the rehearsal's pool accepted it and ended with two
accounts. That is the one behaviour `CaseSensitive: false` is set at creation to produce, and
it is now observed rather than inferred. It matters that the call is this one: production closes
self-service sign-up, so `SignUp` is no longer what creates an identity.

**Suppressing the message suppresses the password with it.** `AdminCreateUser` with
`MessageAction: SUPPRESS` and no `TemporaryPassword` fails outright —
`InvalidParameterException: User is required to have a password`. Cognito generates a temporary
password only when it has a message to put it in, so any caller that suppresses the invitation
has to supply one.

**Alias resolution does not wait for confirmation, and `Enabled` is independent of `UserStatus`.**
On a throwaway pool carrying the same `UsernameAttributes: ["email"]` and
`UsernameConfiguration: { CaseSensitive: false }`, one `SignUp` left an account `UNCONFIRMED` under
a UUID username. `AdminGetUser` with the ADDRESS as `Username` resolved it and reported
`UserStatus: UNCONFIRMED`, `Enabled: true` — so the alias works before anybody has confirmed
anything, which is what lets approve tell a squatter's claim from a repair. `AdminDisableUser` by
the same address then succeeded, and a re-read returned `UserStatus: UNCONFIRMED`, `Enabled: false`:
**a disabled account keeps its status**, so `UserStatus` alone never says whether an account can be
signed in to. Anything deciding that has to read `Enabled`.

**The username is a UUID even for the accounts `AdminCreateUser` makes, and the address reaches
them by ALIAS.** Under `UsernameAttributes: ["email"]` the pool assigns its own username whatever
created the account, with the address only in the `email` attribute; `AdminGetUser` with the
address as `Username` returns the account anyway — alias resolution on `email`, not a username
match — and an address with no local account answers `UserNotFoundException`. So an admin call by
address reaches every LOCAL account however it was made and never a federated-only profile, which
is named for its provider and subject. Anything inferring "we created this" from the username shape
is wrong.

**`DescribeUserPool` does not report the WebAuthn settings, even when they are set.**
`WebAuthnRelyingPartyID` and `WebAuthnUserVerification` both read back `null` there. They live
behind `GetUserPoolMfaConfig`, as `WebAuthnConfiguration.RelyingPartyId` and
`.UserVerification`. Reading the wrong API makes a set value look absent — the same shape of
mistake as `UsernameConfiguration` reading back absent when omitted, and worth knowing before
anyone "fixes" a relying party that was never missing.

**The config plane does not enforce the FQDN rule two of its own reference pages state.** The dev pool
has a custom domain and authenticates through managed login, so it meets every condition under
which `WebAuthnConfigurationType` and the CloudFormation reference say the RP ID "must be" that
domain's FQDN. `SetUserPoolMfaConfig` took `RelyingPartyId: dev.quirenote.com` on it regardless,
and `GetUserPoolMfaConfig` read the value back unchanged. So the FQDN is a default rather than a
value the config plane refuses to take.

**`SetUserPoolMfaConfig` REPLACES rather than merges, and `required` does not survive an omission.**
Sending `WebAuthnConfiguration` with `RelyingPartyId` alone returned a configuration with no
`UserVerification` field at all, where the call before it had answered `required`. An absent field
is a third state rather than a quiet `preferred`: setting `preferred` EXPLICITLY is echoed back as
`"UserVerification": "preferred"`. Either way the outcome is the one that matters — the setting is
no longer `required`, which is the state the template deploys. The API reference says none of this;
every parameter is merely `Required: No`, and the "sets it to its default value" language belongs
to `UpdateUserPool`, a different call. So the read before the write is not optional — anything
touching this call echoes back the whole object.

**What that measurement does NOT settle:** accepting the string is not the same as running the
ceremony with it. Two gaps remain, both closed by use. The call went through the Cognito API and
not CloudFormation, so the deploy is what says the same of `AWS::Cognito::UserPool`; and no passkey
has been registered through managed login against an apex RP ID here, the only assurance on that
point being the same developer guide the reference pages contradict.

**A pool that allows passkeys does not offer them to a user who has none.** `InitiateAuth` with
`AuthFlow: USER_AUTH` against a password-only user answers `SELECT_CHALLENGE` with
`AvailableChallenges: ["PASSWORD_SRP", "PASSWORD"]` — no `WEB_AUTHN`, despite the pool carrying
it in `AllowedFirstAuthFactors`. The list is per USER, not per pool: a passkey becomes available
once one is registered, and registration takes an access token, so it follows a first sign-in
rather than preceding it. Passkey-first onboarding is therefore an ordering of steps after an
invitation, not a pool setting.

## What this does not answer

**Whether a trigger-rejected sign-up costs a monthly active user** — tracked as #61. It could not be answered on this pool in any case: reaching the trigger path needs a pre-sign-up Lambda and its `LambdaConfig`, which this pool did not have. The real pool has both, so #61 is now answerable where it was not.

**Whether federation links rather than duplicates.** The trigger is deployed and wired, and its
condition and direction are unit-tested (`infra/src/pre-signup.test.ts`) — but a link has not
been exercised against Google itself. It cannot be until a local account exists for an address
to link *to*, and creating one is the approval endpoint's job.
