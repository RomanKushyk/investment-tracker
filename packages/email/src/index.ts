import { createElement } from 'react';
import { render as renderHtml, toPlainText } from 'react-email';

import type { Lang } from '@quirenote/core/money';

import { KIND, type Kind, type Params } from './kinds';
import { Layout } from './layout';

export type { Kind, Params } from './kinds';

export const KINDS = Object.keys(KIND) as Kind[];
export const LANGUAGES = ['uk', 'en'] as const satisfies readonly Lang[];

/** Classic Outlook ignores max-width, so around the card it reads a fixed 600 table from a
 *  conditional comment, which React cannot write; the layout leaves these markers for it. */
const MSO_MARKERS = {
  '<span data-mso-marker="open"></span>':
    '<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
  '<span data-mso-marker="close"></span>': '<!--[if mso]></td></tr></table><![endif]-->',
};

export type Rendered = { subject: string; preheader: string; html: string; text: string };

/** Renders one message. `params.origin` is the environment's own origin, never one taken from a
 *  request; every link and image in the result is on it. */
export async function render<K extends Kind>(
  kind: K,
  language: Lang,
  params: Params[K],
): Promise<Rendered> {
  const origin = params.origin;
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin)
    throw new Error(`not an https origin with no path: ${origin}`);

  const message = KIND[kind](language, params);
  const page = createElement(Layout, { language, origin, ...message });
  let html = await renderHtml(page);
  for (const [marker, comment] of Object.entries(MSO_MARKERS)) html = html.replace(marker, comment);
  assertLinksOn(html, origin);

  const text = toPlainText(html, {
    wordwrap: 78,
    selectors: [
      { selector: 'h1', options: { uppercase: false } },
      // The button prints its label; the URL follows on its own line from the link under it.
      { selector: 'a[data-action]', format: 'anchor', options: { ignoreHref: true } },
      // The footer's rule prints as the spec's `--`, and the footer runs on under it.
      { selector: 'hr', options: { length: 2, trailingLineBreaks: 1 } },
      { selector: 'p[data-text-footer]', format: 'paragraph', options: { leadingLineBreaks: 1 } },
    ],
  });
  return { subject: message.subject, preheader: message.preheader, html, text };
}

/** Throws on any href or src that is not `origin` itself or a path under it. */
export function assertLinksOn(html: string, origin: string): void {
  for (const [, url] of html.matchAll(/\b(?:href|src)="([^"]*)"/g))
    if (url !== origin && !url.startsWith(`${origin}/`))
      throw new Error(`a link off ${origin}: ${url}`);
}
