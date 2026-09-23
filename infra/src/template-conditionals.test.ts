import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMap, parseDocument, type Document } from 'yaml';
import { envVars, tagAt, taggedCollections } from './template-intrinsic';

// EVERY TAGGED COLLECTION IN THE USER STACK, HELD AS ONE SET. `toJS()` renders `!If [IsProd, a, b]`
// as the identical array an untagged sequence renders to, so every arm assertion elsewhere in this
// suite reads the arms and cannot see the tag. `!Equals`, `!Not` and `!And` are sequences too, so
// the set is held by SHAPE rather than by a list of tag names.
//
// A SET AND NOT AN ASSERTION BESIDE EACH VALUE: a guard written at the site catches an intrinsic
// REMOVED and never one ADDED, and not every entry here has an assertion on its arms to sit beside.
//
// WHAT IT DOES NOT DO: it pins that the tag is there, never which condition an entry reads, which
// way its arms point, or what a condition compares. Closing any of that is its own change.
//
// SAM IS NOT THE BACKSTOP: it rewrites only its own resources and type-checks fewer properties
// still — with a tag removed it refuses `CorsConfiguration` and passes every other one through, a
// Lambda environment variable among them, which reaches CloudFormation as a list.
// [*Review, gates, tests*]

const read = (name: string) =>
  parseDocument(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const user = read('template-user.yaml');
const archive = read('template.yaml');

// In document order: the conditions the template defines above `Resources`, then the values
// that read one.
const INTRINSICS: readonly (readonly [readonly (string | number)[], string])[] = [
  [['Conditions', 'IsProd'], '!Equals'],
  [['Conditions', 'IsRegistrationOpen'], '!Equals'],
  [['Conditions', 'HasGoogle'], '!Equals'],
  // `app=quirenote` selects into `quirenote-backups`, a LOCKED vault; dev's tag is out.
  [['Resources', 'UserCluster', 'Properties', 'Tags', 0, 'Value'], '!If'],
  // The passkey relying party: the environment's own apex, so changing it strands credentials.
  [['Resources', 'UserPool', 'Properties', 'WebAuthnRelyingPartyID'], '!If'],
  [
    ['Resources', 'UserPool', 'Properties', 'AdminCreateUserConfig', 'AllowAdminCreateUserOnly'],
    '!If',
  ],
  [['Resources', 'UserPoolClient', 'Properties', 'SupportedIdentityProviders'], '!If'],
  [['Resources', 'UserPoolClient', 'Properties', 'CallbackURLs', 0], '!If'],
  [['Resources', 'UserPoolClient', 'Properties', 'LogoutURLs', 0], '!If'],
  [['Resources', 'UserPoolDomain', 'Properties', 'Domain'], '!If'],
  [[...envVars('PreSignUpFunction'), 'OPEN_REGISTRATION'], '!If'],
  // The condition is on the WHOLE CORS block and both arms are complete, which is what stops SAM
  // dropping the methods and the headers.
  [['Resources', 'PublicApi', 'Properties', 'CorsConfiguration'], '!If'],
  [['Resources', 'PublicApi', 'Properties', 'Domain', 'DomainName'], '!If'],
  [[...envVars('ApproveFunction'), 'OPEN_REGISTRATION'], '!If'],
  [['Outputs', 'AuthDomain', 'Value'], '!If'],
  [['Outputs', 'ApiDomain', 'Value'], '!If'],
];

const shown = (path: readonly (string | number)[]) => path.join('.');

// Read off the NODE — a `Resources` that is a string or a list is not a count of anything, and
// both render as something `Object.keys` will happily size.
const resourceCount = (doc: Document) => {
  const node = doc.get('Resources', true);
  return isMap(node) ? node.items.length : 0;
};

describe('every conditional in the user stack is an intrinsic and not a list spelt like one', () => {
  // `errors` alone says nothing about whether a file is a template: a GUTTED one — `Resources:`
  // by itself — parses with none, and derives the empty set the ARCHIVE's `carries none` below
  // is looking for. Counted on the NODE, not `toJS()`: the gutted file renders as
  // `{ Resources: null }`, which `toBeDefined()` accepts, and `Object.keys` over `hello` counts
  // five. The node is the only one of the three that knows a map from a string.
  it('parses, and both stacks are in it', () => {
    expect(user.errors).toEqual([]);
    expect(archive.errors).toEqual([]);
    expect(resourceCount(user)).toBeGreaterThan(0);
    expect(resourceCount(archive)).toBeGreaterThan(0);
    expect(resourceCount(parseDocument('Resources:\n'))).toBe(0);
    expect(resourceCount(parseDocument('Resources: hello\n'))).toBe(0);
  });

  // BOTH DIRECTIONS IN ONE ASSERTION: a tag deleted takes its entry out, one added anywhere puts
  // a new one in, and a tag CHANGED moves the pair rather than the path. THE TAG FORM only — the
  // long form renders as the object `{'Fn::If': [...]}`, so dropping its key already changes what
  // every arm assertion reads. THE RAW PATHS, not their joined spellings: joined, `['A', 'b.c']`
  // and `['A', 'b', 'c']` read alike.
  it('carries exactly the sixteen written here', () => {
    expect(taggedCollections(user)).toEqual(INTRINSICS);
  });

  // A diagnostic rather than a second detection: a misspelt entry throws NAMING THE PATH, where
  // the assertion above would only show two lists that differ somewhere.
  it('reads the tag written beside each of them', () => {
    for (const [path, tag] of INTRINSICS) {
      expect([shown(path), tagAt(user, ...path)]).toEqual([shown(path), tag]);
    }
  });

  // The archive stack takes no environment — one cluster for every branch — so it defines no
  // conditions. Its intrinsics are all SCALARS, which is what makes this more than an empty walk.
  it('and the archive stack carries none', () => {
    expect(taggedCollections(archive)).toEqual([]);
  });
});
