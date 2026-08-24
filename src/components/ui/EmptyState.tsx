// Friendly placeholder swapped in for a chart/table with no data yet
// (README §10.7 empty states) — keeps the card's shape instead of collapsing
// to nothing, so the screen doesn't look broken.
export function EmptyState({ message, height = 220 }: { message: string; height?: number }) {
  return (
    <div
      className="grid place-items-center px-6 text-center text-[13px] text-muted"
      style={{ height }}
    >
      {message}
    </div>
  );
}
