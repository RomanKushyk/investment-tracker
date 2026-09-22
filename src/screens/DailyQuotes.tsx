import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import { ParseSkips } from '../components/ui/ParseSkips';
import { ReminderStrip } from '../components/ui/ReminderStrip';
import { useAssets, useSaveSnapshot, useSnapshots, useTransactions } from '../hooks/queries';
import { couponReminderId, dueCoupons } from '@quirenote/core/accrual';
import { dayBefore, kyivDateIso, todayIso } from '@quirenote/core/dates';
import { investedByAsset, latestQuotes, ledgerUnits, unitsByAsset } from '@quirenote/core/derive';
import type { QuoteVerdict } from '@quirenote/core/inzhur/dcf';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { useDraft } from '../state/draft';
import { useSettings } from '../state/settings';
import { CouponDueCard } from './daily-quotes/CouponDueCard';
import { FetchQuotesButton } from './daily-quotes/FetchQuotesButton';
import { collectQuotes, maxSavedAt, yesterdayQuote } from './daily-quotes/quotes';
import {
  accrualSuggestion,
  bondQuoteCheck,
  couponPrefill,
  feedSchedule,
} from './daily-quotes/suggestions';
import { useQuoteFetch } from './daily-quotes/useQuoteFetch';
import { QuoteRow } from './daily-quotes/QuoteRow';
import { PendingChange } from './daily-quotes/PendingChange';
import { YieldTeaser } from './daily-quotes/YieldTeaser';
import { inputValue } from '@quirenote/core/money';
import { useFormat } from '../hooks/useFormat';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useT } from '../i18n/useT';

/** One frozen instance, so "no assets yet" keeps a STABLE identity: a fresh
 *  `[]` per render changes the verdict memo's dependency every time. */
const NO_ASSETS: Asset[] = [];
// Load-bearing rather than tidy: `?? []` mints a new array on every render, so
// the `unitsByAsset` memo would recompute forever and hand `useQuoteFetch` a new
// object each time.
const NO_TRANSACTIONS: Transaction[] = [];

/**
 * Publishes the action bar's RENDERED height as `--action-bar-h` while the bar
 * is up, and removes the property when it goes. Returns the ref to hang on it.
 *
 * sonner is mounted above the router and takes one static `mobileOffset`
 * string, so it cannot be told about a bar that comes and goes on one route; a
 * custom property is the only channel between them, and the arithmetic happens
 * in `main.tsx`'s `max()`.
 *
 * MEASURED, NOT MIRRORED: the spacer below already writes that sum out, and a
 * third copy is a third thing to forget. `ResizeObserver` rather than a one-shot
 * measure, because the safe-area inset changes on rotation.
 */
function useActionBarHeight(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!active || !el) return;
    const write = () => root.style.setProperty('--action-bar-h', `${el.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      // Removed, not zeroed: the toast's `max()` falls back on its own, and a stale
      // `--action-bar-h` would push every toast up by the height of a bar that is gone.
      root.style.removeProperty('--action-bar-h');
    };
  }, [active]);
  return ref;
}

export function DailyQuotes() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? NO_ASSETS;
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? NO_TRANSACTIONS;
  const { date, quotes, setDate, setQuote, fillQuote } = useDraft();
  const saveSnapshot = useSaveSnapshot();
  // ONE READING OF THE CLOCK PER RENDER, PASSED AS A DEPENDENCY. A clock read
  // inside a memo is a value its deps cannot see, so a session left open across
  // midnight keeps the previous day's answer — which here means withholding a
  // coupon that has since come due. A date string compares by value.
  const today = todayIso();
  const selectedDate = date || today;
  // The units the ledger says are held ON THE DRAFTED DATE, not today's: a quote
  // drafted for a past day must value the position that existed then, or a
  // purchase landing restates history. `matchAssets` falls back to the asset's
  // stored total for any asset this does not answer for, and `incomplete` is what
  // makes a half-counted ledger visible instead of silently taking that total.
  const ledger = useMemo(
    () => ledgerUnits(transactions, selectedDate),
    [transactions, selectedDate],
  );
  // The fetch ritual only ever writes the draft store — "Save snapshot" stays the sole write path.
  const fetch = useQuoteFetch(assets, ledger.units, ledger.incomplete);
  // Pure local derivations, so they run in demo as well as live.
  const { autoQuoteSuggest, couponSuggest, dismissedReminders, dismissReminder, language } =
    useSettings();
  // Ghosts dismissed this session, stamped with the date dismissed: a dismissal is
  // a "not today", so another date's draft suggests again. Keying the state by date
  // beats resetting it from an effect.
  const [dismissed, setDismissed] = useState<{ date: string; ids: string[] }>({
    date: '',
    ids: [],
  });

  useEffect(() => {
    if (!date) setDate(todayIso());
  }, [date, setDate]);

  const dismissedSuggestions = dismissed.date === selectedDate ? dismissed.ids : [];
  const todaySnapshot = snapshots.find((s) => s.date === selectedDate);

  // Prefill any asset the user has not touched this session, from today's saved snapshot merged with the draft.
  useEffect(() => {
    if (!todaySnapshot) return;
    for (const assetId of Object.keys(todaySnapshot.quotes)) {
      if (!(assetId in quotes)) setQuote(assetId, inputValue(todaySnapshot.quotes[assetId], 2));
    }
  }, [todaySnapshot, quotes, setQuote]);

  const collected = collectQuotes(quotes, assets, language);
  const filledCount = Object.keys(collected.quotes).length;

  function handleSave() {
    // Refuse before writing: a row that cannot be read must not vanish from the day
    // silently, and the date-keyed `put` would replace the stored day.
    if (collected.unreadable.length > 0) {
      const names = collected.unreadable
        .map((id) => assets.find((a) => a.id === id)?.name ?? id)
        .join(', ');
      toast.error(t.dailyQuotes.unreadableToast(names));
      return;
    }
    if (filledCount === 0) {
      toast.error(t.dailyQuotes.nothingToSave);
      return;
    }
    const snapshot: Snapshot = { date: selectedDate, quotes: collected.quotes };
    saveSnapshot.mutate(snapshot, {
      onSuccess: () => toast.success(t.dailyQuotes.snapshotSavedToast),
    });
  }

  function handleCopyYesterday() {
    for (const a of assets) {
      const y = yesterdayQuote(snapshots, a.id, selectedDate);
      if (y !== undefined) setQuote(a.id, inputValue(y, 2));
    }
  }

  // Computed once per feed rather than per render: each check runs a discounted
  // cash-flow pass (many more when it bisects), and this component re-renders on
  // every keystroke in every quote input.
  const feedDate =
    fetch.feedFetchedAt === undefined ? undefined : kyivDateIso(new Date(fetch.feedFetchedAt));
  const verdicts = useMemo(() => {
    const out: Record<string, QuoteVerdict | undefined> = {};
    for (const a of assets) out[a.id] = bondQuoteCheck(a, fetch.feed, feedDate);
    return out;
  }, [assets, fetch.feed, feedDate]);

  // A STICKY ACTION BAR, not scroll-into-view, and the choice is forced by where
  // the controls sit: both are BELOW all four quote rows, so no amount of
  // scrolling the focused row brings them out from under the keyboard. It carries
  // the same two controls, so they are rendered here or in flow, never both.
  const desktop = useIsDesktop();
  const stickyActions = !desktop && filledCount > 0;
  const actionBarRef = useActionBarHeight(stickyActions);

  const lastSavedAt = maxSavedAt(snapshots);
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);

  // A suggestion, never a draft. Accepting it is the only path into the draft
  // store, and it lands as a MACHINE fill, so a later fetch may still replace it.
  function suggestionFor(assetId: string): number | undefined {
    if (!autoQuoteSuggest || dismissedSuggestions.includes(assetId)) return undefined;
    const asset = assets.find((a) => a.id === assetId);
    if (asset === undefined) return undefined;
    const value = accrualSuggestion(
      asset,
      snapshots,
      invested[assetId] ?? 0,
      selectedDate,
      fetch.feed,
      // Units as of the DRAFTED date, which is the count the accrual must scale by.
      ledger.units[assetId],
      // …and the SIZE of a coupon that landed earlier in the gap is a different
      // question: the holding on ITS date, not on the drafted one.
      //
      // A WALK PER COUPON DATE THE GAP ACTUALLY COUNTS, and that number is almost
      // always ZERO — a row quoted yesterday has none.
      //
      // NOT MEMOIZED, and a cache cannot be: `suggestionFor` runs in the render body,
      // so a Map filled from inside it mutates after render, which the React Compiler
      // rejects. If a portfolio ever makes the walk bite, the fix is to lift
      // `suggestionFor` into a memo keyed on the ledger, not to cache underneath it.
      (couponDate) => unitsByAsset(transactions, dayBefore(couponDate))[assetId],
    );
    return value === null ? undefined : value;
  }

  // The skipped occurrences go INTO the derivation rather than filtering its
  // result: a skipped coupon must step aside for the next one on the grid, not
  // silence the asset.
  const due = useMemo(
    () =>
      couponSuggest
        ? dueCoupons(assets, transactions, today, { dismissed: dismissedReminders })
        : [],
    [couponSuggest, assets, transactions, today, dismissedReminders],
  );

  // One entry per DUE DATE, not per card: several coupons can fall on one day.
  // THE DAY BEFORE, NOT THE COUPON'S OWN DAY, because the two consumers of a
  // units count want different bounds. Valuing a position wants the END of the
  // date asked about; a coupon is paid on the holding the day OPENED with — a
  // bond's final coupon falls on its maturity date, the same date as the
  // redemption that closes it, so an inclusive bound summed the payout and the
  // disposal together and got zero. It cuts the other way too, and correctly:
  // units bought ON the payment date do not earn that payment.
  const unitsOnCouponDate = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const d of due) out[d.date] ??= unitsByAsset(transactions, dayBefore(d.date));
    return out;
  }, [due, transactions]);

  return (
    <>
      {/* COMPOSED LIKE `/payouts`, which SUPERSEDES the sheet's centred measure on the
          owner's instruction, and his reason outranks a drawing: a screen that reads
          as a different product is a worse outcome than a wide row. What the sheet won
          stays won — the side blocks are permanent, the title block is out of the
          column, the yield teaser is a card — but the MEASURE is `/payouts`'. */}
      <div>
        {/* Above the header row, full composition width; quote-missing is suppressed
            here because the progress pill already says it. */}
        <ReminderStrip place="daily-quotes" />
        {/* IDENTITY AND PROGRESS ONLY. The date is the CONTEXT every figure below is
            relative to — change it and every row's baseline and value change — and it
            read as decoration beside a heading while being the most consequential
            control on the screen. The progress pill stays because it is a fact about
            the title's own subject. */}
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h2 className="text-[26px]">{t.screen.dailyQuotes.title}</h2>
          <span
            key={filledCount}
            className="animate-in rounded-[6px] bg-info-tint px-3 py-1 text-xs font-semibold text-info-tint-text duration-150 zoom-in-95"
          >
            {t.dailyQuotes.filled(filledCount, assets.length)}
          </span>
        </div>
        <p className="mb-[18px] text-[13px] text-muted">{t.screen.dailyQuotes.subtitle}</p>

        {/* `/payouts`' OWN EXPRESSION, character for character. "Like the other pages"
            IS the requirement here, so a second idiom that merely looked similar would
            be the defect rather than the fix. `min-w-0` on both children is the one
            thing added: an `fr` track floors at its content, and these rows carry an
            input with a width of its own. */}
        <div className="grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
          <div className="min-w-0">
            {/* THE DAY'S INPUTS WEAR NOTHING, and that is the screen's own rule rather than
                a preference: records are cards, controls are bare. Two dressings were
                refused on the owner's call — a `Card`, which was byte-for-byte the quote
                row's own surface and so read as a row someone had emptied, and the app's
                panel, which read as one surface too many on a screen with cards on both
                sides.
                NO HORIZONTAL PADDING is what makes it look deliberate: the controls line up
                with the row cards' own edges instead of sitting inside a box. */}
            <div className="mb-3.5">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <FetchQuotesButton
                    state={fetch.state}
                    freshness={fetch.freshness}
                    flashAt={fetch.flashAt}
                    onFetch={fetch.fetchQuotes}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="daily-quotes-date" className="text-[13px] whitespace-nowrap">
                    {t.dailyQuotes.dateLabel}
                  </label>
                  <DatePicker id="daily-quotes-date" value={selectedDate} onChange={setDate} />
                </div>
              </div>
              <ParseSkips className="mt-2" />
            </div>

            <div className="flex flex-col gap-2.5">
              {assets.map((a) => (
                <QuoteRow
                  key={a.id}
                  asset={a}
                  raw={quotes[a.id]}
                  yesterday={yesterdayQuote(snapshots, a.id, selectedDate)}
                  chip={fetch.chipFor(a)}
                  offer={fetch.offerFor(a)}
                  verdict={verdicts[a.id]}
                  suggestion={suggestionFor(a.id)}
                  onChange={(v) => setQuote(a.id, v)}
                  onAcceptOffer={() => fetch.acceptOffer(a.id)}
                  onDismissOffer={() => fetch.dismissOffer(a.id)}
                  onAcceptSuggestion={() => {
                    const value = suggestionFor(a.id);
                    if (value === undefined) return;
                    fillQuote(a.id, inputValue(value, 2), {
                      source: 'accrual',
                      at: new Date().toISOString(),
                    });
                  }}
                  onDismissSuggestion={() =>
                    setDismissed({
                      date: selectedDate,
                      ids: dismissedSuggestions.includes(a.id)
                        ? dismissedSuggestions
                        : [...dismissedSuggestions, a.id],
                    })
                  }
                />
              ))}
            </div>

            <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
              {!stickyActions && (
                <>
                  <Button onClick={handleSave}>{t.dailyQuotes.saveSnapshot}</Button>
                  <Button variant="outline" onClick={handleCopyYesterday}>
                    {t.dailyQuotes.copyYesterday}
                  </Button>
                </>
              )}
              {/* ONE COLUMN ONLY. Where the side blocks sit beside the rows this line lives
                  at their foot; where the grid has collapsed it comes back here, because this
                  row must never be left holding only its top margin — and below `md` the
                  sticky bar has taken its two buttons. CSS cannot move a node between two
                  parents, so it is rendered in both places and each copy hidden where it does
                  not belong; `hidden` is display:none, so no reader meets it twice. */}
              <span className="ml-auto text-xs text-muted lg:hidden">
                {lastSavedAt
                  ? t.dailyQuotes.lastSaved(f.savedAt(lastSavedAt))
                  : t.dailyQuotes.notSavedYet}
              </span>
            </div>
          </div>

          {/* WHAT THE DAY AMOUNTS TO — outcome, then analytics, then the last write.
              Nothing here is a control, which is why the date and the fetch left: this
              column answers "so what", and it stays BELOW the rows when the grid
              collapses, because an outcome read before the work is noise. The coupon card
              is INSERTED above the rest, never swapped in, so the order never changes.
              These blocks are also what deleted the width cap: the aside used to be
              conditional, so the rows needed one to stop them reflowing on a coupon
              day. */}
          <aside className="flex min-w-0 flex-col gap-3.5">
            {due.map((d) => {
              const asset = assets.find((a) => a.id === d.assetId)!;
              return (
                <CouponDueCard
                  key={couponReminderId(d.assetId, d.date)}
                  asset={asset}
                  due={d}
                  // As of the COUPON's date, not the drafted quote's: the two differ whenever a
                  // due coupon is confirmed from a day other than its own, and it is the holding
                  // on the payment date that determines what was paid. MEMOISED per date, because
                  // this sits in a render-time map on a screen that re-renders on every keystroke.
                  prefill={couponPrefill(asset, d, fetch.feed, unitsOnCouponDate[d.date])}
                  schedule={feedSchedule(asset, fetch.feed)}
                  onSkip={() => dismissReminder(couponReminderId(d.assetId, d.date))}
                />
              );
            })}
            <PendingChange
              assets={assets}
              drafts={quotes}
              snapshots={snapshots}
              selectedDate={selectedDate}
            />
            <YieldTeaser assets={assets} values={values} invested={invested} />
            {/* The side column's copy of the same line — see the action row. `px-1` lines it
                up with the card text above it rather than with the card's edge. */}
            <span className="hidden px-1 text-xs text-muted lg:block">
              {lastSavedAt
                ? t.dailyQuotes.lastSaved(f.savedAt(lastSavedAt))
                : t.dailyQuotes.notSavedYet}
            </span>
          </aside>
        </div>
      </div>

      {stickyActions && (
        <>
          {/* The page has to give up the bar's height, or the last card sits under it at
              the bottom of the scroll range — the exact obstruction the scroll surface
              exists to prevent. MIRRORS THE BAR'S OWN EXPRESSION rather than a literal: a
              flat number was right at a zero inset and short on a home-indicator device,
              exactly where the obstruction would come back. */}
          <div aria-hidden className="h-[calc(61px+max(8px,env(safe-area-inset-bottom)))]" />
          {/* PORTALLED TO THE BODY on purpose. `position: fixed` resolves against the
              nearest ancestor with a transform, and Layout's route wrapper carries an
              entry animation — so a bar rendered in place would be pinned to that wrapper
              for the length of it and jump afterwards. */}
          {createPortal(
            <div
              ref={actionBarRef}
              // The bar rides the VISUAL viewport, not the layout one: on iOS the keyboard
              // does not shrink the layout viewport, so `bottom: 0` would put these two
              // buttons underneath it. `bottom` rather than a transform, because a transform
              // would make its own children's `position: fixed` resolve against it.
              //
              // Read from the root's `--keyboard-inset` rather than subscribed to here: this
              // bar owning the subscription re-rendered the whole route on every
              // visual-viewport event to move one fixed box. Three surfaces need the number
              // now, and CSS moves all of them without React hearing about it.
              className="fixed inset-x-0 bottom-[var(--keyboard-inset,0px)] z-30 flex animate-in gap-2 border-t border-hairline bg-page px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] duration-220 slide-in-from-bottom-2"
            >
              {/* SQUARE CORNERS, hairline top edge: a full-bleed bar has no designed short
                  side, so the proportional rule has nothing to read. */}
              <Button className="flex-1" onClick={handleSave}>
                {t.dailyQuotes.saveSnapshot}
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleCopyYesterday}>
                {t.dailyQuotes.copyYesterday}
              </Button>
            </div>,
            document.body,
          )}
        </>
      )}
    </>
  );
}
