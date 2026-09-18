import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { grantAt, intrinsicAt, tagAt, taggedCollections } from './template-intrinsic';

// The helpers that let a template assertion read the tag off the PARSED document. They
// replace a regex over the template TEXT, which had to be unique to the line it was about
// to mean anything: `DSQL_ENDPOINT: !GetAtt` is written three times in
// `template-user.yaml`, so the guard on one of them passed against the other two with the
// tag dropped. Addressing the node by path needs no uniqueness argument at all.
//
// THE TAG AND THE VALUE STAY APART, which is why `intrinsicAt` returns a pair rather than
// the two joined into one string: joined, the QUOTED literal `'!GetAtt UserPool.Arn'` reads
// exactly like the intrinsic, and CloudFormation deploys it as the text.
//
// `tagAt` IS THE SECOND HELPER because an `!If` is a SEQUENCE, and `intrinsicAt` must keep
// throwing on one — a scalar quietly becoming a sequence is not something an assertion may
// accept. A wider door is not a looser one: the quoted imitation is still a scalar, and
// still reads as untagged.
//
// `taggedCollections` DERIVES THE SET rather than trusting a list somebody keeps by hand,
// which is the half that catches an intrinsic ADDED without a guard; one such list went
// stale inside a milestone in this suite already (`openapi.test.ts`). Keyed on the SHAPE
// and not on tag names, because `!Equals`, `!And` and the next `!Or` are sequences alike,
// and a set of names would guard only the ones somebody thought of.
// [*Review, gates, tests*]

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

  // The same value, read the same way, has to come back different once the tag is gone.
  it('tells a dropped tag from the intrinsic it was', () => {
    expect(intrinsicAt(pinned, ...VARS, 'DSQL_ENDPOINT')).toEqual({
      tag: undefined,
      value: 'UserCluster.Endpoint',
    });
    expect(intrinsicAt(pinned, ...VARS, 'DSQL_ENDPOINT')).not.toEqual(
      intrinsicAt(tagged, ...VARS, 'DSQL_ENDPOINT'),
    );
  });

  // CloudFormation resolves nothing inside a quoted scalar, so this would deploy the
  // literal text `!GetAtt UserCluster.Endpoint` as the endpoint.
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
  // Both forms, because the block one looks like the safer spelling and parses the same.
  it('reads the tag off a sequence, flow form and block form alike', () => {
    expect(tagAt(tagged, ...VARS, 'OPEN_REGISTRATION')).toBe('!If');
    expect(tagAt(tagged, ...CLIENT, 'CallbackURLs', 0)).toBe('!If');
    expect(tagAt(tagged, ...CLIENT, 'SupportedIdentityProviders')).toBe('!If');
  });

  it('tells a dropped !If from the plain sequence it renders to', () => {
    expect(tagAt(untagged, ...VARS, 'OPEN_REGISTRATION')).toBeUndefined();
    expect(untagged.toJS()).toEqual(tagged.toJS());
  });

  it('reads a scalar tag too, and still sees none on the quoted imitation', () => {
    expect(tagAt(tagged, ...VARS, 'DSQL_ENDPOINT')).toBe('!GetAtt');
    expect(tagAt(pinned, ...VARS, 'DSQL_ENDPOINT')).toBeUndefined();
    expect(tagAt(quoted, ...VARS, 'DSQL_ENDPOINT')).toBeUndefined();
  });

  it('throws on a path that is not in the document', () => {
    expect(() => tagAt(tagged, ...VARS, 'OPEN_REGISTRATIO')).toThrow(/OPEN_REGISTRATIO\b/);
    expect(() => tagAt(tagged, 'Resources', 'NoSuchFunction')).toThrow(/NoSuchFunction/);
  });
});

// Every intrinsic in here is a scalar, and the collections around them carry no tag.
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
  // THE PAIR AND NOT THE PATH, because the tag is half of what an inventory is holding: a
  // path alone passes with an `!If` rewritten `!Or` at the same place. The untagged arms are
  // absent while the walk still goes THROUGH them — `CorsConfiguration`'s is descended into
  // far enough to reach the `!If` beneath it.
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

  // SCALARS ARE NOT COLLECTIONS, which is this helper's scope rather than an omission: a
  // `!GetAtt` survives `toJS()` as its own value, so it is read at its site by `intrinsicAt`,
  // tag and value apart. It is also what makes the archive stack's empty set a statement
  // about that template rather than about a document carrying no tags at all.
  it('comes back empty where every intrinsic is a scalar', () => {
    expect(taggedCollections(parseDocument(SCALARS_ONLY))).toEqual([]);
  });

  // WHAT IT CANNOT ADDRESS IT NAMES, and the ADDED direction rests on this entirely: the set
  // is read by equality, so an intrinsic the walk steps over never enters it and cannot redden
  // anything. Each fixture parses with NO errors and hides a tagged `!Equals` a step in. The
  // path in the message is the point of throwing: "under Conditions" is something a reader can
  // act on, where a set one entry short is not.
  it.each([
    [
      'a key that is not a scalar',
      'Conditions:\n  ? [a, b]\n  : !Equals [!Ref Environment, prod]\n',
    ],
    ['a key that is a boolean', 'Conditions:\n  true: !Equals [!Ref Environment, prod]\n'],
    ['a key that is null', 'Conditions:\n  ~: !Equals [!Ref Environment, prod]\n'],
    // A NUMBER AND STILL NO NAME: `YAMLMap.get` compares strictly and `NaN !== NaN`, so the
    // path this would emit is one `tagAt` reports is not in the document.
    ['a key that is NaN', 'Conditions:\n  .nan: !Equals [!Ref Environment, prod]\n'],
  ])('throws naming the path on %s', (_name, src) => {
    const doc = parseDocument(src);
    expect(doc.errors).toEqual([]);
    expect(() => taggedCollections(doc)).toThrow(/Conditions/);
  });

  // AND EACH OF THOSE REALLY IS HIDING AN ENTRY: the same condition under a key a path can
  // carry derives exactly one, held against the parser instead of asserted in a comment.
  it('derives from a nameable key the entry those spellings hide', () => {
    const named = parseDocument('Conditions:\n  Named: !Equals [!Ref Environment, prod]\n');
    expect(taggedCollections(named)).toEqual([[['Conditions', 'Named'], '!Equals']]);
  });

  // THE JOINED PATH, AND THE KEY ITSELF. Every fixture in the table above puts its bad key
  // directly under `Conditions`, where the joined path and its first segment read alike — so
  // the join is unheld there, and so is the key, which is the half that finds the line.
  it('names the joined path and the offending key', () => {
    const doc = parseDocument(
      'Conditions:\n  Inner:\n    true: !Equals [!Ref Environment, prod]\n',
    );
    expect(doc.errors).toEqual([]);
    expect(() => taggedCollections(doc)).toThrow(/under Conditions\.Inner: true/);
  });

  // AND THE SAME AT A SEQUENCE INDEX, where a real `!If` arm lives. Every other fixture here
  // hangs its unaddressable node off a MAP key, so the seq branch is held by this one alone.
  it('throws naming the path on an alias inside a sequence', () => {
    const doc = parseDocument('Conditions:\n  A: &p !Equals [a, b]\n  B:\n    - *p\n');
    expect(doc.errors).toEqual([]);
    expect(() => taggedCollections(doc)).toThrow(/at Conditions\.B\.0/);
  });

  // AN EMPTY-STRING KEY IS A ONE-LEVEL PATH, and joined it is `''` — which a falsy test reads
  // as no path at all, handing a non-root site the root's own spelling and letting the anchor
  // above be satisfied from the wrong place.
  it('does not spell a one-level path as the document root', () => {
    const doc = parseDocument("'':\n  ~: !Equals [a, b]\n");
    expect(doc.errors).toEqual([]);
    expect(() => taggedCollections(doc)).toThrow(/under : null/);
  });

  // A RAW NULL IS NEITHER SCALAR NOR COLLECTION EITHER, and it is not the `Empty:` spelling —
  // that one parses to a null SCALAR and is a leaf. These two give the pair a value of raw
  // `null`, a node with no kind at all.
  it.each([
    ['a flow map entry with no value', 'Conditions: {A}\n'],
    ['an explicit key with no value', 'Conditions:\n  ? A\n'],
  ])('throws naming the path on %s', (_name, src) => {
    const doc = parseDocument(src);
    expect(doc.errors).toEqual([]);
    expect(() => taggedCollections(doc)).toThrow(/Conditions\.A/);
  });

  // AN ALIAS IS NOT A COLLECTION: the node it names is walked at the anchor and never at the
  // alias, so an anchor on an UNTAGGED collection puts every tag under it out of reach at the
  // second path entirely.
  it('throws naming the path on an alias', () => {
    const doc = parseDocument(
      'Conditions:\n  IsProd: &p !Equals [!Ref Environment, prod]\n  Other: *p\n',
    );
    expect(doc.errors).toEqual([]);
    expect(() => taggedCollections(doc)).toThrow(/Conditions\.Other/);
  });

  // AN EMPTY FILE IS THE ABSENCE ASSERTION'S OLDEST TRAP: `parseDocument('')` gives
  // `errors: []` and NULL contents, so a set derived from nothing reads exactly like a
  // template that carries nothing. A SCALAR at the root is a leaf, like a scalar anywhere.
  //
  // THE MESSAGE AND NOT MERELY A THROW: delete the root's fallback spelling and a bare
  // `toThrow()` still passes, on an error naming an empty path.
  it('throws on a document with no contents, and reads a scalar root as the leaf it is', () => {
    expect(() => taggedCollections(parseDocument(''))).toThrow(/the document root/);
    expect(taggedCollections(parseDocument('just a string\n'))).toEqual([]);
    expect(taggedCollections(parseDocument('---\n'))).toEqual([]);
  });

  // One tag deleted and the entry is gone from the set, which is what an inventory written
  // against this holds the template to.
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

// THE THREE SHAPES A POLICY IS WRITTEN IN, which is why `grantAt` takes the path to a
// statement list rather than a resource id: a helper that guessed between them would be one
// more thing able to read the wrong statement.
//
// THE PREFIX TRAP IS IN HERE ON PURPOSE, written BEFORE the action it would be found instead
// of: `DescribeUserPoolClient` begins with `DescribeUserPool`, so a substring match finds the
// client's statement first and asserts ITS resource while the one it was about goes unwatched.
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
// THE WIDENING A FIRST MATCH READS PAST. A grant is widened by a SECOND statement, appended
// BELOW the narrow one, which is left exactly as it was — so anything taking the first hit
// still reads `UserCluster.ResourceArn` and passes while the deployed policy is the union.
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

  // WHOLE, NOT AS A PREFIX: the client's statement is first, so a substring match wins it.
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

  it('tells a dropped tag from the intrinsic it was', () => {
    expect(grantAt(dropped, INLINE, 'dsql:DbConnectAdmin')).toEqual({
      tag: undefined,
      value: 'UserCluster.ResourceArn',
    });
    expect(dropped.toJS()).toEqual(policies.toJS());
  });

  // A STATEMENT DELETED MUST REDDEN, not read as "no grant here" — otherwise the assertion a
  // grant carries could be made to pass by removing the grant.
  it('throws when no statement carries the action', () => {
    expect(() => grantAt(policies, INLINE, 'dsql:DbConnect')).toThrow(/dsql:DbConnect\b/);
    expect(() => grantAt(policies, USAGE, 'cognito-idp:ListUsers')).toThrow(/ListUsers/);
  });

  // AND WHEN TWO DO, the direction a first match cannot see. The count is in the message
  // because none and two are opposite repairs: a grant to restore, or a grant to remove.
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
