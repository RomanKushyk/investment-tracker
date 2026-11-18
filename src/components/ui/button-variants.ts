import { cva } from 'class-variance-authority';

import { TAP_44 } from './tap-target';

// Split out of Button.tsx so a link can reuse the classes on an <a>, while Button.tsx
// stays a component-only export for react-refresh.
export const buttonVariants = cva(
  // THE BORDER LIVES IN THE BASE, not in the outline variants: a button's height is
  // automatic, so a border only some variants carry is height only some variants have.
  // Every variant reserves the same ring and the filled ones paint it transparent, so
  // all variants of a size are isometric by construction.
  `inline-flex items-center justify-center gap-2 whitespace-nowrap border-[1.5px] font-display transition-control active:scale-[.97] disabled:pointer-events-none ${TAP_44}`,
  {
    variants: {
      variant: {
        // FILLED ACCENT EMPHASIS, rationed to one CTA per screen and still the default,
        // so a bare button spends that fill without naming it. Hover and pressed step
        // along the accent scale, never the fill mixed with white. *Interaction rules*
        primary:
          'border-transparent bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-pressed',
        // THE SECONDARY IS THE GLASS KNOB (B4). Neutral hover is an `ink` 5 % veil, never a
        // fade (H2); on the knob the veil is folded into its fill, so it steps on any ground.
        outline: 'border-transparent glass-button text-ink hover:bg-glass-button-hover',
        ghost: 'border-transparent bg-transparent text-ink hover:bg-ink/5',
        // The outline trigger opens a confirm; the fill is the dialog's armed action.
        outlineDanger: 'border-neg bg-transparent text-neg hover:bg-neg/8',
        danger: 'border-transparent bg-neg text-card hover:opacity-90',
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
        md: 'rounded-[10px] max-md:rounded-[11px] h-10 max-md:h-11 text-body',
        // `header` and `sm` do NOT: `header` is sized to sit beside the Date field, so
        // moving one breaks the pairing. Both reach the hit area through `TAP_44`.
        header: 'rounded-[10px] h-9 text-body',
        sm: 'rounded-[8px] h-[30px] text-small',
        // The dense size, for a control inside a list row: 26 at round(26 × .26) = 7.
        xs: 'rounded-[7px] h-[26px] text-small',
      },
      // A control that is BUSY must not read like one you may never press.
      disabledTone: {
        gated: 'disabled:opacity-50',
        busy: 'disabled:opacity-70',
      },
      // A ghost link flush with a card's text: a small padding, pulled back with the border's
      // 1.5px, so the label keeps the text's edge and the hover veil has an even box around it.
      inset: {
        normal: '',
        flushLeft: 'pl-2.5 pr-2.5 -ml-[11.5px]',
      },
    },
    // Each side's padding lives here, one per button, so two paddings never fight.
    compoundVariants: [
      { size: 'md', inset: 'normal', class: 'pl-5 pr-5' },
      { size: 'header', inset: 'normal', class: 'pl-[18px] pr-[18px]' },
      { size: 'sm', inset: 'normal', class: 'pl-3.5 pr-3.5' },
      { size: 'xs', inset: 'normal', class: 'pl-2.5 pr-2.5' },
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
