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
      <ScreenHeader title={t.screen.transactions.title} subtitle={t.screen.transactions.subtitle} />
      {/* COMPOSED LIKE `/payouts`, MIRRORED — the owner's instruction of
          2026-08-25, and it supersedes the arrangement `where-things-live.dc.html`
          § S4 drew and A35 shipped. The drawing put the form on the LEFT in the
          narrow column and the ledger on the right; every other page in the app
          reads content-then-side-blocks, so the ledger takes the wide track and
          the form becomes the side block. What the drawing settled stays settled
          — the form is the NARROW column and the ledger the wide one, which is
          the half A32 got wrong — only the side changed.

          `/payouts`' own expression, character for character: `1.6fr 1fr`,
          `items-start`, `gap-3.5`, one column below `lg`. `min-w-0` lives on the
          two cards, because an `fr` track floors at its content and both of
          these carry inputs and a scroll box with widths of their own. */}
      {/* NO `mb-3.5`, unlike `/payouts` — there it separates the grid from the
          log table below it, and here the grid is the LAST element on the page.
          It cost more than dead space: the ledger's height cap subtracts a
          documented 80 (`py-4` 32 + main's `pb-12` 48) and never counted those
          14, so at 1440 x 900 with the cap filled the document outgrew the
          viewport and the page scrolled — against D65 and against this route's
          own checkpoint. */}
      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <TransactionPanel />
      </div>
    </div>
  );
}
