import { cva } from 'class-variance-authority';

import { TAP_44 } from './tap-target';

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
  // `TAP_44` gives every size a 44 x 44 pressable region below the breakpoint
  // without touching a drawn box; on `md`, which is already 44 there, it is
  // inert because the overlay never shrinks below the control it sits in.
  `inline-flex items-center justify-center gap-2 whitespace-nowrap border-[1.5px] font-display transition active:scale-[.97] disabled:pointer-events-none ${TAP_44}`,
  {
    variants: {
      variant: {
        // FILLED EMPHASIS (appearance-language.dc.html FINDING 3): `bg-ink` is
        // correct in both themes — a dark fill in light, a light fill in dark.
        // The bug was the paired `text-white`, a literal that cannot invert
        // with it. `text-page` does, and in dark it gives #141416 on #eceae7 =
        // 15.32:1, the reference's own figure, reproduced.
        // In LIGHT the swap costs #ffffff -> #f6f5f3, which is 15.07:1 -> 13.84:1
        // on `ink`. The reference calls that "0.4% of luminance"; measured, the
        // relative luminance drop is 8.63%. The decision stands either way —
        // 13.84:1 has an enormous margin — but the figure does not, so the
        // measured pair is recorded here rather than the quoted one.
        // Not to be confused with the inverted planes (`KpiCard` dark, the
        // `Dialog` overlay), which keep white and change their FILL instead.
        // The hover fill was `sidebar-hover`, a RAIL token — the same borrowing
        // the outline variant below was already fixed for. In light it happened
        // to read as "ink, a little lighter"; in dark the rail token is DARK
        // while `bg-ink` is near-white, so hovering flipped the fill to #26262b
        // under #141416 text and the label vanished into it. `ink-hover` is the
        // fill's own token and moves with it in both themes.
        primary: 'border-transparent bg-ink text-page hover:bg-ink-hover',
        // The hover fill was `sidebar-text`, a RAIL token borrowed onto a light
        // surface. Here `text-ink` is right and must invert — so in dark the
        // label went to #eceae7 and the hover fill went to #eceae7 with it, and
        // the button emptied on hover. `panel` is the surface-step token this
        // always wanted: #eceae7 light (vs the #e9e8e6 it replaces — three
        // units of grey, below the threshold of sight) and #232327 in dark.
        outline: 'border-ink bg-transparent text-ink hover:bg-panel',
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
        // `md` IS ONE OF THE TWO DELIBERATE G-2 EXCEPTIONS, and it is the size
        // variant rather than two call sites: `md` is the primary-action size,
        // there is no instance of it for which 44 is wrong below the
        // breakpoint, and giving two individual buttons their own height would
        // mean a third size that exists on two screens.
        // The radius is RECOMPUTED, not inherited: round(44 × 0.26) = 11.
        md: 'rounded-[10px] max-md:rounded-[11px] h-10 max-md:h-11 pr-5 text-[13.5px]',
        // `header` and `sm` do NOT change, and `header` is the clearer case: it
        // is 36 precisely so it sits beside the 36px Date field (README §4), so
        // moving one without the other breaks the pairing. Both reach 44 by hit
        // area instead — see `TAP_44` in the base class above.
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
