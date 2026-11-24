import type { LucideIcon } from 'lucide-react';

// A floor of the card's height, so an empty chart keeps its shape, under the subject's nav glyph (E2).
// The sentence is prose: Manrope, even inside a table cell's data face.
export function EmptyState({
  message,
  icon: Icon,
  height = 220,
}: {
  message: string;
  icon?: LucideIcon;
  height?: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2.5 px-6"
      style={{ minHeight: height }}
    >
      {Icon && <Icon aria-hidden="true" className="size-6 text-muted" strokeWidth={2} />}
      <p className="max-w-[340px] text-center font-sans text-body text-muted">{message}</p>
    </div>
  );
}
