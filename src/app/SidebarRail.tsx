import { ArrowDownUp, CalendarDays, type LucideIcon, Settings } from 'lucide-react';
import { NavLink } from 'react-router';

import { ANALYTICS, Mark } from './Sidebar';
import { NAV_TRIGGER_ID } from './nav-ids';
import { Scroller } from '../components/ui/Scroller';
import { Tooltip, TooltipProvider } from '../components/ui/Tooltip';
import { TAP_RAIL } from '../components/ui/tap-target';
import { useSettings } from '../state/settings';
import { useT } from '../i18n/useT';

/**
 * THE THIRD GEOMETRY, and *Two shells, one breakpoint* rejected one — for the
 * mobile job. This rail's job is desktop density: navigation one press away
 * while 188 px go back to the content, which is a job the drawer never had.
 *
 * ITS OWN MODULE, not a third `variant` on `SidebarPanel`. The drawer really is
 * that panel in a different box; this is a different shell width, a different
 * head, a different item, a different glyph size, and no labels, groups,
 * captions, chevrons, capital, version or badge. A `rail &&` on every line is
 * the third geometry arriving as a boolean instead of as a file — and it would
 * put a second footer band, a second rule and a second glyph tag inside
 * `Sidebar.tsx`, where three guards count each of them.
 *
 * It imports the route table rather than restating it, and `Sidebar.tsx` does
 * NOT import this file back — the shell takes it as `children`, which is what
 * keeps the two out of an import cycle.
 */

/** The two the panel writes inline above its groups; Settings is in the foot,
 *  and the other eight come from `ANALYTICS`. */
const ENTRY = [
  { to: '/', key: 'dailyQuotes', Icon: CalendarDays },
  { to: '/transactions', key: 'transactions', Icon: ArrowDownUp },
] as const;

/**
 * One item, and the drawn box is 40 × 36 at radius 9.
 *
 * `h-[36px]` AND NOT `h-9`, which renders identically: `field-border.test.ts`
 * calls any line carrying both `rounded-[9px]` and `h-9` a field, conscripts the
 * file into that suite, and then asserts an exact edge-minus-hover count across
 * it — a failure that reports itself as being about `QuoteRow`.
 *
 * THE RADIUS IS SPENT TWICE, on the link and on the box inside it. The link is
 * the focusable element, so it is the link the focus outline follows; without
 * the radius there the ring is a square around a rounded item.
 *
 * The label is the accessible NAME and also the tooltip's text. Radix names
 * nothing — it describes — so without the `aria-label` an item announces as a
 * bare "link".
 *
 * The state comes from `NavLink`'s own `isActive`, not from a second
 * `matchPath` beside it: the router already computes that predicate for the
 * `aria-current` it emits, and a hand-written copy agrees only until a nested
 * route or a router upgrade moves one of them.
 *
 * IT ARRIVES THROUGH THE CHILDREN FUNCTION AND NEVER THROUGH `className`.
 * `Tooltip` wraps this in a Radix `Trigger asChild`, whose `Slot` merges props
 * onto the child by JOINING className strings — handed a function it stringifies
 * it, and the attribute becomes the source text of the callback, silently, with
 * the markup still reading correctly. A plain string on the link and the state
 * on an inner box is what survives the merge.
 */
function RailItem({ to, label, Icon }: { to: string; label: string; Icon: LucideIcon }) {
  return (
    <Tooltip label={label}>
      <NavLink to={to} aria-label={label} className="block rounded-[9px]">
        {({ isActive }) => (
          <span
            className={`mx-auto grid h-[36px] w-10 place-items-center rounded-[9px] transition ${
              isActive
                ? 'bg-sb-item-active-bg shadow-[inset_2px_0_0_var(--color-sb-indicator)]'
                : 'hover:bg-sb-item-hover-bg'
            }`}
          >
            <Icon
              size={18}
              strokeWidth={2}
              aria-hidden
              className={`flex-none transition-colors ${isActive ? 'text-sb-icon-active' : 'text-sb-icon'}`}
            />
          </span>
        )}
      </NavLink>
    </Tooltip>
  );
}

export function SidebarRail({ onExpand }: { onExpand: () => void }) {
  const t = useT();
  const currency = useSettings((s) => s.currency);

  return (
    <TooltipProvider>
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] px-2 py-4">
        {/* THE BURGER IS THE RAIL'S, and the header at this width has none: a
            control that expands the rail belongs to the rail. `NAV_TRIGGER_ID`
            moves here so the focus handoff still finds it by id; the two never
            share a screen, so the id stays unique.
            NO `aria-expanded` / `aria-controls`, unlike the header's copy: this
            control is INSIDE `#app-sidebar` and the region is on screen around
            it, so announcing it collapsed would be false and pointing
            `aria-controls` at an ancestor is not a relationship to act on. The
            rail is a state of the shell, not a disclosure.
            14 × 12, not the header's 18 × 12: three solid bars at 18 read as
            the heaviest thing in a rail of outline glyphs.
            `TAP_RAIL` and not a real box: the head is a term in the height
            budget, so growing the drawn 12 into a 36px control would spend the
            rail's clearance. The overlay moves nothing. */}
        <div className="mb-[14px] flex flex-col items-center gap-3">
          <Mark className="size-[22px] flex-none" />
          <button
            type="button"
            id={NAV_TRIGGER_ID}
            onClick={onExpand}
            aria-label={t.nav.expandNav}
            className={`cursor-pointer text-sb-item transition hover:text-sb-item-hover active:scale-[.97] ${TAP_RAIL}`}
          >
            <span aria-hidden className="flex h-3 w-[14px] flex-col justify-between">
              <span className="h-[2px] rounded-[1px] bg-current" />
              <span className="h-[2px] rounded-[1px] bg-current" />
              <span className="h-[2px] rounded-[1px] bg-current" />
            </span>
          </button>
        </div>

        {/* `overlay` BECAUSE 40 CANNOT SPARE 28. Every other Scroller reserves
            the bar's strip so no row is read through it; a rail item's ink is
            one centred 18px glyph, the floating bar clears it, and reserving
            here would leave 12px for a 40px item. The prop carries the whole of
            it, the ring allowance included — this band adds nothing back.
            `min-w-0` beside `min-h-0` per *Scrolling*: a grid item's automatic
            minimum is its content, so without it the column cannot shrink. */}
        <div className="min-h-0 min-w-0">
          <Scroller overlay>
            <div className="flex flex-col gap-[3px]">
              {ENTRY.map(({ to, key, Icon }) => (
                <RailItem key={to} to={to} label={t.nav[key]} Icon={Icon} />
              ))}
              <div className="mx-auto my-[6px] w-6 border-t border-sb-divider" />
              {ANALYTICS.map(({ to, key, Icon }) => (
                <RailItem key={to} to={to} label={t.nav[key]} Icon={Icon} />
              ))}
            </div>
          </Scroller>
        </div>

        {/* The foot carries what the rail cannot hold in its band, and no more.
            The capital and the version do not follow — the header takes the
            figure, and the version string is wider than the rail's column. No
            theme control either: a lone cycling glyph cannot show the two states
            it is not in, and here it would be the only one on screen. Currency
            survives that test — two states, and the box shows the one you are
            in, which is why it is a box and not a track. */}
        {/* IT BLEEDS TO THE SHELL, NOT TO THE GRID. `-mx-2 -mb-4` cancels only
            this grid's own padding, while the safe-area insets are paid a level
            up on the wall — so in landscape on a notched device the band stopped
            short of the left edge with `sb-bg` showing through, and its 29 no
            longer met the shell's 30. The margins cancel both; the padding puts
            the inset back inside, so the items stay in the column the nav band
            above them uses. */}
        <div className="mt-[14px] -mr-2 mb-[calc(-16px-env(safe-area-inset-bottom))] ml-[calc(-8px-env(safe-area-inset-left))] rounded-br-[29px] border-t border-sb-divider bg-sb-footer-bg pt-2 pr-2 pb-[calc(8px+env(safe-area-inset-bottom))] pl-[calc(8px+env(safe-area-inset-left))]">
          <RailItem to="/settings" label={t.nav.settings} Icon={Settings} />
          {/* `sr-only` and not `aria-label`: a bare div is `role=generic`, which
              ARIA-in-HTML forbids naming, so the label was dropped and the box
              announced as a bare glyph. The same idiom the expanded track uses,
              and for the same reason. */}
          <div className="mx-auto mt-1.5 grid h-8 w-10 place-items-center rounded-[8px] bg-sb-item-active-bg text-[13px] font-semibold text-ink">
            {currency === 'UAH' ? '₴' : '$'}
            <span className="sr-only">{t.nav.currencyShown(currency)}</span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
