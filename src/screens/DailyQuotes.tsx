import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import { ParseSkips } from '../components/ui/ParseSkips';
import { ReminderStrip } from '../components/ui/ReminderStrip';
import { useAssets, useSaveSnapshot, useSnapshots, useTransactions } from '../hooks/queries';
import { couponReminderId, dueCoupons } from '../core/accrual';
import { dayBefore, kyivDateIso, todayIso } from '../core/dates';
import {
  investedByAsset,
  latestCash,
  latestQuotes,
  ledgerUnits,
  unitsByAsset,
} from '../core/derive';
import type { QuoteVerdict } from '../core/inzhur/dcf';
import type { Asset, Snapshot, Transaction } from '../core/types';
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
import { useFormat } from '../hooks/useFormat';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useT } from '../i18n/useT';

/** One frozen instance, so "no assets yet" keeps a STABLE identity. A fresh
 *  `[]` per render would change the verdict memo's dependency every time and
 *  make the memo do nothing at all. */
const NO_ASSETS: Asset[] = [];
// Same idiom, and now load-bearing rather than tidy: `?? []` mints a new array
// on every render, so the `unitsByAsset` memo below it would recompute forever
// and hand `useQuoteFetch` a new object each time. Lint said so.
const NO_TRANSACTIONS: Transaction[] = [];

/**
 * Publishes the action bar's RENDERED height as `--action-bar-h` while the bar
 * is up, and removes the property when it goes. Returns the ref to hang on it.
 *
 * WHAT IT IS FOR — FOLLOW-UPS 16(b): a toast fired by `Save snapshot` was drawn
 * over the bar that fired it, so `Copy yesterday` could not be pressed for the
 * four seconds the toast lived. sonner is mounted above the router and takes one
 * static `mobileOffset` string, so it cannot be told about a bar that comes and
 * goes on one route; a custom property is the only channel between them, and the
 * arithmetic then happens in `main.tsx`'s `max()` rather than here.
 *
 * MEASURED, NOT MIRRORED. The height is knowable — 1 border + `pt-2` + a 44px
 * button + `pb-[max(8px,env(...))]` — and the spacer below already writes that
 * sum out, with a comment explaining why it must track the bar. A third copy is
 * a third thing to forget, so this reads the box instead. `ResizeObserver`
 * rather than a one-shot measure: the safe-area inset changes on rotation, and
 * the height with it.
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
      // Removed, not zeroed: the toast's `max()` falls back to 0px on its own,
      // and a stale `--action-bar-h` left on the root would push every toast in
      // the app up by the height of a bar that is no longer on screen.
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
  // ONE READING OF THE CLOCK PER RENDER, PASSED AS A DEPENDENCY. `due` asks
  // what is owed TODAY, and a clock read inside a memo is a value its deps
  // cannot see — a session left open across midnight keeps the previous day's
  // answer until something else in the deps changes, which on this screen means
  // withholding a coupon that has since come due. A date string compares by
  // value, so this re-derives on the first render after the day turns and never
  // churns within one.
  const today = todayIso();
  // Hoisted above the fetch hook, which needs it — it used to sit below the
  // default-to-today effect.
  const selectedDate = date || today;
  // ISSUE #31 — the units the ledger says are held ON THE DRAFTED DATE, not
  // today's. A quote drafted for a past day must value the position that existed
  // then; passing today's count would restate history every time a purchase
  // landed. `matchAssets` falls back to the asset's stored total for any asset
  // this does not answer for.
  // ONE walk, both answers — `incomplete` is what makes a half-counted ledger
  // visible instead of silently falling back to the link's stale total.
  const ledger = useMemo(
    () => ledgerUnits(transactions, selectedDate),
    [transactions, selectedDate],
  );
  // S1–S3: the fetch ritual. It only ever writes the draft store — "Save
  // snapshot" below stays the sole write path (G5).
  const fetch = useQuoteFetch(assets, ledger.units, ledger.incomplete);
  // S4/S5 automation switches (S8) — pure local derivations, so they run in
  // demo as well as live (G4/D16).
  const { autoQuoteSuggest, couponSuggest, dismissedReminders, dismissReminder } = useSettings();
  // Ghosts dismissed this session, stamped with the date they were dismissed on
  // (a dismissal is a "not today" — nothing is persisted, and another date's
  // draft suggests again; keying the state by date beats resetting it from an
  // effect).
  const [dismissed, setDismissed] = useState<{ date: string; ids: string[] }>({
    date: '',
    ids: [],
  });

  // First run ever: default the draft to today.
  useEffect(() => {
    if (!date) setDate(todayIso());
  }, [date, setDate]);

  const dismissedSuggestions = dismissed.date === selectedDate ? dismissed.ids : [];
  const todaySnapshot = snapshots.find((s) => s.date === selectedDate);

  // Inputs initialize from today's saved snapshot merged with the draft
  // (README §6.1): prefill any asset the user hasn't touched this session.
  useEffect(() => {
    if (!todaySnapshot) return;
    for (const assetId of Object.keys(todaySnapshot.quotes)) {
      if (!(assetId in quotes)) setQuote(assetId, f.num(todaySnapshot.quotes[assetId]));
    }
  }, [todaySnapshot, quotes, setQuote, f]);

  const collected = collectQuotes(quotes, assets);
  const filledCount = Object.keys(collected.quotes).length;

  function handleSave() {
    // Refuse before writing: a row that cannot be read must not vanish from the
    // day silently, and the date-keyed `put` would replace the stored day (#1).
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
    const cash = todaySnapshot?.cash ?? latestCash(snapshots);
    const snapshot: Snapshot = { date: selectedDate, quotes: collected.quotes, cash };
    saveSnapshot.mutate(snapshot, {
      onSuccess: () => toast.success(t.dailyQuotes.snapshotSavedToast),
    });
  }

  function handleCopyYesterday() {
    for (const a of assets) {
      const y = yesterdayQuote(snapshots, a.id, selectedDate);
      if (y !== undefined) setQuote(a.id, f.num(y));
    }
  }

  // A6 verdicts, computed once per feed rather than per render. Each check runs
  // ~17 discounted-cash-flow passes (and 200 more when it bisects), and this
  // component re-renders on every keystroke in every quote input — so leaving
  // it inline put thousands of Math.pow calls on the typing path for a value
  // that only changes when the payload or its fetch date does.
  const feedDate =
    fetch.feedFetchedAt === undefined ? undefined : kyivDateIso(new Date(fetch.feedFetchedAt));
  const verdicts = useMemo(() => {
    const out: Record<string, QuoteVerdict | undefined> = {};
    for (const a of assets) out[a.id] = bondQuoteCheck(a, fetch.feed, feedDate);
    return out;
  }, [assets, fetch.feed, feedDate]);

  // S4 / DECISION D-a — A STICKY ACTION BAR, not scroll-into-view. The choice
  // is forced by where the controls sit: `Save snapshot` and `Copy yesterday`
  // are BELOW all four quote rows, so no amount of scrolling the focused row
  // brings them out from under the keyboard. The user would have to dismiss it,
  // losing the caret, to reach the button that ends the ritual.
  //
  // It carries the same two controls, not new ones — so they are rendered here
  // or in flow, never both.
  const desktop = useIsDesktop();
  const stickyActions = !desktop && filledCount > 0;
  const actionBarRef = useActionBarHeight(stickyActions);

  const lastSavedAt = maxSavedAt(snapshots);
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);

  // S4 — the accrual ghost per row: a suggestion, never a draft. Accepting it
  // is the only path into the draft store (and it lands as a MACHINE fill, so a
  // later fetch of a linked bond may still replace it with a real price).
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
      // `ledger.units` is what this map is called on `dev` — units as of the
      // DRAFTED date (D112), which is the count the accrual must scale by.
      ledger.units[assetId],
      // …and the SIZE of a coupon that landed earlier in the gap is a different
      // question: the holding on ITS date, not on the drafted one.
      //
      // A WALK PER COUPON DATE THE GAP ACTUALLY COUNTS, and that number is
      // almost always ZERO: `couponsInGap` asks once for the drafted date (the
      // pairing guard) and then only for coupons that fall between the last
      // quote and today. A row quoted yesterday has none.
      //
      // NOT MEMOIZED, and a cache was tried and dropped: `suggestionFor` runs in
      // the render body, so a Map filled from inside it mutates after render —
      // which the React Compiler rejects outright, and rightly. The alternative
      // that would work is precomputing the dates, and they are not knowable
      // before the walk that produces them. The honest bound is the one above;
      // if a portfolio ever makes it bite, the fix is to lift `suggestionFor`
      // into a memo keyed on the ledger, not to cache underneath it.
      (couponDate) => unitsByAsset(transactions, dayBefore(couponDate))[assetId],
    );
    return value === null ? undefined : value;
  }

  // S5 — coupons whose date has arrived with nothing recorded for them. The
  // skipped occurrences (derived ids, shared with the reminders) go INTO the
  // derivation rather than filtering its result: a skipped coupon must step
  // aside for the next one on the grid, not silence the asset (D23).
  const due = useMemo(
    () =>
      couponSuggest
        ? dueCoupons(assets, transactions, today, { dismissed: dismissedReminders })
        : [],
    [couponSuggest, assets, transactions, today, dismissedReminders],
  );

  // One entry per DUE DATE, not per card: several coupons can fall on one day,
  // and the walk is the whole ledger each time.
  // THE DAY BEFORE, NOT THE COUPON'S OWN DAY, and the two consumers of a units
  // count genuinely want different bounds. Valuing a position wants the END of
  // the date asked about — sell everything on the 25th and the 25th is worth
  // nothing. A coupon is paid on the holding the day OPENED with: a bond's
  // final coupon falls on its maturity date, the same date as the redemption
  // that closes it (`nextPaymentOnOrAfter` documents that tie), so an inclusive
  // bound summed the payout and the disposal together, got zero, and left the
  // one coupon whose amount the feed knows exactly with an empty field.
  //
  // It cuts the other way too, and correctly: units bought ON the payment date
  // do not earn that payment.
  const unitsOnCouponDate = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const d of due) out[d.date] ??= unitsByAsset(transactions, dayBefore(d.date));
    return out;
  }, [due, transactions]);

  return (
    <>
      {/* COMPOSED LIKE `/payouts`, and that SUPERSEDES the sheet's centred 944
          (S1-B) on the owner's instruction of 2026-08-25. His reason is the one
          that outranks a drawing: the composition was unlike every other page in
          the app, and a screen that reads as a different product is a worse
          outcome than a wide row. What the sheet won stays won — the side blocks
          are permanent, the title block is out of the column, the yield teaser
          is a card — but the MEASURE is `/payouts`': main's own width, no
          centring, no cap. */}
      <div>
        {/* S6 — above the header row, full composition width; quote-missing is
            suppressed here (the progress pill already says it). The component
            itself is untouched, so `/overview` renders identically. */}
        <ReminderStrip place="daily-quotes" />
        {/* IDENTITY AND PROGRESS ONLY. The header used to carry four kinds of
            thing on one line — the title, the draft's progress, a bulk ACTION
            and the date, which is the CONTEXT every figure below is relative to.
            The date read as decoration beside a heading while being the most
            consequential control on the screen: change it and every row's
            baseline and value change. The owner moved it out on 2026-08-25 and
            asked for the rest to follow; the progress pill stays because it is a
            fact about the title's own subject, and because it is what tells you
            you are not finished while you work down the rows. */}
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

        {/* `/payouts`' OWN EXPRESSION, character for character — `1.6fr 1fr`,
            `items-start`, `gap-3.5`, one column below `lg`. "Like the other
            pages" IS the requirement here, so a second idiom that merely looked
            similar would be the defect rather than the fix. The wide track holds
            the rows, the narrow one the side blocks.
            `min-w-0` on both children is the one thing added: `/payouts` does
            not need it because a chart shrinks, and a quote row does — an `fr`
            track floors at its content, and these rows carry an input with a
            width of its own. */}
        <div className="grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
          <div className="min-w-0">
            {/* THE DAY'S INPUTS WEAR NOTHING, and that is the screen's own rule
                rather than a preference: records are cards, controls are bare.
                The two below — Save snapshot and Copy yesterday — have never had
                a surface, and these are the same kind of thing.
                Two dressings were tried and removed on the owner's call: a
                `Card`, which was byte-for-byte the quote row's own surface and so
                read as a row someone had emptied, and then the app's panel
                (`bg-panel` + border, radius 24), which read as finished but as
                one surface too many on a screen that already has cards on both
                sides.
                NO HORIZONTAL PADDING is the part that makes it look deliberate:
                the fetch button's left edge lines up with the row cards' left
                edge and the date's right edge with theirs, so the controls sit on
                the column's own margins instead of inside a box's.
                `mb-3.5` — more air than the 10 between two rows, because this is
                not a row; less than the 18 above the action row, which separates
                a commit from the data it commits. */}
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
                    fillQuote(a.id, f.num(value), {
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
              {/* ONE COLUMN ONLY. Where the side blocks sit beside the rows this
                line lives at their foot; where the grid has collapsed it comes
                back here, because this row must never be left holding only its
                `mt-[18px]` (brief F-4) — and below `md` the sticky bar has taken
                its two buttons. CSS cannot move a node between two parents, so
                it is rendered in both places and each copy is hidden where it
                does not belong; `hidden` is display:none, so no reader meets it
                twice. The breakpoint is `lg`, the grid's own. */}
              <span className="ml-auto text-xs text-muted lg:hidden">
                {lastSavedAt
                  ? t.dailyQuotes.lastSaved(f.savedAt(lastSavedAt))
                  : t.dailyQuotes.notSavedYet}
              </span>
            </div>
          </div>

          {/* WHAT THE DAY AMOUNTS TO — outcome, then analytics, then the last
              write. Nothing here is a control, which is the whole reason the date
              and the fetch left: this column answers "so what", and it stays
              BELOW the rows when the grid collapses, because an outcome read
              before the work is noise. The coupon card is INSERTED above the
              rest, never swapped in: the order never changes.
              These blocks are also what deleted `max-w-[884px]`: the aside used
              to be conditional, so the rows needed a cap to stop them jumping
              884 → 740 on a coupon day — a 144 px reflow keyed to the calendar
              (brief F-1, sheet S1-C). */}
          <aside className="flex min-w-0 flex-col gap-3.5">
            {due.map((d) => {
              const asset = assets.find((a) => a.id === d.assetId)!;
              return (
                <CouponDueCard
                  key={couponReminderId(d.assetId, d.date)}
                  asset={asset}
                  due={d}
                  // As of the COUPON's date, not the drafted quote's: the two
                  // differ whenever a due coupon is confirmed from a day other
                  // than its own, and it is the holding on the payment date
                  // that determines what was paid. MEMOISED per date, because
                  // this sits in a render-time map on a screen that re-renders
                  // on every keystroke in every quote input.
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
            {/* The side column's copy of the same line — see the action row.
              `px-1` is the drawing's 4 px, so it lines up with the card text
              above it rather than with the card's edge. */}
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
          {/* The page has to give up the bar's height, or the last card sits
              under it at the bottom of the scroll range — the exact obstruction
              the whole scroll surface exists to prevent (D65).
              MIRRORS THE BAR'S OWN EXPRESSION rather than a literal: the bar is
              1 border + `pt-2` + a 44px button + `pb-[max(8px, env(...))]`, so a
              flat 76 was right at a 0 inset and 11px short on a home-indicator
              device — exactly where the obstruction it prevents would come back.
              The extra 8 is breathing room, not slack in the arithmetic. */}
          <div aria-hidden className="h-[calc(61px+max(8px,env(safe-area-inset-bottom)))]" />
          {/* PORTALLED TO THE BODY on purpose. `position: fixed` resolves against
              the nearest ancestor with a transform, and the route wrapper in
              Layout carries `slide-in-from-bottom-2` for 300 ms on every
              navigation — so a bar rendered in place would be pinned to that
              wrapper for the length of the entry animation and jump afterwards.
              The portal takes it out of reach of any transform. */}
          {createPortal(
            <div
              ref={actionBarRef}
              // The bar rides the VISUAL viewport, not the layout one: on iOS
              // the keyboard does not shrink the layout viewport, so `bottom: 0`
              // would put these two buttons underneath it (B4). `bottom` rather
              // than a transform, because a transform would make its own
              // children's `position: fixed` resolve against it.
              //
              // Read from the root's `--keyboard-inset` (app/keyboard-inset.ts)
              // rather than subscribed to here: this bar was the value's first
              // consumer and used to own the subscription, which meant the whole
              // route re-rendered on every visual-viewport event just to move one
              // fixed box. Two more surfaces need the same number now, and CSS
              // moves all three without React hearing about it.
              className="fixed inset-x-0 bottom-[var(--keyboard-inset,0px)] z-30 flex animate-in gap-2 border-t border-hairline bg-page px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] duration-220 slide-in-from-bottom-2"
            >
              {/* SQUARE CORNERS, hairline top edge — the same reading as the
                  header bar (S2): a full-bleed bar has no designed short side,
                  so the proportional rule has nothing to read. */}
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
