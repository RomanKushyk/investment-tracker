import { ScreenHeader } from '../components/ui/ScreenHeader';
import { TransactionPanel } from './TransactionPanel';
import { useT } from '../i18n/useT';

/**
 * The transaction ledger, on a route of its own.
 *
 * NOT A RENAME OF ANYTHING. `TransactionPanel` used to render inside `/`'s aside,
 * so recording a purchase and entering the day's prices were the same screen and
 * the ledger was capped at three rows. The quotes are a daily habit, a
 * transaction is occasional.
 *
 * The screen is thin on purpose: the panel owns the form, the write path and the
 * list, and nothing here re-derives anything.
 */
export function Transactions() {
  const t = useT();
  return (
    <div>
      <ScreenHeader title={t.screen.transactions.title} subtitle={t.screen.transactions.subtitle} />
      {/* COMPOSED LIKE `/payouts`, MIRRORED — the owner's instruction, and it
          supersedes the arrangement the drawing shipped. Every other page reads
          content-then-side-blocks, so the ledger takes the wide track and the form
          becomes the side block; what the drawing settled stays settled, and only the
          side changed. `min-w-0` lives on the two cards, because an `fr` track floors
          at its content and both carry widths of their own. */}
      {/* NO BOTTOM MARGIN, unlike `/payouts`, where it separates the grid from the log
          below it — here the grid is the LAST element on the page. It cost more than
          dead space: the ledger's height cap never counted it, so with the cap filled
          the document outgrew the viewport and the page scrolled. */}
      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <TransactionPanel />
      </div>
    </div>
  );
}
