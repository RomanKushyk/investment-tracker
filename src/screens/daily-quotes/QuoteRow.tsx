import { AssetAvatar } from '../../components/ui/AssetAvatar';
import { Card } from '../../components/ui/Card';
import { yieldSinceStart } from '../../core/derive';
import { fmtPct, fmtProse, fmtTable } from '../../core/money';
import type { Asset } from '../../core/types';
import { quoteInputSchema } from '../../core/schemas';

export function QuoteRow({
  asset,
  raw,
  yesterday,
  onChange,
}: {
  asset: Asset;
  raw: string | undefined; // undefined = untouched (not yet prefilled or typed)
  yesterday: number | undefined;
  onChange: (v: string) => void;
}) {
  const parsed = raw !== undefined ? quoteInputSchema.safeParse(raw) : undefined;
  const filled = parsed?.success === true;
  const delta =
    filled && yesterday !== undefined ? yieldSinceStart(parsed.data, yesterday) : undefined;

  return (
    <Card className="flex flex-wrap animate-in items-center gap-x-4 gap-y-2 fade-in px-5 py-3.5 duration-300 slide-in-from-bottom-1">
      <AssetAvatar code={asset.code} colorKey={asset.colorKey} />
      <div className="min-w-[110px] flex-1 break-words">
        <div className="text-sm font-semibold">{asset.name}</div>
        <div className="text-[11px] text-muted">
          {yesterday !== undefined ? `${fmtProse(yesterday)} yesterday` : '—'}
        </div>
      </div>
      <input
        id={`quote-${asset.id}`}
        name={`quote-${asset.id}`}
        className={
          'bg-card h-9 max-w-[160px] min-w-[90px] flex-1 rounded-[10px] border px-3 text-right font-body text-[13px] transition ' +
          (filled ? 'border-pos-border' : 'border-hairline')
        }
        value={raw ?? ''}
        placeholder={yesterday !== undefined ? fmtTable(yesterday) : undefined}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-label={`${asset.name} quote`}
      />
      <span
        key={delta ?? 'empty'}
        className={
          'w-[52px] animate-in fade-in text-right text-xs font-bold zoom-in-95 duration-150 ' +
          (delta === undefined ? 'text-faint' : delta < 0 ? 'text-neg' : 'text-pos')
        }
      >
        {delta === undefined ? '—' : fmtPct(delta)}
      </span>
    </Card>
  );
}
