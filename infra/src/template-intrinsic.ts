import { isScalar, type Document } from 'yaml';

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
 *  is a sequence, and a misspelt path is nothing at all. */
export const intrinsicAt = (
  doc: Document,
  ...path: (string | number)[]
): { tag: string | undefined; value: unknown } => {
  const node = doc.getIn(path, true);
  if (!isScalar(node)) throw new Error(`no scalar in the template at ${path.join('.')}`);
  return { tag: node.tag, value: node.value };
};

/** The path to one function's environment variables, where most of these intrinsics live —
 *  written once because nine assertions across three files address the same five steps. */
export const envVars = (id: string) =>
  ['Resources', id, 'Properties', 'Environment', 'Variables'] as const;
