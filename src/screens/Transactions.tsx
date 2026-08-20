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
      {/* TWO COLUMNS, AND THEY ARE NOT THIS TASK'S INVENTION (A35).
          `design/extensions/where-things-live.dc.html` § S4 has drawn them since
          2026-08-19 — its sheet is captioned "the form keeps its 360 column; the
          ledger takes the rest" — and A32 shipped a single stacked
          `max-w-[560px]` column instead, which is the half-empty screen the
          owner reported.

          THE SAME MECHANISM `/` USES, and the first draft of this reached for a
          second one (A35 review). `DailyQuotes.tsx` solves the identical problem
          — two columns that must not strand a fixed-width child on a wrapped
          line — as `@container flex flex-wrap` with GROW-1 bases and a
          container-query cap. That shape matches the reference's literal
          `flex-wrap:wrap` markup, keeps ONE idiom across both screens, and
          keeps a width cap at every size. A `flex-col` → `flex-row` query
          looked equivalent and was not: it dropped `max-w-[560px]`, so between
          a 561 and a 943 container the form stretched to the full width — the
          exact "a form stretched wide reads as a settings page" failure the
          comment beside it claimed to prevent.

          GROW 1 WITH A CAP, not the drawing's `flex:0 1 360px`, and the
          rendered result is identical: above 944 `max-w-[360px]` freezes the
          form at 360 and flexbox hands its unused space to the ledger. Grow 0
          would strand a wrapped form at 360 on a line of its own.

          944 = 360 + 24 + 560, read off the drawing rather than chosen, and it
          is also where `flex-wrap` breaks the line by itself — the bases and
          the query agree by construction rather than by coincidence.

          `gap-x-6 gap-y-3.5` — 24 BETWEEN the columns as drawn, 14 between them
          when stacked, which is what ships today. Three numbers exist for the
          stacked gap (14 today, the row's 24, the reference's 12 at 360); a
          two-axis gap keeps the drawn one without moving a shipped mobile
          screen. */}
      <div className="@container flex flex-wrap items-start gap-x-6 gap-y-3.5">
        <TransactionPanel />
      </div>
    </div>
  );
}
