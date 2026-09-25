// `toJS()` DROPS AN UNKNOWN TAG AND KEEPS THE VALUE, which is the single fact every helper here
// exists for: after parsing, an intrinsic and a literal spelt the same way are indistinguishable,
// and the literal deploys. Only the document node carries the tag.
import { isCollection, isMap, isNode, isScalar, isSeq, type Document, type YAMLMap } from 'yaml';

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

/** EXACTLY ONE statement, READ WHOLE: its `Effect`, every action, key and tag, so a `Deny`, a third
 *  action or a `Condition` fails it. One carrying none, a wildcard too, is read past: count the list. */
export const grantAt = (
  doc: Document,
  statements: readonly (string | number)[],
  actions: string | readonly string[],
): { tag: string | undefined; value: unknown } => {
  const node = doc.getIn(statements, true);
  if (!isSeq(node)) throw new Error(`no statement list in the template at ${statements.join('.')}`);
  const wanted = typeof actions === 'string' ? [actions] : actions;
  // A tag stays in the reading: an intrinsic that spells the literal deploys what it resolves to.
  const spelt = (n: unknown) =>
    isScalar(n) ? `${n.tag ? `${n.tag} ` : ''}${String(n.value)}` : String(n);
  const carriedBy = (i: number): unknown[] => {
    const carried = doc.getIn([...statements, i, 'Action'], true);
    return isSeq(carried) ? carried.items : carried === undefined ? [] : [carried];
  };
  // IAM reads an action's prefix and name case-insensitively, so a respelling is the same grant.
  const lower = (list: readonly string[]) => list.map((a) => a.toLowerCase()).sort();
  const sought = lower(wanted);
  const granting = node.items.flatMap((_, i) =>
    carriedBy(i).some((a) => isScalar(a) && sought.includes(String(a.value).toLowerCase()))
      ? [i]
      : [],
  );
  if (granting.length !== 1) {
    throw new Error(
      `${granting.length} statements grant ${wanted.join(' or ')} at ${statements.join('.')}, wanted 1`,
    );
  }
  const [i] = granting;
  const at = `the statement granting ${wanted.join(', ')} at ${[...statements, i].join('.')}`;
  const effect = doc.getIn([...statements, i, 'Effect'], true);
  if (effect === undefined || spelt(effect) !== 'Allow') {
    const found = effect === undefined ? 'has no Effect' : `has Effect ${spelt(effect)}`;
    throw new Error(`${at} ${found}, wanted Allow`);
  }
  const carried = carriedBy(i).map(spelt);
  if (JSON.stringify(lower(carried)) !== JSON.stringify(sought)) {
    throw new Error(`${at} carries ${carried.join(', ')}, wanted ${wanted.join(', ')}`);
  }
  // A statement is found only through its `Action`, so it is a map.
  const statement = doc.getIn([...statements, i], true) as YAMLMap;
  for (const pair of statement.items) {
    const key = isScalar(pair.key) ? pair.key.value : pair.key;
    if (!['Sid', 'Effect', 'Action', 'Resource'].includes(key as string)) {
      throw new Error(`${at} carries ${String(key)}, which grantAt does not read`);
    }
  }
  // The tags the reads above step past: on the statement, a key, or the `Action` list itself.
  const around = [statement, doc.getIn([...statements, i, 'Action'], true)];
  const tagged = [...around, ...statement.items.map((p) => p.key)].find((n) => isNode(n) && n.tag);
  if (isNode(tagged)) throw new Error(`${at} carries ${tagged.tag}, which grantAt does not read`);
  return intrinsicAt(doc, ...statements, i, 'Resource');
};

/** The five steps to one function's environment variables, addressed from several suites. */
export const envVars = (id: string) =>
  ['Resources', id, 'Properties', 'Environment', 'Variables'] as const;
