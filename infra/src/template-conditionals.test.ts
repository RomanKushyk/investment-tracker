import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMap, parseDocument, type Document } from 'yaml';
import { envVars, tagAt, taggedCollections } from './template-intrinsic';

// EVERY TAGGED COLLECTION IN THE USER STACK, HELD AS ONE SET — the seven intrinsics defining
// its three conditions, and the thirteen values that read one. `toJS()` renders
// `!If [IsProd, a, b]` as `['IsProd', 'a', 'b']` — the identical array an untagged sequence
// written the same way renders to — so every assertion elsewhere in this suite reads the arms
// and not one of them can see the tag.
//
// THE CONDITIONS ARE THE SAME HAZARD ONE LEVEL UP, which is why this set is not the `!If`
// alone: `!Equals`, `!Not` and `!And` are sequences too, so `IsProd: [!Ref Environment, prod]`
// is what `IsProd: !Equals [!Ref Environment, prod]` collapses to — a collapse this suite reads
// a condition through in `stack-split.test.ts` for `IsProd` and in `cognito-pool.test.ts` for
// `IsRegistrationOpen`. `IsProd` alone decides the backup tag, the hostnames and the CORS
// block. Held by SHAPE and not by a list of tag names, so an `!Or` or a `!Select` added later
// cannot land outside the guard.
//
// WHY A SET AND NOT AN ASSERTION BESIDE EACH VALUE. A guard written at the site catches an
// intrinsic REMOVED and never one ADDED, and three of these had no assertion on their arms to
// sit beside: `Outputs.AuthDomain.Value` had none at all, and `CallbackURLs` and `LogoutURLs`
// had `toBeDefined()`. Derived from the document, the list cannot go quietly stale either — a
// hand-kept inventory of the handlers' answers did exactly that inside one milestone
// (`openapi.test.ts`).
//
// WHAT THIS DOES NOT DO: it pins that the tag is there, never which condition an entry reads,
// which way its arms point, or what a condition compares. Of the thirteen values, ten have
// their arms held by another test and the three named above have no assertion on theirs; of the
// conditions, `stack-split.test.ts` pins `IsProd`'s operands and `cognito-pool.test.ts` pins
// `IsRegistrationOpen`'s, while `HasGoogle`'s are reached only through a substring. Closing any
// of that is its own change.
//
// THE DEPLOY IS NOT THE BACKSTOP, which is why this is a test and not a note. The only thing
// standing before the deploy is the SAM transform, and SAM rewrites only its own resources and
// type-checks fewer properties still: with a tag removed it refuses `CorsConfiguration` and
// passes every other one straight through — a Lambda environment variable among them, which
// then reaches CloudFormation as a list. `docs/DECISIONS.md`, **Review, gates, tests**.

const read = (name: string) =>
  parseDocument(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const user = read('template-user.yaml');
const archive = read('template.yaml');

// IN DOCUMENT ORDER, which is what `taggedCollections` returns and what makes this readable
// against the file: the conditions first, where the template defines them above `Resources`,
// then the values that read one. Every entry says what it switches or what it decides,
// because a path alone does not.
const INTRINSICS: readonly (readonly [readonly (string | number)[], string])[] = [
  // WHICH ENVIRONMENT THIS IS, derived from the parameter and never passed alongside it. Nine
  // of the thirteen values below read it — the backup tag, the hostnames and the CORS block
  // among them — and so does every resource-level `Condition:` in the stack bar the Google
  // provider's.
  [['Conditions', 'IsProd'], '!Equals'],
  // THE HALF-OPEN DOOR, the one switch. Its three consumers are in the set below.
  [['Conditions', 'IsRegistrationOpen'], '!Equals'],
  // BOTH OF GOOGLE'S CREDENTIALS, each held non-empty: `!And` over two `!Not [!Equals …]`.
  // Nested, so the tag dropped at any of the five leaves the arms reading exactly as they do.
  [['Conditions', 'HasGoogle'], '!And'],
  [['Conditions', 'HasGoogle', 0], '!Not'],
  [['Conditions', 'HasGoogle', 0, 0], '!Equals'],
  [['Conditions', 'HasGoogle', 1], '!Not'],
  [['Conditions', 'HasGoogle', 1, 0], '!Equals'],
  // The backup selection. `app=quirenote` is what the AWS Backup selection matches on, and it
  // selects into `quirenote-backups`, a LOCKED vault with a 35-day floor; dev's tag is out.
  [['Resources', 'UserCluster', 'Properties', 'Tags', 0, 'Value'], '!If'],
  // The passkey relying party: the environment's own apex, which covers both the auth host
  // below and the SPA's own origin — a suffix of the first, equal to the second.
  [['Resources', 'UserPool', 'Properties', 'WebAuthnRelyingPartyID'], '!If'],
  // THE HALF-OPEN DOOR, first consumer. The arms point the opposite way to the trigger's below.
  [
    ['Resources', 'UserPool', 'Properties', 'AdminCreateUserConfig', 'AllowAdminCreateUserOnly'],
    '!If',
  ],
  // Google is added to the client only when both of its credentials arrived.
  [['Resources', 'UserPoolClient', 'Properties', 'SupportedIdentityProviders'], '!If'],
  // Where managed login sends the browser back to — block form, no safer than the flow form.
  [['Resources', 'UserPoolClient', 'Properties', 'CallbackURLs', 0], '!If'],
  // And where it sends the browser after sign-out.
  [['Resources', 'UserPoolClient', 'Properties', 'LogoutURLs', 0], '!If'],
  // The managed-login hostname, first of the two places that must agree: the domain the pool
  // actually serves it from.
  [['Resources', 'UserPoolDomain', 'Properties', 'Domain'], '!If'],
  // THE HALF-OPEN DOOR, second consumer — the pre-sign-up refusal.
  [[...envVars('PreSignUpFunction'), 'OPEN_REGISTRATION'], '!If'],
  // The condition is on the WHOLE CORS block and both arms are complete, which is what stops
  // SAM dropping the methods and the headers. `public-api.test.ts` holds each arm to them.
  [['Resources', 'PublicApi', 'Properties', 'CorsConfiguration'], '!If'],
  // The API hostname the custom domain is created under.
  [['Resources', 'PublicApi', 'Properties', 'Domain', 'DomainName'], '!If'],
  // THE HALF-OPEN DOOR, third consumer: the approve handler reads the same switch as the
  // trigger, so a row is written for whoever got in while the door was open.
  [[...envVars('ApproveFunction'), 'OPEN_REGISTRATION'], '!If'],
  // The managed-login hostname, second place: the output it is published under.
  [['Outputs', 'AuthDomain', 'Value'], '!If'],
  // The API hostname again, as the NAME a Cloudflare record is created for. That record's
  // TARGET is a different output, `ApiDomainRegionalTarget`, which carries no condition.
  [['Outputs', 'ApiDomain', 'Value'], '!If'],
];

const shown = (path: readonly (string | number)[]) => path.join('.');

// How many resources a stack declares, read off the NODE — a `Resources` that is a string or a
// list is not a count of anything, and both render as something `Object.keys` will happily size.
const resourceCount = (doc: Document) => {
  const node = doc.get('Resources', true);
  return isMap(node) ? node.items.length : 0;
};

describe('every conditional in the user stack is an intrinsic and not a list spelt like one', () => {
  // THE ANCHOR THE OTHER TEMPLATE FILES OPEN WITH, both halves of it. `errors` alone says
  // nothing about whether a file is a template: a GUTTED one — the line `Resources:` by itself,
  // or `Resources: hello` — parses with none. What slips through on that is the ARCHIVE's
  // assertion, `carries none` below, because a gutted file derives the empty set that one is
  // looking for. The user stack is caught anyway, by the twenty. `Resources` is what says a
  // file is actually here.
  //
  // COUNTED ON THE NODE, not merely defined and not counted on `toJS()`. The gutted file renders
  // as `{ Resources: null }`, which `toBeDefined()` accepts — only `undefined` fails it — and
  // `Object.keys` over the rendered value is no better, counting the five characters of
  // `hello`. The node is the only one of the three that knows a map from a string.
  it('parses, and both stacks are in it', () => {
    expect(user.errors).toEqual([]);
    expect(archive.errors).toEqual([]);
    expect(resourceCount(user)).toBeGreaterThan(0);
    expect(resourceCount(archive)).toBeGreaterThan(0);
    // THE COUNT'S OWN CLAIM, against the two spellings a rendered value gets wrong.
    expect(resourceCount(parseDocument('Resources:\n'))).toBe(0);
    expect(resourceCount(parseDocument('Resources: hello\n'))).toBe(0);
  });

  // BOTH DIRECTIONS IN ONE ASSERTION. A tag deleted takes its entry out of the derived set; a
  // tagged collection added anywhere, of any kind, puts a new one in — and a tag CHANGED moves
  // the pair rather than the path. None of the three can pass without this list being edited.
  // THE TAG FORM, which is the only forgeable one: the long form renders as the OBJECT
  // `{'Fn::If': [...]}`, so dropping its key changes what every arm assertion reads and none
  // of this is needed to catch it. A long-form conditional is therefore not in this set.
  // THE RAW PATHS, not their joined spellings: joined, `['A', 'b.c']` and `['A', 'b', 'c']`
  // read alike, and a segment written `'0'` where the document has the index `0` would pass —
  // `getIn` resolves either against a sequence.
  it('carries exactly the twenty written here', () => {
    expect(taggedCollections(user)).toEqual(INTRINSICS);
  });

  // A DIAGNOSTIC RATHER THAN A SECOND DETECTION, and worth its three lines on that ground: an
  // entry that is misspelt or points at nothing throws NAMING THE PATH, where the assertion
  // above would only show two lists that differ somewhere.
  it('reads the tag written beside each of them', () => {
    for (const [path, tag] of INTRINSICS) {
      expect([shown(path), tagAt(user, ...path)]).toEqual([shown(path), tag]);
    }
  });

  // So that "twenty" is a fact about the backend and not about one of its two templates. The
  // archive stack takes no environment — it is one cluster for every branch — so it has no
  // conditions to define and nothing that reads one. Its intrinsics are all SCALARS, which is
  // what makes this an assertion about that template rather than about an empty walk.
  it('and the archive stack carries none', () => {
    expect(taggedCollections(archive)).toEqual([]);
  });
});
