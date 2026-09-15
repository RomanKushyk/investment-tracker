import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { tagAt, taggedPaths } from './template-intrinsic';

// EVERY CONDITIONAL VALUE IN THE USER STACK, HELD AS ONE SET. `toJS()` renders
// `!If [IsProd, a, b]` as `['IsProd', 'a', 'b']` — the identical array an untagged sequence
// written the same way renders to — so every assertion elsewhere in this suite reads the arms
// and not one of them can see the tag.
//
// WHY A SET AND NOT AN ASSERTION BESIDE EACH VALUE. A guard written at the site catches an
// intrinsic REMOVED and never one ADDED, and three of these had no assertion on their arms to
// sit beside: `Outputs.AuthDomain.Value` had none at all, and `CallbackURLs` and `LogoutURLs`
// had `toBeDefined()`. Derived from the document, the list cannot go quietly stale either — a
// hand-kept inventory of the handlers' answers did exactly that inside one milestone
// (`openapi.test.ts`).
//
// WHAT THIS DOES NOT DO: it pins that the tag is there, never which condition it reads or which
// way its arms point. For the ten whose arms another test holds, that is covered elsewhere; for
// the three named above it is not covered at all, and closing it is its own change.
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

// IN DOCUMENT ORDER, which is what `taggedPaths` returns and what makes this readable against
// the file. Every entry says what its condition switches, because a path alone does not.
const IF_PATHS: readonly (string | number)[][] = [
  // The backup selection. `app=quirenote` is what the AWS Backup selection matches on, and it
  // selects into `quirenote-backups`, a LOCKED vault with a 35-day floor; dev's tag is out.
  ['Resources', 'UserCluster', 'Properties', 'Tags', 0, 'Value'],
  // The managed-login hostname, first of the three places that must agree.
  ['Resources', 'UserPool', 'Properties', 'WebAuthnRelyingPartyID'],
  // THE HALF-OPEN DOOR, first half. The arms point the opposite way to the trigger's below.
  ['Resources', 'UserPool', 'Properties', 'AdminCreateUserConfig', 'AllowAdminCreateUserOnly'],
  // Google is added to the client only when both of its credentials arrived.
  ['Resources', 'UserPoolClient', 'Properties', 'SupportedIdentityProviders'],
  // Where managed login sends the browser back to — block form, no safer than the flow form.
  ['Resources', 'UserPoolClient', 'Properties', 'CallbackURLs', 0],
  // And where it sends the browser after sign-out.
  ['Resources', 'UserPoolClient', 'Properties', 'LogoutURLs', 0],
  // The managed-login hostname, second place: the domain the pool actually serves it from.
  ['Resources', 'UserPoolDomain', 'Properties', 'Domain'],
  // THE HALF-OPEN DOOR, second half — the pre-sign-up refusal.
  ['Resources', 'PreSignUpFunction', 'Properties', 'Environment', 'Variables', 'OPEN_REGISTRATION'],
  // The condition is on the WHOLE CORS block and both arms are complete, which is what stops
  // SAM dropping the methods and the headers. `public-api.test.ts` holds each arm to them.
  ['Resources', 'PublicApi', 'Properties', 'CorsConfiguration'],
  // The API hostname the custom domain is created under.
  ['Resources', 'PublicApi', 'Properties', 'Domain', 'DomainName'],
  // THE HALF-OPEN DOOR, third: the approve handler reads the same switch as the trigger.
  ['Resources', 'ApproveFunction', 'Properties', 'Environment', 'Variables', 'OPEN_REGISTRATION'],
  // The managed-login hostname, third place: the output it is published under.
  ['Outputs', 'AuthDomain', 'Value'],
  // The API hostname again, as the NAME a Cloudflare record is created for. That record's
  // TARGET is a different output, `ApiDomainRegionalTarget`, which carries no condition.
  ['Outputs', 'ApiDomain', 'Value'],
];

const shown = (path: readonly (string | number)[]) => path.join('.');

describe('every conditional value in the user stack is an !If and not a list spelt like one', () => {
  // THE ANCHOR THE OTHER TEMPLATE FILES OPEN WITH, both halves of it. An empty file parses with
  // NO errors — `parseDocument('')` gives `errors: []` and null contents — so `errors` alone
  // would let the absence assertion below pass against nothing, and would let the inventory
  // pass against a truncated template. `Resources` is what says a file is actually here.
  it('parses, and both stacks are in it', () => {
    expect(user.errors).toEqual([]);
    expect(archive.errors).toEqual([]);
    expect(user.toJS()?.Resources).toBeDefined();
    expect(archive.toJS()?.Resources).toBeDefined();
  });

  // BOTH DIRECTIONS IN ONE ASSERTION. A tag deleted takes its path out of the derived set; an
  // `!If` added anywhere puts a new one in. Neither can pass without this list being edited.
  // THE TAG FORM, which is the only forgeable one: the long form renders as the OBJECT
  // `{'Fn::If': [...]}`, so dropping its key changes what every arm assertion reads and none
  // of this is needed to catch it. A long-form conditional is therefore not in this set.
  // THE RAW PATHS, not their joined spellings: joined, `['A', 'b.c']` and `['A', 'b', 'c']`
  // read alike, and a segment written `'0'` where the document has the index `0` would pass —
  // `getIn` resolves either against a sequence.
  it('carries exactly the thirteen written here', () => {
    expect(taggedPaths(user, '!If')).toEqual(IF_PATHS);
  });

  // A DIAGNOSTIC RATHER THAN A SECOND DETECTION, and worth its three lines on that ground: an
  // entry that is misspelt or points at nothing throws NAMING THE PATH, where the assertion
  // above would only show two lists that differ somewhere.
  it('reads !If at each of them', () => {
    for (const path of IF_PATHS) {
      expect([shown(path), tagAt(user, ...path)]).toEqual([shown(path), '!If']);
    }
  });

  // So that "thirteen" is a fact about the backend and not about one of its two templates.
  // The archive stack takes no environment: it is one cluster for every branch.
  it('and the archive stack carries none', () => {
    expect(taggedPaths(archive, '!If')).toEqual([]);
  });
});
