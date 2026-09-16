// `toJS()` DROPS AN UNKNOWN TAG AND KEEPS THE VALUE, which is the single fact every helper here
// exists for: after parsing, an intrinsic and a literal spelt the same way are indistinguishable,
// and the literal deploys. Only the document node carries the tag.
import { isCollection, isMap, isScalar, isSeq, type Document } from 'yaml';

/** Tag and value kept APART, because joined they are forgeable: a quoted `'!GetAtt UserPool.Arn'`
 *  is a scalar whose VALUE is that text. A path resolving to no scalar throws rather than reading
 *  as "no tag here" — an `!If` is a sequence, and `tagAt` is what reads one. */
export const intrinsicAt = (
  doc: Document,
  ...path: (string | number)[]
): { tag: string | undefined; value: unknown } => {
  const node = doc.getIn(path, true);
  if (!isScalar(node)) throw new Error(`no scalar in the template at ${path.join('.')}`);
  return { tag: node.tag, value: node.value };
};

/** The tag whatever the node's kind, which is what reaches an `!If`: `toJS()` renders it as the
 *  identical array an untagged sequence renders to, so assertions over the arms pass without it. */
export const tagAt = (doc: Document, ...path: (string | number)[]): string | undefined => {
  const node = doc.getIn(path, true);
  if (!isCollection(node) && !isScalar(node)) {
    throw new Error(`no scalar or collection in the template at ${path.join('.')}`);
  }
  return node.tag;
};

/**
 * Every path whose node is a COLLECTION carrying a tag. Derived rather than listed, because a
 * guard beside each intrinsic catches one that is REMOVED and never one that is ADDED. KEYED ON
 * THE COLLECTION, NOT THE TAG NAME: the hazard is the shape, so keyed on names the next `!Or`
 * would arrive outside the set and be guarded by nothing. WHAT IT CANNOT ADDRESS IT THROWS ON
 * rather than stepping over, because stepping over one takes the whole SUBTREE while the document
 * parses with no errors — and this set is read by equality, so an unreached intrinsic reddens
 * nothing.
 */
export const taggedCollections = (doc: Document): [(string | number)[], string][] => {
  const found: [(string | number)[], string][] = [];
  const walk = (node: unknown, path: (string | number)[]): void => {
    // The root BY ITS LENGTH, not by a falsy join: an empty-string key joins to `''` too.
    const shown = path.length ? path.join('.') : 'the document root';
    if (isScalar(node)) return;
    if (!isCollection(node)) {
      throw new Error(`no scalar or collection in the template at ${shown}`);
    }
    if (node.tag) found.push([path, node.tag]);
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = isScalar(pair.key) ? pair.key.value : undefined;
        // `NaN` is excluded though it is a number, and the key passes through UNCOERCED:
        // `YAMLMap.get` compares strictly, so a path derived here has to be one `tagAt` can read.
        if (typeof key !== 'string' && (typeof key !== 'number' || Number.isNaN(key))) {
          throw new Error(`no addressable key in the template under ${shown}: ${String(pair.key)}`);
        }
        walk(pair.value, [...path, key]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, index) => walk(item, [...path, index]));
    }
  };
  walk(doc.contents, []);
  return found;
};

/** FOUND BY THE ACTION, NEVER BY ITS INDEX, and EXACTLY ONE: a wider grant inserted above would
 *  otherwise become the statement every assertion reads. Matched whole, because
 *  `cognito-idp:DescribeUserPoolClient` begins with `cognito-idp:DescribeUserPool`. A wildcard is
 *  not the same action and is read past; a second statement is bounded by the list's own LENGTH. */
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

/** The five steps to one function's environment variables, addressed from several suites. */
export const envVars = (id: string) =>
  ['Resources', id, 'Properties', 'Environment', 'Variables'] as const;
