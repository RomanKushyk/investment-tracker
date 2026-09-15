import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { intrinsicAt, tagAt, taggedPaths } from './template-intrinsic';

// WHAT A TEMPLATE ASSERTION CANNOT SEE WITHOUT THIS. `toJS()` discards an unknown tag and
// keeps the scalar, so `!GetAtt UserCluster.Endpoint` and a literal spelt the same way are
// one value to every test that reads a parsed template — and the literal deploys a resource
// pointing at a name AWS cannot resolve. The document node still carries the tag.
//
// It replaces a regex over the template TEXT, which had to be unique to the line it was
// about to mean anything: `DSQL_ENDPOINT: !GetAtt` is written three times in
// `template-user.yaml`, so the guard on one of them passed against the other two with the
// tag dropped. Addressing the node by path needs no uniqueness argument at all.
//
// THE TAG AND THE VALUE STAY APART, which is why this returns a pair rather than the two
// joined into one string: joined, the QUOTED literal `'!GetAtt UserPool.Arn'` — a scalar
// whose value is that text — reads exactly like the intrinsic, and CloudFormation deploys it
// as the text. Apart, one cannot impersonate the other.
//
// THE SAME HAZARD ONE SHAPE ALONG IS WHAT `tagAt` IS FOR. An `!If` is a SEQUENCE, and
// `toJS()` renders `!If [IsProd, a, b]` as `['IsProd', 'a', 'b']` — the identical array an
// untagged sequence written the same way renders to, so every assertion over the arms passes
// with the tag deleted. `intrinsicAt` cannot be pointed at one and must not be: a scalar
// quietly becoming a sequence has to keep throwing. So the tag is read by a second helper
// that takes a node of any kind, and a wider door is not a looser one — the quoted imitation
// is still a scalar carrying that text, and still reads as untagged.
//
// `taggedPaths` DERIVES THE SET rather than trusting a list somebody keeps by hand, which is
// the half that catches an intrinsic ADDED without a guard. A hand-kept inventory went stale
// inside one milestone in this suite already (`openapi.test.ts`).

const TAGGED = `Resources:
  MigrateFunction:
    Properties:
      Environment:
        Variables:
          DSQL_ENDPOINT: !GetAtt UserCluster.Endpoint
          USER_POOL_ID: !Ref UserPool
          OPEN_REGISTRATION: !If [IsRegistrationOpen, 'true', 'false']
    Policies:
      - Statement:
          - Action: dsql:DbConnectAdmin
            Resource: !GetAtt UserCluster.ResourceArn
  UserPoolClient:
    Properties:
      # Arms that are LISTS, with an intrinsic inside one of them.
      SupportedIdentityProviders: !If [HasGoogle, [COGNITO, !Ref GoogleIdentityProvider], [COGNITO]]
      # BLOCK FORM, inside a sequence — the shape that looks safer than the flow form and is
      # not: the tag deleted leaves the same indented block, parsing to the same JS.
      CallbackURLs:
        - !If
          - IsProd
          - https://quirenote.com/auth/callback
          - https://dev.quirenote.com/auth/callback
Outputs:
  AuthDomain:
    Value: !If [IsProd, auth.quirenote.com, auth.dev.quirenote.com]
`;

const VARS = ['Resources', 'MigrateFunction', 'Properties', 'Environment', 'Variables'] as const;
const CLIENT = ['Resources', 'UserPoolClient', 'Properties'] as const;

const tagged = parseDocument(TAGGED);
// THE SABOTAGE THIS FILE EXISTS FOR, spelt once: the tag removed, everything else identical.
const pinned = parseDocument(
  TAGGED.replace('!GetAtt UserCluster.Endpoint', 'UserCluster.Endpoint'),
);
// And the same tag QUOTED, which parses as a scalar carrying the tag's own text as its value.
const quoted = parseDocument(
  TAGGED.replace('!GetAtt UserCluster.Endpoint', "'!GetAtt UserCluster.Endpoint'"),
);
// THE SEQUENCE SABOTAGE. Anchored on the condition's name, because `!If [` is written three
// times here — the same uniqueness trap the text regexes fell into, one helper along.
const untagged = parseDocument(TAGGED.replace('!If [IsRegistrationOpen', '[IsRegistrationOpen'));

describe('intrinsicAt', () => {
  it('returns the tag and the value, apart', () => {
    expect(intrinsicAt(tagged, ...VARS, 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
    expect(intrinsicAt(tagged, ...VARS, 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
  });

  // THE ONE THAT MATTERS: the same value, read the same way, has to come back different once
  // the intrinsic is gone. `toJS()` returns 'UserCluster.Endpoint' for both documents.
  it('tells a dropped tag from the intrinsic it was', () => {
    expect(intrinsicAt(pinned, ...VARS, 'DSQL_ENDPOINT')).toEqual({
      tag: undefined,
      value: 'UserCluster.Endpoint',
    });
    expect(intrinsicAt(pinned, ...VARS, 'DSQL_ENDPOINT')).not.toEqual(
      intrinsicAt(tagged, ...VARS, 'DSQL_ENDPOINT'),
    );
  });

  // AND A QUOTED TAG FROM A REAL ONE. CloudFormation resolves nothing inside a quoted scalar,
  // so this deploys the literal text `!GetAtt UserCluster.Endpoint` as the endpoint.
  it('tells a quoted tag from the intrinsic it imitates', () => {
    expect(intrinsicAt(quoted, ...VARS, 'DSQL_ENDPOINT')).toEqual({
      tag: undefined,
      value: '!GetAtt UserCluster.Endpoint',
    });
    expect(intrinsicAt(quoted, ...VARS, 'DSQL_ENDPOINT')).not.toEqual(
      intrinsicAt(tagged, ...VARS, 'DSQL_ENDPOINT'),
    );
  });

  it('reads a value inside a list by its index', () => {
    expect(
      intrinsicAt(
        tagged,
        'Resources',
        'MigrateFunction',
        'Policies',
        0,
        'Statement',
        0,
        'Resource',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserCluster.ResourceArn' });
  });

  // A scalar turned into an `!If` is a different property with a different deployed value, and
  // it must not come back as anything an assertion could accept. `!If` is a sequence.
  it('throws on a node that is not a scalar', () => {
    expect(() => intrinsicAt(tagged, ...VARS, 'OPEN_REGISTRATION')).toThrow(/OPEN_REGISTRATION/);
  });

  // A path nobody spelt right is the failure mode a helper adds over a regex: it would read as
  // "no tag here" and could be made to pass by deleting the property it was meant to pin.
  // Anchored, or the misspelling matches the message naming the key it was meant to miss.
  it('throws on a path that is not in the document', () => {
    expect(() => intrinsicAt(tagged, ...VARS, 'DSQL_ENDPOIN')).toThrow(/DSQL_ENDPOIN\b/);
    expect(() => intrinsicAt(tagged, 'Resources', 'NoSuchFunction')).toThrow(/NoSuchFunction/);
  });
});

describe('tagAt', () => {
  // THE PATH `intrinsicAt` THROWS ON, read. Both forms, because the block one looks like the
  // safer spelling and parses to exactly the same sequence.
  it('reads the tag off a sequence, flow form and block form alike', () => {
    expect(tagAt(tagged, ...VARS, 'OPEN_REGISTRATION')).toBe('!If');
    expect(tagAt(tagged, ...CLIENT, 'CallbackURLs', 0)).toBe('!If');
    expect(tagAt(tagged, ...CLIENT, 'SupportedIdentityProviders')).toBe('!If');
  });

  // THE ONE THAT MATTERS, and the whole reason for a second helper: these two documents are
  // one value to `toJS()` and two to this.
  it('tells a dropped !If from the plain sequence it renders to', () => {
    expect(tagAt(untagged, ...VARS, 'OPEN_REGISTRATION')).toBeUndefined();
    expect(untagged.toJS()).toEqual(tagged.toJS());
  });

  // A WIDER DOOR IS NOT A LOOSER ONE. Taking a node of any kind must not make the quoted
  // imitation readable as the intrinsic it spells — it is a scalar, and it carries no tag.
  it('reads a scalar tag too, and still sees none on the quoted imitation', () => {
    expect(tagAt(tagged, ...VARS, 'DSQL_ENDPOINT')).toBe('!GetAtt');
    expect(tagAt(pinned, ...VARS, 'DSQL_ENDPOINT')).toBeUndefined();
    expect(tagAt(quoted, ...VARS, 'DSQL_ENDPOINT')).toBeUndefined();
  });

  // `intrinsicAt`'s reason, unchanged: a path nobody spelt right would read as "no tag here"
  // and could be made to pass by deleting the property it was meant to pin.
  it('throws on a path that is not in the document', () => {
    expect(() => tagAt(tagged, ...VARS, 'OPEN_REGISTRATIO')).toThrow(/OPEN_REGISTRATIO\b/);
    expect(() => tagAt(tagged, 'Resources', 'NoSuchFunction')).toThrow(/NoSuchFunction/);
  });
});

describe('taggedPaths', () => {
  // DERIVED, NOT LISTED, which is the half a per-site assertion cannot buy: an intrinsic
  // ADDED without a guard changes this set, so it cannot arrive unnoticed.
  it('finds every tagged value in the document, block form and Outputs included', () => {
    expect(taggedPaths(tagged, '!If')).toEqual([
      [...VARS, 'OPEN_REGISTRATION'],
      [...CLIENT, 'SupportedIdentityProviders'],
      [...CLIENT, 'CallbackURLs', 0],
      ['Outputs', 'AuthDomain', 'Value'],
    ]);
  });

  // IT DESCENDS INTO A TAGGED NODE, which is what reaches the `!Ref` living inside an `!If`
  // arm — and a list index is a path segment like any other.
  it('reaches an intrinsic nested inside another one, and inside a list', () => {
    expect(taggedPaths(tagged, '!Ref')).toEqual([
      [...VARS, 'USER_POOL_ID'],
      [...CLIENT, 'SupportedIdentityProviders', 1, 1],
    ]);
    expect(taggedPaths(tagged, '!GetAtt')).toEqual([
      [...VARS, 'DSQL_ENDPOINT'],
      ['Resources', 'MigrateFunction', 'Policies', 0, 'Statement', 0, 'Resource'],
    ]);
  });

  // THE HALF THAT REDDENS. One tag deleted and the path is simply gone from the set — which
  // is what an inventory written against this holds the template to.
  it('loses the path when the tag goes', () => {
    expect(taggedPaths(untagged, '!If')).not.toContainEqual([...VARS, 'OPEN_REGISTRATION']);
    // The PROPERTY, not the fixture's count: one fewer than before, so adding a case above
    // does not redden this for a reason it is not about.
    expect(taggedPaths(untagged, '!If')).toHaveLength(taggedPaths(tagged, '!If').length - 1);
  });

  it('returns nothing for a tag the document does not carry', () => {
    expect(taggedPaths(tagged, '!Sub')).toEqual([]);
  });

  // THE TWO HAVE TO COMPOSE, because one derives the path the other reads back. `YAMLMap.get`
  // compares strictly, so a numeric key stringified on the way out would return a path that
  // `tagAt` then reports is not in the document — an inventory nobody could act on.
  it('emits a key tagAt can read back, a numeric one included', () => {
    const numeric = parseDocument("Mappings:\n  2024: !If [IsProd, 'a', 'b']\n");
    const [path] = taggedPaths(numeric, '!If');
    expect(path).toEqual(['Mappings', 2024]);
    expect(tagAt(numeric, ...path)).toBe('!If');
  });
});
