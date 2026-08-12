import { cva } from 'class-variance-authority';

// Buttons per README §4 — the D56 radius rule, not the old 999px pill + D7
// tactile press on every button.
// Split into its own module (not Button.tsx) so link-styled-as-button spots
// (e.g. "Yield chart →") can reuse the classes on an <a>/<Link> while keeping
// Button.tsx a component-only export for react-refresh.
export const buttonVariants = cva(
  // The border lives in the BASE, not in the outline variants. A button's
  // height is automatic, so a border only some variants carry is 2px of height
  // only some variants have — which is why "Copy yesterday" (outline, 42.3px)
  // stood taller than "Save snapshot" (primary, 40.3px) beside it. Every
  // variant now reserves the same ring and the filled ones paint it
  // transparent, so all variants of a size are isometric by construction.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap border-[1.5px] font-display transition active:scale-[.97] disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-ink text-white hover:bg-sidebar-hover',
        outline: 'border-ink bg-transparent text-ink hover:bg-sidebar-text',
        ghost: 'border-transparent bg-transparent text-ink hover:opacity-85',
        // Destructive pair (design/extensions/settings.dc.html S6): the
        // outline trigger opens a confirm; the full neg fill is reserved for
        // the dialog's armed action.
        outlineDanger: 'border-neg bg-transparent text-neg hover:bg-neg/8',
        danger: 'border-transparent bg-neg text-card hover:opacity-90',
        // Inert done-state outline (S6 "Backup downloaded ✓": panel-border +
        // muted at FULL opacity per the reference — a whole-variant swap, not
        // a className override, so no two color utilities ever fight).
        outlineMuted: 'pointer-events-none border-panel-border bg-transparent text-muted',
      },
      // Explicit variant (not a className override) so callers needing bold
      // text don't end up with two font-weight utilities fighting over
      // generated-CSS order.
      weight: {
        semibold: 'font-semibold',
        bold: 'font-bold',
      },
      // Same rationale as `weight`: sizing as an explicit variant, never a
      // padding/font-size className collision. `md` = the former base classes
      // (every pre-existing button is byte-identical); `sm` is the compact
      // pill for tight shells (sidebar Backup button).
      // `header` = the P3 "Fetch quotes" control (daily-quotes-live.dc.html
      // S1): padding 8/18, 13px — one notch below `md` so it reads as a header
      // control beside the 36px Date field instead of a primary action.
      size: {
        // Height is EXPLICIT, not a padding sum. With `box-sizing: border-box`
        // the base ring is then absorbed rather than added, so a filled and an
        // outline button of the same size are identical at every device-pixel
        // ratio. Compensating with padding cannot do that: Chrome lays a
        // 1.5px border out as 1px at DPR 1 and 1.5px at DPR 2, so no single
        // padding restores the height on both. `header` is 36 on purpose — it
        // sits beside the 36px Date field (README §4).
        md: 'rounded-[10px] h-10 pr-5 text-[13.5px]',
        header: 'rounded-[10px] h-9 pr-[18px] text-[13px]',
        sm: 'rounded-[8px] h-[30px] pr-3.5 text-xs',
      },
      // Two disabled tiers, per the S1 drawings
      // (design/extensions/daily-quotes-live.dc.html: loading at opacity .7,
      // line 358; gated — nothing to fetch / demo — at .5, lines 385 + 396).
      // A control that is BUSY must not read like one you may never press.
      // Expressed as a variant rather than a className override for the same
      // reason as `weight`/`size`: two opacity utilities on one element would
      // fight over generated-CSS order.
      disabledTone: {
        gated: 'disabled:opacity-50',
        busy: 'disabled:opacity-70',
      },
      // Left padding as its own variant so ghost links flush against a card
      // edge (e.g. "Open Allocation →", design line 198 `padding-left:0`) can
      // drop it without a className px collision. The size-matched value
      // comes from the compound variants below.
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
