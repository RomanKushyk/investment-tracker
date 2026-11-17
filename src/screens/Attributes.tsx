import { useMemo, type ReactNode } from 'react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Card } from '../components/ui/Card';
import { Fact } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useView } from '../hooks/queries';
import { selectAttributes } from '../hooks/slices';
import type { Asset, ColorKey } from '@quirenote/core/types';
import {
  derivedYtmPct,
  type AttributeCard,
  type BondCard,
  type MarketCard,
  type PayoutScheduleFact,
} from '@quirenote/core/view/attributes';
import { useInzhurAssets } from '../hooks/useInzhurAssets';
import { useFormat } from '../hooks/useFormat';
import type { Dict } from '../i18n/messages';
import { useT } from '../i18n/useT';

function payoutScheduleLabel(fact: PayoutScheduleFact, t: Dict): string {
  const base = t.asset.schedule[fact.schedule];
  return fact.day ? `${base} · ~${t.dates.dayOfMonth(fact.day)}` : base;
}

// The asset's hue as a fill, held per component as the other four colour maps are.
const HUE_BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

const share = (part: number, whole: number) => Math.min(100, Math.max(0, (part / whole) * 100));

export function Attributes() {
  const f = useFormat();
  const t = useT();
  const { cards: served, transactions } = useView(selectAttributes);
  // WHATEVER THE APP ALREADY HAS — `data` when a fetch has run this session,
  // otherwise the last-good cache. This screen deliberately does NOT trigger a
  // fetch: a reference table that quietly hits the provider on open is what the
  // picker's "first open, never on mount" rule exists to prevent.
  const { data, lastGood } = useInzhurAssets();
  const feed = (data ?? lastGood)?.feed;
  // THE FEED IS THIS DEVICE'S, so the view's cards carry no YTM and it is laid over them here
  // (*External sources*). MEMOIZED because it is the expensive one: per bond it rebuilds the feed's
  // ref Map and runs `impliedYield`'s bisection over the whole payment schedule.
  const cards = useMemo(
    () =>
      served.map((card): AttributeCard =>
        card.kind === 'bond'
          ? { ...card, ytm: derivedYtmPct(card.asset, transactions, feed) }
          : card,
      ),
    [served, transactions, feed],
  );

  return (
    <div>
      <ScreenHeader title={t.screen.attributes.title} subtitle={t.screen.attributes.subtitle} />
      <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
        {cards.map((card, i) => {
          const a = card.asset;
          return (
            <Card
              key={a.id}
              radius={24}
              data-asset={a.id}
              className="animate-in p-[22px] duration-300 fade-in"
              style={{ animationDelay: `${(i % 4) * 60}ms` }}
            >
              <div className="flex items-center gap-3">
                <AssetAvatar code={a.code} colorKey={a.colorKey} size={44} />
                <div className="min-w-0 flex-1">
                  <h3 className="m-0 truncate text-h3" title={a.name}>
                    {a.name}
                  </h3>
                  {/* Wraps rather than truncates: «без погашення» is the part a cut would lose. */}
                  <div className="text-small text-muted">
                    {card.kind === 'bond'
                      ? t.analytics.attributes.kindBond(t.asset.yieldLong[a.yieldType])
                      : t.analytics.attributes.kindFund(t.asset.yieldLong[a.yieldType])}
                  </div>
                </div>
              </div>
              {card.kind === 'bond' ? <BondBody card={card} /> : <MarketBody card={card} />}
              {/* F1, in a fixed order; nothing the hero or the bar already shows. */}
              <dl className="m-0 mt-4 grid grid-cols-2 gap-x-4.5 gap-y-2.5">
                {card.kind === 'bond' ? (
                  <Fact label={t.analytics.attributes.coupon}>
                    {/* The coupon this POSITION pays, from the rate and the ledger's units. */}
                    {card.coupon === undefined
                      ? '—'
                      : `${f.moneyWhole(card.coupon)} ${t.asset.couponFrequency[a.payoutSchedule]}`}
                  </Fact>
                ) : (
                  <Fact label={t.analytics.attributes.payoutSchedule}>
                    {payoutScheduleLabel(card.payoutSchedule, t)}
                  </Fact>
                )}
                <Fact label={t.analytics.attributes.targetShare}>
                  {f.pctPlain(a.targetPct, Number.isInteger(a.targetPct) ? 0 : 1)}
                </Fact>
                {card.kind === 'bond' ? (
                  <Fact label={t.analytics.attributes.nextCoupon}>
                    {/* The walk, not `a.nextCoupon`: the transaction form never moves the pointer,
                        so a payout recorded there leaves it settled. No `dismissed`: a Skip pays nothing. */}
                    {card.nextCoupon ? f.date(card.nextCoupon) : '—'}
                  </Fact>
                ) : (
                  <Fact label={t.analytics.attributes.firstPurchase}>
                    {f.date(a.firstPurchase)}
                  </Fact>
                )}
              </dl>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** H1: one figure with «/ рік», then its caption; what follows the caption sits under it. */
function Hero({
  figure,
  caption,
  children,
}: {
  figure: ReactNode;
  caption: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="mt-4">
      <div data-hero className="flex items-baseline gap-2">
        {figure}
        <span className="text-body text-muted">{t.analytics.perYear}</span>
      </div>
      <div data-hero-caption className="text-label text-muted">
        {caption}
      </div>
      {children}
    </div>
  );
}

/**
 * V1: an `ink` 8 % track, the fill in the asset's hue (identity, not gain or loss) and an `ink`
 * tick for the reference. Its values are printed at its ends, so the fill never carries one alone.
 */
function ProgressBar({
  hue,
  fill,
  tick,
  start,
  end,
  caption,
}: {
  hue: ColorKey;
  fill: number;
  tick?: number;
  start: ReactNode;
  end: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <div data-bar className="mt-4">
      <div aria-hidden className="relative h-2 rounded-[2px] bg-ink/8">
        <div
          data-fill
          className={`h-full rounded-[2px] transition-[width] duration-300 ease-soft ${HUE_BG[hue]}`}
          style={{ width: `${fill}%` }}
        />
        {tick !== undefined && (
          <div
            data-tick
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-[1px] bg-ink"
            style={{ left: `${tick}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-label text-muted">
        <span>{start}</span>
        <span>{end}</span>
      </div>
      {caption !== undefined && <div className="text-label text-muted">{caption}</div>}
    </div>
  );
}

function MarketBody({ card }: { card: MarketCard }) {
  const f = useFormat();
  const t = useT();
  const at = t.analytics.attributes;
  const { asset: a, actualAnnualized: actual, shortBasis } = card;
  const expected = f.pctPlain(a.expectedPct);
  // Drawn only with a value and a range: a negative or missing return has neither. The return is
  // served as a fraction and the expected one in percent, so the bar reads both in percent.
  const scale =
    actual === undefined || actual < 0 ? 0 : Math.max(actual * 100, a.expectedPct) * 1.25;
  return (
    <>
      <Hero
        figure={
          actual === undefined ? (
            <span className="font-display text-display-hero">—</span>
          ) : (
            // The mark is `/yield`'s (`shortBasisIn`): one figure greyed there and painted green
            // here would be called trustworthy and untrustworthy at once, one tab apart.
            <span
              className={`font-display text-display-hero ${shortBasis ? 'text-muted' : actual < 0 ? 'text-neg' : 'text-pos'}`}
              title={shortBasis ? t.analytics.prose.shortBasisNote : undefined}
            >
              {f.pct(actual, 1)}
            </span>
          )
        }
        caption={actual === undefined ? at.actualNotYet(expected) : at.actualCaption(expected)}
      />
      {actual !== undefined && scale > 0 && (
        <ProgressBar
          hue={a.colorKey}
          fill={share(actual * 100, scale)}
          tick={share(a.expectedPct, scale)}
          start={at.barActual(f.pct(actual, 1))}
          end={at.barExpected(expected)}
        />
      )}
    </>
  );
}

function BondBody({ card }: { card: BondCard }) {
  const f = useFormat();
  const t = useT();
  const at = t.analytics.attributes;
  const { asset: a, toMaturity } = card;
  // Disclosed as visible text when the printed figures differ: the rest of the app measures
  // against the stored `expectedPct`, and comparing strings keeps it from naming no difference.
  const shown = f.pctPlain(card.ytm ?? a.expectedPct);
  const differs = card.ytm !== undefined && shown !== f.pctPlain(a.expectedPct);
  return (
    <>
      <Hero
        figure={<span className="font-display text-display-hero">{shown}</span>}
        caption={at.ytmAtPurchase}
      >
        {differs && (
          <div className="mt-1 text-label text-muted">
            {t.analytics.prose.ytmDerived(f.pctPlain(a.expectedPct))}
          </div>
        )}
      </Hero>
      <BondBar asset={a} toMaturity={toMaturity} />
    </>
  );
}

/** First purchase → maturity. With no maturity, or no span between the two, one line instead. */
function BondBar({ asset: a, toMaturity }: { asset: Asset; toMaturity: BondCard['toMaturity'] }) {
  const f = useFormat();
  const at = useT().analytics.attributes;
  const line = (text: string) => <div className="mt-4 text-small text-muted">{text}</div>;
  if (a.maturity === undefined || toMaturity === undefined) return line(at.noMaturity);
  const matured = toMaturity.kind === 'matured';
  const caption = matured
    ? at.maturedOn(f.date(a.maturity))
    : at.daysToMaturity(toMaturity.daysLeft);
  const { daysTotal } = toMaturity;
  if (daysTotal <= 0) return line(caption);
  // Today's place from the served days, so the screen reads no clock of its own. Before the
  // first purchase it lies off the bar, and nothing marks it; a matured bar is full, unmarked.
  const elapsed = matured ? undefined : daysTotal - toMaturity.daysLeft;
  return (
    <ProgressBar
      hue={a.colorKey}
      fill={elapsed === undefined ? 100 : share(elapsed, daysTotal)}
      tick={elapsed === undefined || elapsed < 0 ? undefined : share(elapsed, daysTotal)}
      start={f.date(a.firstPurchase)}
      end={f.date(a.maturity)}
      caption={caption}
    />
  );
}
