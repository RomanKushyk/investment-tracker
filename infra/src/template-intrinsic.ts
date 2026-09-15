import { isCollection, isMap, isScalar, isSeq, type Document } from 'yaml';

/** The intrinsic at `path` and the value it carries, kept apart:
 *  `{ tag: '!GetAtt', value: 'UserCluster.Endpoint' }`.
 *
 *  `toJS()` discards an unknown tag and keeps the scalar, so a parsed template cannot tell a
 *  `!GetAtt` from a literal spelt the same way — and the literal deploys a resource pointing
 *  at a name AWS cannot resolve. The document node carries the tag; nothing else does.
 *
 *  APART RATHER THAN JOINED INTO ONE STRING, because joined the two are forgeable: a QUOTED
 *  `'!GetAtt UserPool.Arn'` is a scalar whose VALUE is that text, and it would read exactly
 *  like the intrinsic while deploying as the text. Untagged, `tag` comes back `undefined`.
 *
 *  A path that resolves to no scalar throws rather than reading as "no tag here": an `!If`
 *  is a sequence, and a misspelt path is nothing at all. Reading an `!If`'s tag is `tagAt`. */
export const intrinsicAt = (
  doc: Document,
  ...path: (string | number)[]
): { tag: string | undefined; value: unknown } => {
  const node = doc.getIn(path, true);
  if (!isScalar(node)) throw new Error(`no scalar in the template at ${path.join('.')}`);
  return { tag: node.tag, value: node.value };
};

/** The tag at `path` whatever the node's kind, which is what reaches an `!If`.
 *
 *  An `!If` is a SEQUENCE, so `intrinsicAt` refuses it — and has to keep refusing it, or a
 *  scalar that quietly became a sequence would read as a value. But `toJS()` renders
 *  `!If [IsProd, a, b]` as `['IsProd', 'a', 'b']`, the identical array an untagged sequence
 *  written the same way renders to, so every assertion over the arms passes with the tag
 *  deleted. The tag is the only thing that differs, and only the node carries it.
 *
 *  A WIDER DOOR IS NOT A LOOSER ONE: the quoted imitation is still a scalar whose value is
 *  that text, so it still comes back untagged here. Only the value is not returned, because
 *  for a collection the value is the arms, which an assertion reads from `toJS()` anyway. */
export const tagAt = (doc: Document, ...path: (string | number)[]): string | undefined => {
  const node = doc.getIn(path, true);
  if (!isCollection(node) && !isScalar(node)) {
    throw new Error(`no scalar or collection in the template at ${path.join('.')}`);
  }
  return node.tag;
};

/** Every path in `doc` whose node carries `tag`, in document order.
 *
 *  DERIVED RATHER THAN LISTED, which is the half a per-site assertion cannot buy: a guard
 *  written beside each intrinsic catches one that is REMOVED and never one that is ADDED, and
 *  a hand-kept inventory of the same thing went stale inside one milestone here already.
 *
 *  It descends into a tagged node, because an intrinsic lives inside another one's arm.
 *
 *  THE TAG FORM ONLY. `Fn::If` written out long renders as an object, so a dropped key there
 *  changes what every assertion over the arms reads — it is the tag form that is forgeable.
 *
 *  VALUES ONLY, and the key is passed through UNCOERCED. A tag on a key is not representable
 *  in CloudFormation, so a key is a step and never a find. Uncoerced because `YAMLMap.get`
 *  compares strictly: a `2024:` key stringified here would come back as a path `tagAt` then
 *  says is not in the document — the two have to compose, since one derives what the other
 *  reads. A key that is neither a string nor a number is not addressable by either. */
export const taggedPaths = (doc: Document, tag: string): (string | number)[][] => {
  const found: (string | number)[][] = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    if (!isCollection(node) && !isScalar(node)) return;
    if (node.tag === tag) found.push(path);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const key = pair.key.value;
        if (typeof key === 'string' || typeof key === 'number') {
          walk(pair.value, [...path, key]);
        }
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => walk(item, [...path, index]));
    }
  };
  walk(doc.contents, []);
  return found;
};

/** The `Resource` intrinsic on the statement at `statements` that grants `action`.
 *
 *  FOUND BY THE ACTION, NEVER BY ITS INDEX, which is the whole of the difference: an index is a
 *  position, and a wider grant inserted above a statement silently becomes the one every
 *  assertion about it reads — while the statement it was about loses its tag unwatched.
 *
 *  AND EXACTLY ONE, or the other direction stays open: a SECOND statement granting the same action
 *  is what a widening adds, and taking the first match reads past it — the narrow grant is found,
 *  the assertion passes, and the deployed policy is the union of both.
 *
 *  MATCHED WHOLE. `cognito-idp:DescribeUserPoolClient` begins with `cognito-idp:DescribeUserPool`,
 *  so a substring match finds whichever is written first. Both spellings of `Action` are read,
 *  because it is a bare scalar on a statement holding one call and a sequence on one holding
 *  several — and a sequence is walked for the action rather than compared to it.
 *
 *  THE PATH RATHER THAN A RESOURCE ID, because a policy is written in three shapes — a SAM
 *  function's inline `Policies`, a role's `PolicyDocument` nested inside one, a standalone
 *  `AWS::IAM::Policy` whose document is the property itself — and a helper that guessed between
 *  them would be one more thing able to read the wrong statement.
 *
 *  EVERY WAY OF NOT FINDING ONE THROWS — a path that is no statement list, an action nobody
 *  grants, an action granted twice — or the assertion a grant carries could be made to pass by
 *  deleting the grant, or by granting the SAME action again on something wider.
 *
 *  A WILDCARD IS NOT THE SAME ACTION and is not counted here: `dsql:*` beside `dsql:DbConnectAdmin`
 *  is a second grant this reads straight past, because it matches the action string exactly rather
 *  than as IAM would resolve it. What bounds a second STATEMENT is the statement list's own LENGTH,
 *  asserted where a test claims to say everything a resource may reach; a second ACTION inside one
 *  statement is bounded by pinning that statement's `Action`, which is not this helper's to do.
 *
 *  The resource itself goes through `intrinsicAt`, so the tag is part of every answer and a
 *  wildcard resource comes back as the untagged scalar it is. */
export const grantAt = (
  doc: Document,
  statements: readonly (string | number)[],
  action: string,
): { tag: string | undefined; value: unknown } => {
  const node = doc.getIn(statements, true);
  if (!isSeq(node)) throw new Error(`no statement list in the template at ${statements.join('.')}`);
  const granting = node.items.flatMap((_, i) => {
    const carried = doc.getIn([...statements, i, 'Action'], true);
    if (isScalar(carried)) return carried.value === action ? [i] : [];
    const listed = isSeq(carried) && carried.items.some((a) => isScalar(a) && a.value === action);
    return listed ? [i] : [];
  });
  if (granting.length !== 1) {
    throw new Error(
      `${granting.length} statements grant ${action} at ${statements.join('.')}, wanted 1`,
    );
  }
  return intrinsicAt(doc, ...statements, granting[0], 'Resource');
};

/** The path to one function's environment variables, where most of these intrinsics live —
 *  written once because nine assertions across three files address the same five steps. */
export const envVars = (id: string) =>
  ['Resources', id, 'Properties', 'Environment', 'Variables'] as const;
