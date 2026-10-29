import type { ReactNode } from 'react';

// A link stays inside its sentence as `[text](href)`, so a translation can move it: split copy
// cannot be reordered (Mozilla l10n, "Avoid concatenations, use placeholders instead").
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** The sentence with each link drawn by `link`, the text between them left as it is. */
export function rich(
  text: string,
  link: (label: string, href: string, key: number) => ReactNode,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(LINK)) {
    parts.push(text.slice(from, match.index));
    parts.push(link(match[1]!, match[2]!, match.index));
    from = match.index + match[0].length;
  }
  parts.push(text.slice(from));
  return parts;
}
