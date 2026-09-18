// It holds the card's shape rather than collapsing to nothing, so a chart with
// no data yet does not read as broken.
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
