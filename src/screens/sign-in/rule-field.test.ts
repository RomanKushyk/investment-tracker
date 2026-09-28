import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/messages';
import { RuleField } from './parts';
import { ON_THE_FIELD, ON_THE_RULE } from './refusals';

// The field's line (`password-reuse.dc.html`): the rule before any refusal, and after one the
// refusal's own sentence, with the rule kept in the line, hidden, so the line keeps its height.
const RULE = en.auth.setPassword.rule;
const REUSED = en.auth.setPassword.reused;

function render(refusal?: { n: number; sentence: string }) {
  const html = renderToStaticMarkup(
    createElement(RuleField, {
      label: en.auth.setPassword.label,
      rule: RULE,
      refusal,
      children: (id: string, describedBy: string) =>
        createElement('input', { id, 'aria-describedby': describedBy }),
    }),
  );
  const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(describedBy, 'the input names no description').toBeDefined();
  const at = html.indexOf(`id="${describedBy}"`);
  expect(at, 'nothing carries the description’s id').toBeGreaterThan(-1);
  // The described element whole, from its tag to the close that matches it.
  const start = html.lastIndexOf('<span', at);
  let depth = 0;
  for (const tag of html.slice(start).matchAll(/<\/?span\b/g)) {
    depth += tag[0] === '<span' ? 1 : -1;
    if (depth === 0) {
      return { html, described: html.slice(start, start + tag.index + '</span>'.length) };
    }
  }
  throw new Error('the described element never closes');
}

describe('the new password’s line', () => {
  it('holds the rule, muted, before any refusal', () => {
    const { html, described } = render();
    expect(described).toContain(RULE);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-hidden="true">');
  });

  it.each([
    ['the rule itself, for a weak password', RULE],
    ['a sentence of its own, for the temporary password', REUSED],
  ])('says %s as an alert with the glyph, in neg', (_, sentence) => {
    const { described } = render({ n: 1, sentence });
    expect(described).toMatch(/^<span[^>]*role="alert"[^>]*class="[^"]*\btext-neg\b/);
    expect(described).toContain('lucide-circle-alert');
    expect(described).toContain(sentence);
  });

  it('keeps the rule in the line under a sentence of its own, hidden, so its height holds', () => {
    const { html, described } = render({ n: 1, sentence: REUSED });
    expect(described).not.toContain(RULE);
    const rule = RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(html).toMatch(
      new RegExp(`<span aria-hidden="true" class="[^"]*\\binvisible\\b[^"]*">${rule}</span>`),
    );
  });

  // Both of the first sign-in's refusals are said here, and so neither under the button.
  it('is where the page says both of the new password’s refusals', () => {
    expect(ON_THE_RULE).toEqual(['rule', 'reused']);
    for (const reason of ON_THE_RULE) expect(ON_THE_FIELD).toContain(reason);
  });
});
