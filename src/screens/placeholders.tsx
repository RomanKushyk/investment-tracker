// What each screen holds before its read answers (design/extensions/first-paint.dc.html, brief
// #406). Every box whose size is known keeps its place: the static words stay, every figure reads
// «—», a list is three rows, a chart is one block at its height, a form keeps its title and holds its
// fields. What exists only with the data holds no box (the reminder strip, the coupon-due card, a
// row past the third), and nothing here can be acted on. The geometry is the sheet's, measured on
// the seed at 1280 and at a true 360.
import {
  Block,
  Bar,
  Dash,
  PlaceholderScreen,
  Row,
  Rows,
  Slot,
} from '../components/loading/Placeholder';
import { Card } from '../components/ui/Card';
import { KpiCard } from '../components/ui/KpiCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useFormat } from '../hooks/useFormat';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useToday } from '../hooks/useToday';
import { useT } from '../i18n/useT';

/** The period control's slot: the select and the line that names its window. */
function PeriodSlot() {
  return (
    <Slot className="flex w-[272px] flex-col gap-1">
      <Block className="h-9 rounded-[9px]" />
      <div className="flex h-[16.5px] items-center">
        <Bar w="60%" />
      </div>
    </Slot>
  );
}

/** A button's slot, at the size and radius of the button it holds. */
const buttonSlot = (width: number) => <Block className="h-9 rounded-[10px]" style={{ width }} />;

/** A table's static header, as the real table draws it; `xirr` is a bar since the data picks its words. */
function Header({ labels, right = 1 }: { labels: string[]; right?: number }) {
  return (
    <thead>
      <tr className="text-left text-muted">
        {labels.map((label, i) => (
          <th key={label + i} className={`py-2 font-normal ${i >= right ? 'text-right' : ''}`}>
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** Three held rows under a table's header, each across every column. */
function TableRows({ columns }: { columns: number }) {
  return (
    <tbody>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-t border-hairline">
          <td colSpan={columns} className="px-1 py-0">
            <Row className="h-[35.32px]" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

/** A record card of the narrow shell, held as a card with two lines of text in it. */
function RecordSlot() {
  return (
    <Card radius={24} className="p-[22px]">
      <div className="flex items-center gap-3">
        <Block kind="avatar" className="size-9 rounded-full" />
        <Bar w="40%" />
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Row className="h-4" />
        <Row className="h-4" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function OverviewPlaceholder() {
  const f = useFormat();
  const t = useT();
  const today = useToday();
  const o = t.analytics.overview;
  return (
    <PlaceholderScreen>
      <ScreenHeader
        title={t.screen.overview.title}
        // The rate is the view's, and nothing is known of it before the view answers.
        subtitle={t.screen.overview.subtitle(f.date(today), '—')}
        actions={<PeriodSlot />}
      />
      <div className="mb-[26px] grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3.5">
        <KpiCard
          tone="wall"
          label={o.totalCapital}
          value={<Dash />}
          sub={<Dash className="h-4" />}
        />
        <KpiCard label={o.capitalGain} value={<Dash />} sub={<Dash className="h-4" />} />
        {/* Both sub-lines carry static words that wrap at the width of four across, and not at one. */}
        <KpiCard
          label={o.totalReturnNet}
          value={<Dash />}
          sub={
            <>
              <Dash className="h-8 max-md:h-4" />
              <Dash className="mt-1 h-8 max-md:h-4" />
            </>
          }
        />
        <KpiCard label={o.depositedReinvested} value={<Dash />} sub={<Dash className="h-4" />} />
        <KpiCard label={o.freeCash} value={<Dash />} sub={<Dash className="h-4" />} />
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="p-[22px]">
          <div className="mb-3.5 text-[10px] tracking-[.12em] text-muted uppercase">{o.assets}</div>
          <Rows className="flex flex-col gap-3 px-1" rowClassName="h-[20.25px] max-md:h-[44.5px]" />
          <div className="my-4 h-px bg-hairline" />
          <Bar w="100%" />
        </Card>

        <div className="flex flex-col gap-3.5">
          <div className="rounded-3xl bg-pos-tint px-[22px] py-5">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-pos-tint-text uppercase">
              {o.nextPayouts}
            </div>
            <Rows tone="card" className="flex flex-col gap-2" rowClassName="h-[19.5px]" />
          </div>

          <Card radius={24} className="p-5">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-muted uppercase">
              {o.rebalanceHint}
            </div>
            <div className="flex h-[39px] items-center">
              <Bar w="85%" />
            </div>
            {/* The link is a slot of its own height, the body a block. */}
            <div className="flex h-10 items-center max-md:h-11">
              <Bar w="45%" />
            </div>
          </Card>

          <KpiCard
            label={o.incomeReceived}
            valueSize="md"
            value={<Dash />}
            sub={
              <>
                <Dash className="h-4" />
                <Dash className="h-4" />
              </>
            }
          />
        </div>
      </div>
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

/** A quote row's card: the avatar, two lines for the name, the field and the unit it is in. */
function QuoteSlot() {
  return (
    <Card className="relative h-[76px] max-md:h-[128px]">
      <Block kind="avatar" className="absolute top-3.5 left-5 size-12 rounded-full" />
      <Bar w="144px" className="absolute top-[23.75px] left-[84px] max-md:left-[76px]" />
      <Bar w="96px" className="absolute top-[42px] left-[84px] max-md:left-[76px]" />
      <Block
        kind="field"
        className="absolute top-5 right-[88px] h-9 w-40 rounded-[9px] max-md:top-[70px] max-md:right-auto max-md:left-5 max-md:h-11 max-md:w-[236px] max-md:rounded-[11px]"
      />
      <Bar w="32px" className="absolute top-8 right-5 max-md:top-[86px]" />
    </Card>
  );
}

/** The day's rows while its own read is out. */
export function QuoteRowsPlaceholder() {
  return (
    <div className="flex flex-col gap-2.5">
      <QuoteSlot />
      <QuoteSlot />
      <QuoteSlot />
    </div>
  );
}

export function DailyQuotesPlaceholder() {
  const t = useT();
  return (
    <PlaceholderScreen>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="text-[26px]">{t.screen.dailyQuotes.title}</h2>
        <Slot>
          <Block className="h-6 w-[132px] rounded-[6px]" />
        </Slot>
      </div>
      <p className="mb-[18px] text-[13px] text-muted">{t.screen.dailyQuotes.subtitle}</p>

      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <div className="min-w-0">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <Block className="h-9 w-[256.1px] rounded-[10px]" />
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-[13px] whitespace-nowrap">
                {t.dailyQuotes.dateLabel}
              </span>
              <Block className="h-9 w-[130px] rounded-[9px]" />
            </div>
          </div>
          <QuoteRowsPlaceholder />
          <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
            <Block className="h-10 w-[133.04px] rounded-[10px] max-md:h-11 max-md:rounded-[11px]" />
            <Block className="h-10 w-[184.6px] rounded-[10px] max-md:h-11 max-md:rounded-[11px]" />
            <div className="flex h-4 w-full items-center md:hidden">
              <Bar w="50%" />
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-3.5">
          <Card className="px-5 py-4">
            <div className="text-[13px] font-semibold">{t.dailyQuotes.pendingChange.label}</div>
            <div className="mt-1.5 flex h-[18.75px] items-center">
              <Bar w="55%" />
            </div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-[13px] font-semibold">{t.dailyQuotes.yieldSinceStart}</div>
            <Rows className="mt-2.5 flex flex-col" rowClassName="h-[30px]" />
            <div className="mt-3 flex h-[18.75px] items-center max-md:h-11">
              <Bar w="45%" />
            </div>
          </Card>
          <div className="flex h-4 items-center px-1 max-lg:hidden">
            <Bar w="50%" />
          </div>
        </aside>
      </div>
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

export function TransactionsPlaceholder() {
  const t = useT();
  return (
    <PlaceholderScreen>
      <ScreenHeader title={t.screen.transactions.title} subtitle={t.screen.transactions.subtitle} />
      <div className="grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        {/* The form leads, as it does: it is the side block on the right and first when stacked. */}
        <Card
          radius={24}
          className="min-w-0 border border-panel-border bg-panel px-[22px] py-5 max-lg:max-w-[560px] lg:col-start-2 lg:row-start-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="font-display text-lg font-semibold">{t.transaction.title}</div>
            <span className="text-[10px] tracking-[.08em] text-muted uppercase">
              {t.transaction.badge}
            </span>
          </div>
          <p className="mt-1 mb-3.5 text-xs text-muted">{t.transaction.subtitle}</p>
          <Block
            kind="fields"
            tone="card"
            className="h-[318.5px] rounded-[1px] max-md:h-[322.5px]"
          />
        </Card>
        <Card className="min-w-0 py-4 lg:col-start-1 lg:row-start-1">
          <Rows
            className="flex flex-col px-7 max-md:px-5"
            rowClassName="h-9 border-t border-hairline first:border-t-0 max-md:h-[60px]"
          />
        </Card>
      </div>
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

export function YieldPlaceholder() {
  const t = useT();
  const desktop = useIsDesktop();
  const a = t.analytics;
  return (
    <PlaceholderScreen>
      <ScreenHeader
        title={t.screen.yield.title}
        subtitle={t.screen.yield.subtitle}
        actions={<PeriodSlot />}
      />
      <Card radius={24} className="mb-3.5 p-[22px]">
        <div className="mb-2 flex h-[17.25px] items-center">
          <Bar w="30%" />
        </div>
        <Block kind="chart" className="h-[280px] rounded-[2px]" />
      </Card>
      {desktop ? (
        <Card radius={24} className="px-[22px] py-2.5">
          <table className="w-full min-w-[780px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-muted">
                {[a.asset, a.invested, a.valueNow, a.deltaTotal, a.annualized, a.totalReturn].map(
                  (label, i) => (
                    <th key={label} className={`py-2 font-normal ${i > 0 ? 'text-right' : ''}`}>
                      {label}
                    </th>
                  ),
                )}
                <th className="py-2 text-right font-normal">
                  <Block className="ml-auto h-3 w-[72px] rounded-[3px]" />
                </th>
                <th className="py-2 text-right font-normal">{a.vsExpected}</th>
              </tr>
            </thead>
            <TableRows columns={8} />
          </table>
          <div className="mt-2.5 flex flex-col">
            {['92%', '88%', '40%'].map((w) => (
              <div key={w} className="flex h-[17.25px] items-center">
                <Bar w={w} />
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          <RecordSlot />
          <RecordSlot />
          <RecordSlot />
        </div>
      )}
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

export function BalancesPlaceholder() {
  const t = useT();
  const desktop = useIsDesktop();
  const a = t.analytics;
  return (
    <PlaceholderScreen>
      <ScreenHeader title={t.screen.balances.title} subtitle={t.screen.balances.subtitle} />
      <Card radius={24} className="mb-3.5 p-[22px]">
        <Block kind="chart" className="h-[260px] rounded-[2px]" />
      </Card>
      <BalancesTablePlaceholder desktop={desktop} headers={[a.snapshot, a.cash, a.totalUah]} />
    </PlaceholderScreen>
  );
}

/** The table of snapshots while `/view/balances` is out: three rows and the pager's slot. The
 *  screen shows it itself once the view is in hand and the page is not. */
export function BalancesTablePlaceholder({
  desktop,
  headers,
}: {
  desktop: boolean;
  headers: string[];
}) {
  return desktop ? (
    <Card radius={24} className="px-[22px] py-2.5">
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
        <Header labels={headers} />
        <TableRows columns={headers.length} />
      </table>
      <div className="mt-2.5 flex h-8 items-center justify-between gap-3">
        <Bar w="30%" />
        <Block className="h-8 w-[132px] rounded-[10px]" />
      </div>
    </Card>
  ) : (
    <div className="flex flex-col gap-2.5">
      <RecordSlot />
      <RecordSlot />
      <RecordSlot />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function PayoutsPlaceholder() {
  const t = useT();
  const desktop = useIsDesktop();
  const a = t.analytics;
  return (
    <PlaceholderScreen>
      <ScreenHeader title={t.screen.payouts.title} subtitle={t.screen.payouts.subtitle} />
      <div className="mb-3.5 grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="p-[22px]">
          <div className="mb-2 flex gap-4 text-[11.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px] bg-reit" />
              {a.dividends}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px] bg-ovdp8976" />
              {a.coupons}
            </span>
          </div>
          <Block kind="chart" className="h-[240px] rounded-[2px]" />
        </Card>
        <div className="flex flex-col gap-3.5">
          <KpiCard
            tone="wall"
            label={a.receivedTotal}
            value={<Dash />}
            sub={<Dash className="h-4" />}
          />
          <div className="rounded-3xl bg-pos-tint px-[22px] py-5">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-pos-tint-text uppercase">
              {a.upcoming}
            </div>
            <Rows tone="card" className="flex flex-col gap-2" rowClassName="h-[19.5px]" />
          </div>
          <KpiCard
            label={a.reinvested}
            valueSize="md"
            value={<Dash />}
            sub={<Dash className="h-4" />}
          />
        </div>
      </div>
      {desktop ? (
        <Card radius={24} className="px-[22px] py-2.5">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-muted">
                {[a.date, a.asset, a.type].map((label) => (
                  <th key={label} className="py-2 font-normal">
                    {label}
                  </th>
                ))}
                {[a.amountUah, a.withheldUah, a.netOfTaxUah].map((label) => (
                  <th key={label} className="py-2 text-right font-normal">
                    {label}
                  </th>
                ))}
                <th className="py-2 font-normal">{a.destination}</th>
              </tr>
            </thead>
            <TableRows columns={7} />
          </table>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          <RecordSlot />
          <RecordSlot />
          <RecordSlot />
        </div>
      )}
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

export function AttributesPlaceholder() {
  const t = useT();
  return (
    <PlaceholderScreen>
      <ScreenHeader title={t.screen.attributes.title} subtitle={t.screen.attributes.subtitle} />
      <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
        {[0, 1, 2].map((i) => (
          <Card key={i} radius={24} className="p-[22px]">
            <div className="flex items-center gap-3">
              <Block kind="avatar" className="size-9 rounded-full" />
              <Bar w="40%" />
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <Bar w="70%" />
              <Bar w="55%" />
            </div>
          </Card>
        ))}
      </div>
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

export function SeasonalityPlaceholder() {
  const t = useT();
  const s = t.analytics.seasonality;
  return (
    <PlaceholderScreen>
      <ScreenHeader
        title={t.screen.seasonality.title}
        subtitle={t.screen.seasonality.subtitle}
        actions={<PeriodSlot />}
      />
      <Card radius={24} className="mb-3.5 p-[22px]">
        <Slot className="mb-3 flex justify-end">
          <Block className="h-[38px] w-[132px] rounded-[11px]" />
        </Slot>
        <Block kind="chart" className="h-[230px] rounded-[2px]" />
        <div className="mt-2 text-[11.5px] text-muted">{t.analytics.prose.seasonalityNote}</div>
      </Card>
      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <Conclusion label={s.incomeAnchor} tint />
        <Conclusion label={s.couponSeason} />
        <Conclusion label={s.quietStretch} />
      </div>
    </PlaceholderScreen>
  );
}

/** A finding card: its name, and two lines for what the data will say. */
function Conclusion({ label, tint = false }: { label: string; tint?: boolean }) {
  const body = (
    <>
      <div
        className={`mb-1 text-[10px] tracking-[.12em] uppercase ${tint ? 'text-pos-tint-text' : 'text-muted'}`}
      >
        {label}
      </div>
      <div className="flex flex-col gap-2 py-1">
        <Bar w="90%" tone={tint ? 'card' : 'panel'} />
        <Bar w="60%" tone={tint ? 'card' : 'panel'} />
      </div>
    </>
  );
  return tint ? (
    <div className="rounded-3xl bg-pos-tint px-[22px] py-5">{body}</div>
  ) : (
    <Card radius={24} className="px-[22px] py-5">
      {body}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function PortfolioPlaceholder() {
  const t = useT();
  const desktop = useIsDesktop();
  const a = t.analytics;
  const p = a.portfolio;
  return (
    <PlaceholderScreen>
      <ScreenHeader
        title={t.screen.portfolio.title}
        subtitle={t.screen.portfolio.subtitle}
        actions={buttonSlot(64)}
      />
      {desktop ? (
        <Card radius={24} className="mb-3.5 px-[22px] py-2.5">
          <table className="w-full border-collapse text-[12.5px]">
            <Header
              labels={[
                a.asset,
                a.yieldType,
                a.invested,
                a.ofItReinvested,
                a.valueNow,
                a.capitalGainUah,
                a.capitalGainPct,
                a.share,
              ]}
              right={2}
            />
            <TableRows columns={8} />
          </table>
          <div className="mt-2.5 text-[11.5px] text-muted">{a.prose.capitalGainNote}</div>
        </Card>
      ) : (
        <div className="mb-3.5 flex flex-col gap-2.5">
          <RecordSlot />
          <RecordSlot />
          <RecordSlot />
        </div>
      )}
      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        <KpiCard
          label={p.bestPerformer}
          valueSize="sm"
          value={<Dash />}
          sub={<Dash className="h-4" />}
        />
        <KpiCard label={p.laggard} valueSize="sm" value={<Dash />} sub={<Dash className="h-4" />} />
        <KpiCard
          tone="tint"
          label={p.incomeEngine}
          valueSize="sm"
          value={<Dash />}
          sub={<Dash className="h-4" />}
        />
      </div>
    </PlaceholderScreen>
  );
}

// ---------------------------------------------------------------------------------------------

export function AllocationPlaceholder() {
  const t = useT();
  const al = t.analytics.allocation;
  return (
    <PlaceholderScreen>
      <ScreenHeader
        title={t.screen.allocation.title}
        subtitle={t.screen.allocation.subtitle}
        actions={buttonSlot(64)}
      />
      <div className="grid grid-cols-[340px_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="flex flex-col items-center p-[22px]">
          <Block kind="donut" className="aspect-square w-full max-w-[220px] rounded-full" />
          <Rows className="mt-2.5 flex w-full flex-col gap-1.5" rowClassName="h-4" />
        </Card>
        <div className="flex flex-col gap-3.5">
          <Card radius={24} className="p-[22px]">
            <div className="mb-3.5 text-[10px] tracking-[.12em] text-muted uppercase">
              {al.currentVsTarget}
            </div>
            <Rows className="flex flex-col gap-3.5" rowClassName="h-[34px]" />
          </Card>
          <div className="rounded-3xl border border-panel-border bg-panel px-[22px] py-5">
            <div className="mb-2 text-[10px] tracking-[.12em] text-muted uppercase">
              {al.rebalancePlan}
            </div>
            <Rows tone="card" className="flex flex-col gap-2" rowClassName="h-5" />
          </div>
        </div>
      </div>
    </PlaceholderScreen>
  );
}
