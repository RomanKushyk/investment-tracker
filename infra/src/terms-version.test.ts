// ONE VERSION, read by both ends: the form posts the terms version `/terms` prints, and the route
// accepts that version alone (*Legal documents*). Two copies would let the form send a version the
// route refuses, or the route record one no page showed.
import { TERMS_VERSION } from '@quirenote/core/terms';
import { describe, expect, it, vi } from 'vitest';

import { createApply } from '../../src/auth/apply';
import { REQUEST_BODY } from './applications';

describe('the terms version', () => {
  it('is an ISO date, the effective date the page prints', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${TERMS_VERSION}T00:00:00Z`).toISOString().slice(0, 10)).toBe(TERMS_VERSION);
  });

  it('is the one value the route publishes and requires', () => {
    const { schema } = REQUEST_BODY.content['application/json'];
    expect(schema.required).toContain('termsVersion');
    expect(schema.properties.termsVersion.enum).toEqual([TERMS_VERSION]);
  });

  it('is the value the form posts', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ status: 'received' }), { status: 202 }),
    );
    await createApply({ base: '', fetch })('new@quirenote.com', 'token');
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).termsVersion).toBe(TERMS_VERSION);
  });
});
