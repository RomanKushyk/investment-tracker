import { cva } from 'class-variance-authority';

// THE ONE FIELD RECIPE, so no copy can drift from it; `field-border.test.ts` refuses a copy.
// Width, padding, type and the hit area stay with the caller, as `className`.

export const FIELD_FILLS = ['page', 'card'] as const;
export const FIELD_EDGES = ['rest', 'invalid', 'saved', 'proposed', 'quiet'] as const;
export type FieldFill = (typeof FIELD_FILLS)[number];
export type FieldEdge = (typeof FIELD_EDGES)[number];

// `Record` over the lists, so a state added to one and not the other is a type error.
const fills: Record<FieldFill, string> = {
  // `page` is the signed field fill; `card` stays where a surface still draws it.
  page: 'bg-page',
  card: 'bg-card',
};

// ONE AXIS OF STATES, never a flag per caller. Only `rest` and `proposed` hover: a hover on
// `invalid` would replace the error edge with ink.
const edges: Record<FieldEdge, string> = {
  rest: 'border-field-border hover:border-ink',
  invalid: 'border-neg',
  saved: 'border-pos-border',
  // A dash is how a field says "proposed".
  proposed: 'border-dashed border-field-border hover:border-ink',
  // QuoteRow's empty field, which has never hovered.
  quiet: 'border-field-border',
};

const recipe = cva('h-9 rounded-[9px] border transition-control', {
  variants: { fill: fills, edge: edges },
  defaultVariants: { fill: 'page', edge: 'rest' },
});

/** Typed without cva's `null`, which drops a variant's classes instead of taking the default —
 *  a field with no edge class inherits `currentColor`. */
export function fieldVariants({
  fill,
  edge,
  className,
}: { fill?: FieldFill; edge?: FieldEdge; className?: string } = {}): string {
  return recipe({ fill, edge, className });
}
