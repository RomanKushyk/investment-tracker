// @vitest-environment jsdom
// The empty card (empty-loading-error.md § Signed, E2): a 24 px `muted` glyph at stroke 2, hidden
// from screen readers, above the sentence in the body role, ≤ 340 wide, in a stack that keeps the
// card's height — and no action of its own.
import { cleanup, render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState';

afterEach(cleanup);

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];

describe('EmptyState', () => {
  it('draws its glyph above the sentence, muted, 24 px, stroke 2 and aria-hidden', () => {
    render(<EmptyState message="Порожньо." icon={Wallet} />);
    const text = screen.getByText('Порожньо.');
    const glyphs = document.querySelectorAll('svg');
    expect(glyphs).toHaveLength(1);
    const glyph = glyphs[0];
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    expect(classes(glyph)).toEqual(expect.arrayContaining(['size-6', 'text-muted']));
    expect(glyph.getAttribute('stroke-width')).toBe('2');
    expect(glyph.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The body role's own line height: no line height lives outside the roles (*Language, numbers, fonts*).
  it('sets the sentence in the body role, centred, at most 340 wide, 10 below the glyph', () => {
    render(<EmptyState message="Порожньо." icon={Wallet} />);
    const text = screen.getByText('Порожньо.');
    expect(classes(text)).toEqual(
      expect.arrayContaining(['font-sans', 'text-body', 'max-w-[340px]', 'text-center']),
    );
    expect(classes(text.parentElement!)).toEqual(
      expect.arrayContaining(['flex-col', 'items-center', 'justify-center', 'gap-2.5']),
    );
  });

  it('keeps the card height as a floor, so a taller stack grows the card instead of spilling', () => {
    render(<EmptyState message="Порожньо." icon={Wallet} height={44} />);
    const root = screen.getByText('Порожньо.').parentElement!;
    expect(root.style.minHeight).toBe('44px');
    expect(root.style.height).toBe('');
  });

  it('draws no glyph when given none — a space too small for one keeps the sentence alone', () => {
    render(<EmptyState message="Порожньо." height={40} />);
    expect(document.querySelector('svg')).toBeNull();
  });

  it('carries no action: no button and no link', () => {
    render(<EmptyState message="Порожньо." icon={Wallet} />);
    expect(document.querySelector('button, a, [role="button"], [role="link"]')).toBeNull();
  });
});
