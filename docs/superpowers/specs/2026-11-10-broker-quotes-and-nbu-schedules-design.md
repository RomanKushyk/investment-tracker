# Broker quotes and NBU schedules

Each bond gets one schedule, from the NBU, and as many quotes as there are brokers that publish
one. The archive stops treating the provider as the source of a bond's terms. It starts capturing
a second broker, so the same bond can be compared across dealers. The first deliverable is the
backend: every capture night a broker's quote is not read is a quote the archive will never hold,
so capture starts before any screen exists. The comparison, the broker on the forms and holdings
per broker follow later, and nothing is lost by waiting for them. The evidence for every claim
below about a source was measured on
[#646](https://github.com/RomanKushyk/investment-tracker/issues/646) and its comments, which this
design absorbs.

## §1 — Why

**A schedule is the issuer's, not the dealer's.** Every broker sells the same bond on the same
terms; only the price differs. Today `bond_terms` holds the schedule *as the provider served it*,
and the capture refuses to settle a day when the provider lists a bond without one. The provider
can list a bond before it publishes the schedule (#646), so one dealer's page fails a night's
capture over a fact the issuer published long ago. Where the provider's schedule and the NBU's
disagree, the 182-day cycle sides with the NBU (#646).

**A yield-only broker needs a schedule to have a price.** PrivatBank publishes BID and ASK yields,
not prices. A price follows only from that yield discounted over the bond's schedule, which is how
Finomo, a comparison site that shows each broker's price for a bond, shows PrivatBank's. Run over
the NBU schedule, `derivePrice` (`packages/core/src/inzhur/dcf.ts`, `ytm` convention, valuation day
= the quote's day) reproduces Finomo's PrivatBank price exactly (#646). So one shared schedule is
what makes brokers comparable at all.

**What the owner wants out of it.** For one bond: each broker's price and yield side by side, the
cheapest marked, the schedule, and a calculator, as Finomo shows it. Later, an asset and a
transaction name their broker, so a figure uses that broker's price. The same bond can then be held
at several brokers, each with its own quantity.

## §2 — Goals, non-goals, anti-goals

**Goals, first deliverable (backend):**
- Every bond's schedule is captured nightly from the NBU depository register and archived. It is
  the only schedule source for every reader: the capture's checks, `/view`, quote verdicts, and
  every future broker.
- PrivatBank's published quotes are captured nightly beside the provider's, attributed to their
  broker. UAH, USD and EUR bonds are all captured.
- A bond the provider lists without a schedule no longer fails the night (#646 resolved).

**Goals, later deliverables, in the owner's order unless re-ordered:**
1. A bond comparison screen: every broker's price and yield, the cheapest marked, the schedule, and
   a calculator.
2. A broker field on the asset and transaction forms, so a figure uses that broker's price.
3. Holdings per broker: one bond at several brokers, each with its own quantity.
4. ICU, once it publishes prices anywhere outside its logged-in app.
5. NovaPay's corporate bonds, as a kind of asset of their own (§7).

**Non-goals:**
- A price for a yield-only broker is never stored. It is calculated when read, from the stored
  yield and the archived schedule (§4).
- No intraday capture. One snapshot per broker per Kyiv day, like the provider's.
- No currency conversion in the archive. A USD or EUR bond's quote is stored in the terms the broker
  published it.
- The app's screens are not touched by the first deliverable.

**Anti-goals, a failure even if it works:**
- A schedule from the provider and one from the NBU mixed in one series with no way to tell them
  apart.
- A dealer quote and the NBU's fair value merged or presented as one basis. That invariant stands
  unchanged (*The price archive*). A schedule is terms, not a basis, so this design does not touch
  it.
- A broker whose robots rules or terms forbid the fetch read anyway. *External sources* holds for
  every new host.
- One broker's broken page failing the night for the others.

## §3 — Sources

| Source | Host and resource | What it gives | Role |
|---|---|---|---|
| NBU depository register | `bank.gov.ua/depo_securities?json` | per security: ISIN, nominal, coupon rate, maturity, placement date, period, currency, `payments[]` (`pay_date`, `pay_type` 1 coupon / 2 redemption, `pay_val`) | **the** schedule for every bond, every currency |
| Provider offer page | `www.inzhur.reit/offer/ovdp` (unchanged) | per bond: buy, sell and NAV prices, buy and sell return rates | broker quote (`inzhur`) |
| PrivatBank | `privatbank.ua/ovdp` | per ISIN: maturity, BID yield and ASK yield, yield type (`YTM`, or `SIM` for a simple yield), currency tab, an "актуально на" date | broker quote (new source) |
| NBU fair value | unchanged | model valuation | a different basis, unchanged |

- **The register drops a bond once it matures,** just as the provider's page does. Its schedule must
  therefore be archived nightly, the same reason `bond_terms` exists.
- **Robots:** `bank.gov.ua` disallows nothing. `privatbank.ua` allows `/ovdp`, asks for
  `Crawl-delay: 1` and disallows `/api*`. The table is in the page's HTML, so no API call is needed.
  Every request still goes through the capture's robots check, redirect hops included.
- **NBU's open-data terms** require a reference to the source wherever its data is shown.
- **Not sources, and why.** Write the reasons into *External sources* as rejections:
  - NovaPay sells its own corporate bonds, not ОВДП (§7).
  - ICU publishes no prices outside its app.
  - Finomo is a third party's aggregation. The archive keeps each dealer's own publication, as it
    keeps the provider's.

## §4 — The archive

**Decided:**
- **The register is a source of its own.** It gets a constant in `packages/core/src/archive.ts`
  beside `inzhur` and `nbu_fv`, a `price_capture` row per attempt with its payload stored, and its
  own `parser_version`.
- **PrivatBank is a source of its own,** with the same journal discipline.
- **Store what was published.**
  - PrivatBank's BID and ASK yields are stored as yields, with their yield type and their
    "актуально на" date.
  - Its price is never stored. A reader prices the yield over the archived NBU schedule with
    `derivePrice` on the quote's own day. That is the archive's own rule (premises kept, conclusions
    never; `dcf.ts`'s header).
  - Which side is which: BID is the bank's buying yield, the investor's *sell*; ASK is the bank's
    selling yield, the investor's *buy*. The higher yield is the lower price.
- **Schedules come only from the register.**
  - The capture writes a bond's terms from the register, whatever broker lists the bond.
  - The provider's `assets.bond-units` schedules are no longer read into `bond_terms`. They are no
    longer required for a night to settle.
  - Rows the provider served stay as written: no code deletes an archive row.
- **`schedule absent` changes meaning.** It now means a bond a broker quotes and the register does
  not list. That is reported, but it must not fail the night for the other bonds or sources (§2
  anti-goal). Whether it fails that broker's own day is the builder's call, written into *The price
  archive*.
- **The current failure ends with the first deploy.** #646's alarm cause disappears when the
  provider's schedules stop being required.

**Constraints the builder must respect** (each a create-time choice on DSQL; *Cloud target*):
- **`bond_terms`' key `(as_of, ref)` is immutable.** Its existing rows are the provider's. NBU rows
  must be told apart from them, without a DROP/CREATE. Options: a distinct `parser_version`, or a
  new nullable column. Either is the builder's to pick and to record.
- **`price_observation`'s key is `(as_of, instrument_ref, basis, source)`, and `price` is
  `NOT NULL`.**
  - A yield is not a price. So either PrivatBank's yields go into the existing table under
    yield-named bases with the column's meaning written down, or they get a table of their own.
  - Builder's call, with one rule: no reader may mistake a stored yield for a price.
  - The existing `ytm`, `return_rate_buy` and `return_rate_sell` columns are there to weigh.
- **One broker failing does not fail another.** Each source settles its own day, as `inzhur` and
  `nbu_fv` already do.

**Settled at the design review** (the designer's calls; the owner may override):
- **The register comes first, and the provider's archived rows are the fallback.** A reader uses a
  bond's latest NBU row. Where none exists, it uses the archived provider row.
  - Some bonds matured and left the register before its first capture. For them the provider's rows
    are the only surviving copy of an issuer fact, and the register will never serve them again.
  - `readPaymentDates` (`infra/src/sell-observations.ts`) already takes the latest row per ref. Once
    the register writes daily, that row is the NBU's for every bond the register lists, and the
    fallback needs no reader change.
  - The provenance marker is still written, because a reader that must tell the two apart (W3C
    PROV's attribution of an entity to its agent) needs it.
  - This is the same issuer fact from a second publisher. It is not a different basis standing in
    for a gap, so the price archive's no-stand-in rule for a missing NAV does not apply.
- **The register's full schedule wins, and nothing is trimmed.** The register lists payments from
  placement; the provider served fewer early dates. Stepping back from the provider's first date by
  the register's own period reproduced every earlier register date exactly (#646's comments). So the
  extra dates are the ones *Coupon cadence* already steps toward.
  - The branch measures `/view` before and after with the owner's dataset (dev against the branch,
    read-only) and lists every figure that moves.
  - The moves expected are UA4000235782's one date, and a stored coupon date snapping onto a real
    early date within the dedupe window where it used to bridge.
- **The provider stops writing `bond_terms` the day this deploys.** On the deploy day, a provider row
  may already hold `(as_of, ref)`. The register's row for that day then loses to
  `ON CONFLICT DO NOTHING`, and the register's rows start the next day. Nothing is deleted.
- **Quote verdicts read the register's schedule.** Within a firing the register is captured before
  the brokers. A verdict prices the provider's quote over the bond's latest register `bond_terms`
  row.
  - A bond with no register row gets a verdict state of its own, counted and logged.
  - It is never `unexplained`, so a missing schedule cannot raise the `UNEXPLAINED_QUOTE` alert.
- **The yield type is stored verbatim** (`YTM`, `SIM`), with a side the broker leaves unquoted (`-`)
  stored as absent.
  - `derivePrice` has no convention for a simple yield over several payments, so how a `SIM` quote
    is priced is the comparison screen's question.
  - The first deliverable only stores it.

## §5 — Readers that change in the first deliverable

- **`/view`** reads each linked bond's dates from its latest `bond_terms` row (*Cloud target*).
  From now on that row is the NBU's, or the archived provider row where the register has none (§4).
  Every figure that moves is measured and listed on the issue before merge (§4).
- **Quote verdicts** (`checkQuote`, `quoteVerdicts`): they price the provider's quote over a
  schedule, and from now on that schedule is the NBU's (§4). Measure before merge, read-only on the
  archive:
  - **Before:** the stored provider payloads of the observe window, over their own schedules.
  - **After:** the same payloads, over a register snapshot fetched for the branch. A bond that
    snapshot lacks is counted apart.
  - A verdict that changes is reported on the issue.
- **The app's feed refresh** still parses the provider's `paymentSchedule` client-side
  (`src/hooks/queries.ts`, `src/components/forms/AssetForm.tsx`,
  `src/screens/daily-quotes/suggestions.ts`). It is left alone in the first deliverable. When the
  forms gain a broker (goal 2), they switch to the archive's schedule. Record that as the moment the
  client stops reading a dealer's schedule.

## §6 — Capture timing

- PrivatBank and the register join the existing scheduled firings: `cron(0 1,3,5,7,9,11 * * ? *)`,
  Europe/Kyiv, each source settling its own day.
- PrivatBank's table carries its own "актуально на" date. The builder checks which Kyiv day a
  firing's read belongs to, and that the 01:00 firing does not read yesterday's table as today's. If
  it does, its day settles on a later firing. Record the rule in *The price archive*.
- The 1-second crawl delay is honoured: there is one request per firing.

## §7 — Later deliverables

These are sketches for their own design sessions (*Design pipeline*: brief, session, spec section,
then code). Nothing here is decided beyond what the owner said.

- **Comparison screen.**
  - Per bond: every broker's price (stored, or calculated from a yield), its yield, how fresh the
    quote is, the cheapest marked, and the NBU fair value shown as a different basis, never ranked
    with the dealers.
  - The schedule comes from the register.
  - A calculator for what a purchase pays out.
  - The model to look at is Finomo's bond page.
- **Broker on assets and transactions.**
  - A transaction names the broker it went through. An asset's figures use that broker's price.
  - The provider is the default for existing data. The owner confirms this at that design session.
- **Holdings per broker.** The same ISIN held at several brokers, each with its own quantity. A
  move of bonds between brokers is a case the design session must settle.
- **NovaPay.** Its own corporate bonds:
  - a fixed rate by term;
  - taxed like a deposit, unlike ОВДП;
  - bought in its app.

  They need a kind of asset of their own, not an ОВДП broker. Its public page shows rates, not
  per-security quotes.
- **ICU.** Revisit when it publishes prices outside its logged-in app.

## §8 — Decisions to rewrite in the branch that ships the backend

- *External sources*:
  - the closed list gains the NBU register and PrivatBank;
  - the provider's offer page is read for prices only;
  - add NovaPay, ICU and Finomo as rejections, with their reasons.
- *The price archive*:
  - schedules come from one source, the NBU register;
  - the new sources and how their rows are told apart;
  - yields stored, prices calculated;
  - what `schedule absent` now means;
  - the settling rule for PrivatBank's dated table.
- *Cloud target*, where it describes `/view`'s read of `bond_terms`.

## §9 — Left to the builder

- How NBU-served `bond_terms` rows are told apart (§4).
- Where PrivatBank's yields are stored (§4).
- The register's and PrivatBank's parsers, in `packages/core`, pure, returning keys and never prose.
- Whether a bond the register lacks fails that broker's own day (§4).
- The day-attribution rule for PrivatBank's table (§6).
- The split into sub-issues, through `plan-epic`, with the backend capture first so capture starts
  as soon as possible.
