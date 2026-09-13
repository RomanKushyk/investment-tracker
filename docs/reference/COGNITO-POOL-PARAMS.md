# Cognito — the parameters a pool cannot change, and what it refuses

Rehearsed on a throwaway pool created and deleted the same day, because a wrong answer here is not an edit — it is recreating the pool with users already in it. The shape being checked is pinned under "Auth model" in [`../DECISIONS.md`](../DECISIONS.md): Essentials, one account per email, refresh token in years.

**Three parameters are create-time only, not one.** `UsernameAttributes` is the one the decision names. `UsernameConfiguration` is the one it does not, and leaving it out is what breaks "one account per email". `Schema`'s required flags are the third.

Two sources are quoted throughout and never mixed with what the pool actually did: the developer guide's [Customizing sign-in attributes](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html#user-pool-settings-aliases) and the [`CreateUserPool`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_CreateUserPool.html) / [`UpdateUserPool`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UpdateUserPool.html) API references. **What is changeable is decided by whether `UpdateUserPool` lists the parameter at all** — that is checkable without a pool, and it is the test used below. (`UpdateUserPool`'s sample request is not: it echoes a `DescribeUserPool` body and shows `Arn`, `Name`, `Domain` and `AliasAttributes`, none of which are request parameters.)

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

## The client, and the token validity that is not a pool setting

Access, ID and refresh validity live on the **app client**, not the pool, and are changeable at any time.

```sh
aws cognito-idp create-user-pool-client --region eu-north-1 \
  --user-pool-id "$POOL" --client-name rehearsal-client --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --access-token-validity 60 --id-token-validity 60 --refresh-token-validity 3650 \
  --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days
```

**There is no `years` unit.** `TokenValidityUnits` accepts `seconds`, `minutes`, `hours` and `days` only, and the refresh maximum is 315360000 seconds — so **3650 days is the ceiling**, and "refresh token in years" is spelled that way or not at all. Access and ID cap at 86400 seconds; 60 minutes is well inside.

This client is not a template for the real one: its `--explicit-auth-flows` carries no `ALLOW_USER_AUTH`, which is the flow choice-based sign-in — passkeys included — is selected through.

## Four deviations this pool made, which a real one must not copy

| Deviation | Why, here | What a real pool wants |
|---|---|---|
| no `UsernameConfiguration` | to find out what omitting it does | `{ "CaseSensitive": false }`, and it cannot be added later |
| `DeletionProtection: INACTIVE` | a protected pool refuses `DeleteUserPool` with `InvalidParameterException`, and this one had to be deleted the same day | `ACTIVE` |
| no `AutoVerifiedAttributes` | nothing then sends a verification code, so no mail reached a real mailbox — visible above as the missing `CodeDeliveryDetails` | `["email"]` |
| self-service sign-up left open | `SignUp` is the only way to probe the refusal from outside | `AdminCreateUserConfig.AllowAdminCreateUserOnly: true` — "Auth model" makes registration an application, so approval calls `AdminCreateUser` |

That last row limits what was rehearsed: the refusal proved here is `SignUp`'s. In production the call that creates the identity is `AdminCreateUser`, and its behaviour on a duplicate address was not exercised.

## What this does not answer

**Whether a trigger-rejected sign-up costs a monthly active user** — tracked as #61. It could not be answered on this pool in any case: reaching the trigger path needs a pre-sign-up Lambda and its `LambdaConfig`, which this pool did not have.

**Anything about managed login, the hosted domain, or federation.** No domain and no identity provider were configured, so the account-linking trigger is untested.
