import { cva } from 'class-variance-authority';

// Pill buttons per README §4 (radius 999px) + D7 tactile press on every button.
// Split into its own module (not Button.tsx) so link-styled-as-button spots
// (e.g. "Yield chart →") can reuse the classes on an <a>/<Link> while keeping
// Button.tsx a component-only export for react-refresh.
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full pr-5 py-2.5 font-display text-[13.5px] transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:bg-sidebar-hover',
        outline: 'border-[1.5px] border-ink bg-transparent text-ink hover:bg-sidebar-text',
        ghost: 'bg-transparent text-ink hover:opacity-85',
      },
      // Explicit variant (not a className override) so callers needing bold
      // text don't end up with two font-weight utilities fighting over
      // generated-CSS order.
      weight: {
        semibold: 'font-semibold',
        bold: 'font-bold',
      },
      // Left padding as its own variant (base only sets pr-5) so ghost links
      // flush against a card edge (e.g. "Open Allocation →", design line 198
      // `padding-left:0`) can drop it without a className px collision.
      inset: {
        normal: 'pl-5',
        flushLeft: 'pl-0',
      },
    },
    defaultVariants: { variant: 'primary', weight: 'semibold', inset: 'normal' },
  },
);
