import { cva } from 'class-variance-authority';

// Pill buttons per README §4 (radius 999px) + D7 tactile press on every button.
// Split into its own module (not Button.tsx) so link-styled-as-button spots
// (e.g. "Yield chart →") can reuse the classes on an <a>/<Link> while keeping
// Button.tsx a component-only export for react-refresh.
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 font-display text-[13.5px] font-semibold transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:bg-sidebar-hover',
        outline: 'border-[1.5px] border-ink bg-transparent text-ink hover:bg-sidebar-text',
        ghost: 'bg-transparent text-ink hover:opacity-85',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);
