import { useT } from '../../i18n/useT';

// The S9d chip's warn treatment: a short ledger is a caution, not an error. One line where
// it fits (radius 6 by the shape rule), wrapping in a narrow card rather than overflowing it.
export function CashShortChip({ className = '' }: { className?: string }) {
  const t = useT();
  return (
    <span
      role="status"
      title={t.analytics.cashShortDetail}
      className={`inline-block max-w-full animate-in rounded-[6px] bg-warn-tint px-3 py-1 text-xs font-semibold text-warn-tint-text duration-200 zoom-in-95 fade-in ${className}`}
    >
      {t.analytics.cashShort}
      <span className="sr-only"> — {t.analytics.cashShortDetail}</span>
    </span>
  );
}
