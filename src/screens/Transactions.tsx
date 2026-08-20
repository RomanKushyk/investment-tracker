import { ScreenHeader } from '../components/ui/ScreenHeader';
import { TransactionPanel } from './TransactionPanel';
import { useT } from '../i18n/useT';

/**
 * The transaction ledger, on a route of its own (A32, brief § S4).
 *
 * NOT A RENAME OF ANYTHING. `TransactionPanel` used to render inside `/`'s
 * aside, beside the daily quotes — so recording a purchase and entering the
 * day's prices were the same screen, and the ledger was capped at three rows to
 * keep from crowding the ritual. The `Ввід` group now holds two items because
 * this is genuinely a second thing: the quotes are a daily habit, a transaction
 * is occasional.
 *
 * The screen is thin on purpose. The panel owns the form, the write path and
 * the list; nothing here re-derives anything, and no read-only edit control is
 * offered because every row on this screen is already a write.
 */
export function Transactions() {
  const t = useT();
  return (
    <div>
      <ScreenHeader
        title={t.screen.transactions.title}
        subtitle={t.screen.transactions.subtitle}
      />
      {/* The panel renders two cards — the form, then the ledger — in a column
          that is narrower than the screen at desktop widths, because a form
          stretched to 1196 px reads as a settings page rather than an entry. */}
      <div className="flex max-w-[560px] flex-col gap-3.5">
        <TransactionPanel />
      </div>
    </div>
  );
}
