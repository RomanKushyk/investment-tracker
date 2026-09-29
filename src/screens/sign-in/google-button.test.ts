import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/messages';
import { OrGoogle } from './GoogleButton';

// `auth-surface.dc.html` T1: "without it neither the rule nor the button renders — the card runs
// from «Продовжити» straight to the link".
const render = (on: boolean, busy = false) =>
  renderToStaticMarkup(
    createElement(OrGoogle, { on, busy, copy: en.auth.google, onClick: () => undefined }),
  );

describe('Google on the sign-in card', () => {
  it('draws neither the rule nor the button while Google is off', () => {
    expect(render(false)).toBe('');
  });

  it('draws the rule, then a button carrying Google’s G and its label', () => {
    const html = render(true);
    const rule = html.indexOf(`>${en.auth.google.or}<`);
    const button = html.indexOf('<button');
    expect(rule, 'no rule').toBeGreaterThan(-1);
    expect(button, 'the button is not under the rule').toBeGreaterThan(rule);
    expect(html.slice(button)).toContain(en.auth.google.continue);
    // The G says nothing the label does not: decorative, so no name of its own.
    expect(html.slice(button)).toMatch(/<img[^>]*alt=""/);
  });

  it('keeps its label while busy, and cannot be pressed again', () => {
    const html = render(true, true);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain(en.auth.google.continue);
  });
});
