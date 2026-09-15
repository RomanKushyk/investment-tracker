import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { intrinsicAt } from './template-intrinsic';

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
`;

const VARS = ['Resources', 'MigrateFunction', 'Properties', 'Environment', 'Variables'] as const;

const tagged = parseDocument(TAGGED);
// THE SABOTAGE THIS FILE EXISTS FOR, spelt once: the tag removed, everything else identical.
const pinned = parseDocument(
  TAGGED.replace('!GetAtt UserCluster.Endpoint', 'UserCluster.Endpoint'),
);
// And the same tag QUOTED, which parses as a scalar carrying the tag's own text as its value.
const quoted = parseDocument(
  TAGGED.replace('!GetAtt UserCluster.Endpoint', "'!GetAtt UserCluster.Endpoint'"),
);

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
