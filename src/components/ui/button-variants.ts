import { cva } from 'class-variance-authority';

import { TAP_44 } from './tap-target';

// Split out of Button.tsx so a link can reuse the classes on an <a>, while Button.tsx
// stays a component-only export for react-refresh.
export const buttonVariants = cva(
  // THE BORDER LIVES IN THE BASE, not in the outline variants: a button's height is
  // automatic, so a border only some variants carry is height only some variants have.
  // Every variant reserves the same ring and the filled ones paint it transparent, so
  // all variants of a size are isometric by construction.
  `inline-flex items-center justify-center gap-2 whitespace-nowrap border-[1.5px] font-display transition active:scale-[.97] disabled:pointer-events-none ${TAP_44}`,
  {
    variants: {
      variant: {
        // FILLED ACCENT EMPHASIS, rationed to one CTA per screen and still the default,
        // so a bare button spends that fill without naming it. Hover and pressed step
        // along the accent scale, never the fill mixed with white. *Interaction rules*
        primary:
          'border-transparent bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-pressed',
        // `panel` and not a rail token: `text-ink` inverts with the theme and a rail
        // token does not, so in dark both met at near-white and the button emptied.
        outline: 'border-ink bg-transparent text-ink hover:bg-panel',
        ghost: 'border-transparent bg-transparent text-ink hover:opacity-85',
        // The outline trigger opens a confirm; the fill is the dialog's armed action.
        outlineDanger: 'border-neg bg-transparent text-neg hover:bg-neg/8',
        danger: 'border-transparent bg-neg text-card hover:opacity-90',
        outlineMuted: 'pointer-events-none border-panel-border bg-transparent text-muted',
      },
      // EVERY AXIS IS A VARIANT, NEVER A className: two utilities of one kind fight
      // over generated-CSS order, and the winner is whichever Tailwind emitted last.
      weight: {
        semibold: 'font-semibold',
        bold: 'font-bold',
      },
      size: {
        // Height is EXPLICIT, not a padding sum: the base ring is then absorbed rather
        // than added. Padding cannot do the same job, because Chrome lays a 1.5px
        // border out as 1px at DPR 1 and 1.5px at DPR 2, so no single value restores
        // the height on both.
        // `md` IS A DECLARED EXCEPTION to the hit-area rule, taken on the size variant
        // because it is the primary-action size and there is no instance of it for
        // which the grown box is wrong. Its radius is RECOMPUTED from the new short
        // side, never inherited. *Shape system*
        md: 'rounded-[10px] max-md:rounded-[11px] h-10 max-md:h-11 pr-5 text-[13.5px]',
        // `header` and `sm` do NOT: `header` is sized to sit beside the Date field, so
        // moving one breaks the pairing. Both reach the hit area through `TAP_44`.
        header: 'rounded-[10px] h-9 pr-[18px] text-[13px]',
        sm: 'rounded-[8px] h-[30px] pr-3.5 text-xs',
      },
      // A control that is BUSY must not read like one you may never press.
      disabledTone: {
        gated: 'disabled:opacity-50',
        busy: 'disabled:opacity-70',
      },
      // So a ghost link flush against a card edge can drop its left padding.
      inset: {
        normal: '',
        flushLeft: 'border-l-0 pl-0',
      },
    },
    compoundVariants: [
      { size: 'md', inset: 'normal', class: 'pl-5' },
      { size: 'header', inset: 'normal', class: 'pl-[18px]' },
      { size: 'sm', inset: 'normal', class: 'pl-3.5' },
    ],
    defaultVariants: {
      variant: 'primary',
      weight: 'semibold',
      size: 'md',
      inset: 'normal',
      disabledTone: 'gated',
    },
  },
);
