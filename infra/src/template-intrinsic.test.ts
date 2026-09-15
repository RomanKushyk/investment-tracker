import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { grantAt, intrinsicAt, tagAt, taggedCollections } from './template-intrinsic';

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
// `taggedCollections` DERIVES THE SET rather than trusting a list somebody keeps by hand, which
// is the half that catches an intrinsic ADDED without a guard. A hand-kept inventory went stale
// inside one milestone in this suite already (`openapi.test.ts`). It is keyed on the SHAPE and
// not on a list of tag names, because the hazard belongs to every tagged collection alike: an
// `!Equals`, an `!And` and the next `!Or` all render through `toJS()` as the plain sequence they
// are written as, and a set of names would guard the ones somebody thought of.

const TAGGED = `Conditions:
  # NESTED, and it is what a walk reaches only by descending INTO a tagged node: five finds down
  # two paths, each inside the arms of the one above it. BOTH ARMS, so the nesting is exercised
  # at a sequence index above 0 as well — and because \`Fn::And\` takes two conditions at least.
  HasGoogle: !And
    - !Not [!Equals [!Ref GoogleClientId, '']]
    - !Not [!Equals [!Ref GoogleClientSecret, '']]
Resources:
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
  PublicApi:
    Properties:
      # AN UNTAGGED COLLECTION INSIDE A TAGGED ONE. The untagged ARM is what
      # \`CorsConfiguration\` has in the stack; the intrinsic inside it is not — the template says
      # at length why that \`!If\` sits on the whole block — and not having it yet is the point,
      # since the set exists to catch what gets ADDED. Descending THROUGH an arm that carries no
      # tag is the step a walk stopping at untagged children would skip, every other find here
      # still landing.
      CorsConfiguration: !If
        - IsProd
        - AllowOrigins: !If [IsProd, [https://quirenote.com], [https://dev.quirenote.com]]
        - AllowOrigins: ['*']
Outputs:
  AuthDomain:
    Value: !If [IsProd, auth.quirenote.com, auth.dev.quirenote.com]
`;

const VARS = ['Resources', 'MigrateFunction', 'Properties', 'Environment', 'Variables'] as const;
const CLIENT = ['Resources', 'UserPoolClient', 'Properties'] as const;
const CORS = ['Resources', 'PublicApi', 'Properties', 'CorsConfiguration'] as const;

const tagged = parseDocument(TAGGED);
// THE SABOTAGE THIS FILE EXISTS FOR, spelt once: the tag removed, everything else identical.
const pinned = parseDocument(
  TAGGED.replace('!GetAtt UserCluster.Endpoint', 'UserCluster.Endpoint'),
);
// And the same tag QUOTED, which parses as a scalar carrying the tag's own text as its value.
const quoted = parseDocument(
  TAGGED.replace('!GetAtt UserCluster.Endpoint', "'!GetAtt UserCluster.Endpoint'"),
);
// THE SEQUENCE SABOTAGE. Anchored on the condition's name, because `!If [` is written several
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

// EVERY INTRINSIC IN HERE IS A SCALAR, and the collections around them carry no tag — the
// shape the helper below has to come back empty on.
const SCALARS_ONLY = `Resources:
  CaptureFunction:
    Properties:
      Environment:
        Variables:
          DSQL_ENDPOINT: !GetAtt PriceCluster.Endpoint
          USER_POOL_ID: !Ref UserPool
      Policies:
        - Statement:
            - Action: [dsql:DbConnectAdmin, dsql:GetCredentials]
              Resource: !Sub '\${PriceCluster.Arn}'
`;

describe('taggedCollections', () => {
  // DERIVED, NOT LISTED, which is the half a per-site assertion cannot buy: an intrinsic
  // ADDED without a guard changes this set, so it cannot arrive unnoticed.
  //
  // THE PAIR AND NOT THE PATH, because the tag is half of what an inventory is holding: a
  // path alone passes with an `!If` rewritten `!Or` at the same place.
  //
  // AND THE UNTAGGED ARMS ARE ABSENT WHILE THE WALK STILL GOES THROUGH THEM.
  // `SupportedIdentityProviders` holds two plain sequences inside its tagged one and neither is
  // a find — a collection is here because of its TAG — yet `CorsConfiguration`'s untagged arm
  // is descended into far enough to reach the `!If` beneath it.
  it('finds every tagged collection, nested, block form and Outputs included', () => {
    expect(taggedCollections(tagged)).toEqual([
      [['Conditions', 'HasGoogle'], '!And'],
      [['Conditions', 'HasGoogle', 0], '!Not'],
      [['Conditions', 'HasGoogle', 0, 0], '!Equals'],
      [['Conditions', 'HasGoogle', 1], '!Not'],
      [['Conditions', 'HasGoogle', 1, 0], '!Equals'],
      [[...VARS, 'OPEN_REGISTRATION'], '!If'],
      [[...CLIENT, 'SupportedIdentityProviders'], '!If'],
      [[...CLIENT, 'CallbackURLs', 0], '!If'],
      [[...CORS], '!If'],
      [[...CORS, 1, 'AllowOrigins'], '!If'],
      [['Outputs', 'AuthDomain', 'Value'], '!If'],
    ]);
  });

  // SCALARS ARE NOT COLLECTIONS, and that line is the whole scope of this helper rather than
  // an omission: a `!GetAtt` survives `toJS()` as its own value, so it is read at its site by
  // `intrinsicAt`, tag and value apart. It is also what makes the archive stack's empty set a
  // statement about that template — which carries scalar intrinsics and no tagged collection —
  // instead of a statement about a document with no tags at all.
  it('comes back empty where every intrinsic is a scalar', () => {
    expect(taggedCollections(parseDocument(SCALARS_ONLY))).toEqual([]);
  });

  // THE HALF THAT REDDENS. One tag deleted and the entry is simply gone from the set — which
  // is what an inventory written against this holds the template to.
  it('loses the entry when the tag goes', () => {
    expect(taggedCollections(untagged)).not.toContainEqual([[...VARS, 'OPEN_REGISTRATION'], '!If']);
    // The PROPERTY, not the fixture's count: one fewer than before, so adding a case above
    // does not redden this for a reason it is not about.
    expect(taggedCollections(untagged)).toHaveLength(taggedCollections(tagged).length - 1);
  });

  // THE TWO HAVE TO COMPOSE, because one derives the path the other reads back. `YAMLMap.get`
  // compares strictly, so a numeric key stringified on the way out would return a path that
  // `tagAt` then reports is not in the document — an inventory nobody could act on.
  it('emits a key tagAt can read back, a numeric one included', () => {
    const numeric = parseDocument("Mappings:\n  2024: !If [IsProd, 'a', 'b']\n");
    const [[path]] = taggedCollections(numeric);
    expect(path).toEqual(['Mappings', 2024]);
    expect(tagAt(numeric, ...path)).toBe('!If');
  });
});

// THE THREE SHAPES A POLICY IS WRITTEN IN, which is why `grantAt` takes the path to a statement
// list rather than a resource id: a SAM function's inline `Policies`, a role's `PolicyDocument`
// nested inside one, and a standalone `AWS::IAM::Policy` whose document is the property itself.
// A helper that guessed between them would be one more thing able to read the wrong statement.
//
// THE PREFIX TRAP IS IN HERE ON PURPOSE, written BEFORE the action it would be found instead of:
// `DescribeUserPoolClient` begins with `DescribeUserPool`, so a substring match finds the client's
// statement first and asserts ITS resource while the one it was about loses its tag unwatched.
const POLICIES = `Resources:
  MigrateFunction:
    Properties:
      Policies:
        - Statement:
            - Sid: ConnectToDsqlAsAdmin
              Action: dsql:DbConnectAdmin
              Resource: !GetAtt UserCluster.ResourceArn
            - Sid: BootstrapTheFirstSuperAdmin
              Action:
                - cognito-idp:AdminCreateUser
                - cognito-idp:AdminGetUser
              Resource: !GetAtt UserPool.Arn
  PoolUsageFunction:
    Properties:
      Policies:
        - Statement:
            - Action: cognito-idp:DescribeUserPoolClient
              Resource: !GetAtt UserPoolClient.Arn
            - Action: cognito-idp:DescribeUserPool
              Resource: !GetAtt UserPool.Arn
  SchedulerRole:
    Properties:
      Policies:
        - PolicyName: InvokeCapture
          PolicyDocument:
            Statement:
              - Action: lambda:InvokeFunction
                Resource: !GetAtt CaptureFunction.Arn
  PreSignUpPolicy:
    Properties:
      PolicyDocument:
        Statement:
          - Action:
              - cognito-idp:ListUsers
              - cognito-idp:AdminLinkProviderForUser
            Resource: '*'
`;

const policies = parseDocument(POLICIES);
// The sabotage this helper exists to catch, on a line written once in the fixture.
const dropped = parseDocument(
  POLICIES.replace('!GetAtt UserCluster.ResourceArn', 'UserCluster.ResourceArn'),
);
// THE WIDENING A FIRST MATCH READS PAST. A grant is widened by a SECOND statement, and a second
// statement is appended — below the narrow one, not above it. The narrow statement is left exactly
// as it was, so anything taking the first hit still reads `UserCluster.ResourceArn` and passes
// while the deployed policy is the union of the two.
const widened = parseDocument(
  POLICIES.replace(
    '            - Sid: BootstrapTheFirstSuperAdmin',
    '            - Sid: Oops\n              Action: dsql:DbConnectAdmin\n' +
      "              Resource: '*'\n            - Sid: BootstrapTheFirstSuperAdmin",
  ),
);

const INLINE = ['Resources', 'MigrateFunction', 'Properties', 'Policies', 0, 'Statement'] as const;
const USAGE = ['Resources', 'PoolUsageFunction', 'Properties', 'Policies', 0, 'Statement'] as const;
const ROLE = [
  'Resources',
  'SchedulerRole',
  'Properties',
  'Policies',
  0,
  'PolicyDocument',
  'Statement',
] as const;
const STANDALONE = [
  'Resources',
  'PreSignUpPolicy',
  'Properties',
  'PolicyDocument',
  'Statement',
] as const;

describe('grantAt', () => {
  // FOUND BY ITS ACTION, NEVER BY ITS INDEX, which is the whole of the difference: an index is a
  // position, and a wider grant inserted above a statement silently becomes the one every
  // assertion about it reads. `Action` is a bare string on some statements and a list on others.
  it('returns the resource intrinsic of the statement carrying the action', () => {
    expect(grantAt(policies, INLINE, 'dsql:DbConnectAdmin')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
    expect(grantAt(policies, INLINE, 'cognito-idp:AdminGetUser')).toEqual({
      tag: '!GetAtt',
      value: 'UserPool.Arn',
    });
  });

  // WHOLE, NOT AS A PREFIX. The client's statement is first in the fixture, so a substring match
  // returns its resource here and the assertion reads as if it were about the pool.
  it('matches the action whole, so a longer one beginning with it is not the find', () => {
    expect(grantAt(policies, USAGE, 'cognito-idp:DescribeUserPool')).toEqual({
      tag: '!GetAtt',
      value: 'UserPool.Arn',
    });
    expect(grantAt(policies, USAGE, 'cognito-idp:DescribeUserPoolClient')).toEqual({
      tag: '!GetAtt',
      value: 'UserPoolClient.Arn',
    });
  });

  // The other two shapes, reached by the same helper because the PATH is the argument.
  it('reads a role’s nested document and a standalone policy’s alike', () => {
    expect(grantAt(policies, ROLE, 'lambda:InvokeFunction')).toEqual({
      tag: '!GetAtt',
      value: 'CaptureFunction.Arn',
    });
    // A resource that is no intrinsic comes back as one that is not, which is what pins a
    // deliberate wildcard as deliberate rather than leaving it unread.
    expect(grantAt(policies, STANDALONE, 'cognito-idp:ListUsers')).toEqual({
      tag: undefined,
      value: '*',
    });
  });

  // THE ONE THAT MATTERS, inherited from `intrinsicAt`: the same value read the same way has to
  // come back different once the tag is gone. `toJS()` returns one string for both documents.
  it('tells a dropped tag from the intrinsic it was', () => {
    expect(grantAt(dropped, INLINE, 'dsql:DbConnectAdmin')).toEqual({
      tag: undefined,
      value: 'UserCluster.ResourceArn',
    });
    expect(dropped.toJS()).toEqual(policies.toJS());
  });

  // A STATEMENT DELETED MUST REDDEN, not read as "no grant here" — otherwise the assertion a
  // grant carries could be made to pass by removing the grant. Both ways of vanishing: the
  // action nobody grants, and a path that is not a statement list at all.
  it('throws when no statement carries the action', () => {
    expect(() => grantAt(policies, INLINE, 'dsql:DbConnect')).toThrow(/dsql:DbConnect\b/);
    expect(() => grantAt(policies, USAGE, 'cognito-idp:ListUsers')).toThrow(/ListUsers/);
  });

  // AND WHEN TWO DO, which is the other direction and the one a first match cannot see. The count
  // is in the message because none and two are opposite repairs — a grant to restore, or a grant
  // to remove — and the fixture proves the narrow statement is still sitting there reading right.
  it('throws when the action is granted twice, and says so', () => {
    expect(() => grantAt(widened, INLINE, 'dsql:DbConnectAdmin')).toThrow(/2 statements/);
    expect(() => grantAt(policies, INLINE, 'dsql:DbConnect')).toThrow(/0 statements/);
    expect(intrinsicAt(widened, ...INLINE, 0, 'Resource')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
  });

  it('throws when the path is not a statement list', () => {
    expect(() =>
      grantAt(policies, ['Resources', 'MigrateFunction'], 'dsql:DbConnectAdmin'),
    ).toThrow(/MigrateFunction/);
    expect(() => grantAt(policies, ['Resources', 'NoSuchRole'], 'lambda:InvokeFunction')).toThrow(
      /NoSuchRole/,
    );
  });
});
