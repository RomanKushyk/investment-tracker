import { describe, expect, it } from 'vitest';

import { render } from '@quirenote/email';

// The template package is consumed from source, so its .tsx must compile under THIS project's
// options; this import is what pulls it into `tsc -p infra`.
describe('the template package, as the backend imports it', () => {
  it('renders the invitation with the placeholder Cognito fills', async () => {
    const { html, text } = await render('invitation', 'uk', {
      origin: 'https://quirenote.com',
      email: 'reader@example.com',
      expiresAt: new Date('2026-11-14T12:32:00Z'),
    });
    expect(html).toContain('{####}');
    expect(text).toContain('https://quirenote.com/sign-in');
  });
});
