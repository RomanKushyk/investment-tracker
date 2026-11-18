import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FetchQuotesButton } from './FetchQuotesButton';

// The brief (controls-and-overlays.md § Settled by the brief), with wave 26's copy: a fetch that
// worked flashes in `ink` with the check, «Оновлено 13:05», and spends no `pos`.
const flash = renderToStaticMarkup(
  <FetchQuotesButton
    state="success"
    freshness={undefined}
    // 13:05 in Kyiv, which is UTC+2 in November.
    flashAt="2026-11-18T11:05:00.000Z"
    onFetch={() => undefined}
  />,
);

describe('the fetch flash', () => {
  it('reads «Оновлено» and the time', () => {
    expect(flash).toContain('Оновлено 13:05');
  });

  it('paints in ink, with no pos anywhere on the button', () => {
    const button = flash.slice(flash.indexOf('<button'), flash.indexOf('</button>'));
    expect(button).toContain('text-ink');
    expect(button).not.toMatch(/\b(?:text|border)-pos\b/);
  });

  it('shows the check in place of the refresh glyph', () => {
    expect(flash).toContain('lucide-check');
    expect(flash).not.toContain('lucide-refresh');
  });
});
