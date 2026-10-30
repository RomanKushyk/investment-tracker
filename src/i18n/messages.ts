/**
 * English is CANONICAL: `Dict = typeof en` is the type `uk` must satisfy exactly, so a
 * missing or extra key is a compile error. `en` therefore carries no `as const` — with
 * it every value would become a literal type and `uk` could only satisfy `Dict` by
 * repeating the English strings. Widening is the point.
 *
 * Strings that take values are FUNCTIONS rather than templates with placeholders, so the
 * parameter list is part of the type.
 *
 * PROVENANCE. Strings marked ✎ are the drafts the design session left in
 * `design/extensions/appearance-language.dc.html`, which its own handover note calls
 * drafts rather than pins. Everything unmarked is written here and unreviewed.
 */

/** The Ukrainian plural rule — three forms; `messages.test.ts` pins every band. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** A block of a notice: a paragraph, or a list of its items. */
export type Block = string | string[];

/** A numbered section of a notice, its title and its blocks in order. */
function section(title: string, ...body: Block[]) {
  return { title, body };
}

export const en = {
  nav: {
    groupEntry: 'Entry',
    groupAnalytics: 'Analytics',
    dailyQuotes: 'Daily quotes',
    transactions: 'Transactions',
    overview: 'Overview',
    balances: 'Balances',
    payouts: 'Payouts',
    yield: 'Yield',
    attributes: 'Attributes',
    seasonality: 'Seasonality',
    portfolio: 'Portfolio',
    allocation: 'Allocation',
    settings: 'Settings',
    // `navigation` is the drawer's accessible NAME, never drawn: the wordmark is
    // already on screen, so a visible second title would say the same thing twice
    // while a screen reader would still have nothing to announce the dialog by.
    navigation: 'Navigation',
    openNav: 'Open navigation',
    closeNav: 'Close navigation',
    collapseNav: 'Collapse navigation',
    expandNav: 'Expand navigation',
    // The rail's currency box SHOWS a state rather than offering two, so its
    // name has to say which one is shown — «₴» alone tells a screen reader
    // nothing. It is not a toggle: the choice lives on the expanded track.
    currencyShown: (code: string) => `Currency: ${code}`,
    // Read by assistive tech only; the visible label is the group's own.
    collapseGroup: (group: string) => `Collapse ${group}`,
    expandGroup: (group: string) => `Expand ${group}`,
  },
  sidebar: {
    totalCapital: 'Total capital',
  },
  toast: {
    /** A toast that stays until closed carries this button; sonner's own name is English only. */
    close: 'Close notification',
  },
  csv: {
    title: 'Spreadsheet export (CSV)',
    helper:
      'One file per table, ready for a spreadsheet. Snapshots export wide — one row per date, one column per asset; an empty cell means no quote was saved that day, never zero.',
    // Contract 0 reaches the DISPLAY only: the file format is machine-fixed and
    // does not follow the language.
    formatNote:
      "Machine format: dot decimals, comma separators, UTF-8, CRLF. The app's own display formatting never goes into a file.",
    columnNote:
      'Snapshot columns are named "Asset name (id)" — the id in brackets names the asset unambiguously when two funds share a name.',
    failed: 'Could not build the CSV — please try again.',
    assets: 'Assets',
    snapshots: 'Snapshots',
    transactions: 'Transactions',
  },
  importing: {
    row: {
      title: 'Import',
      helper:
        'Restore a JSON backup. Import replaces everything — you review a summary first, and a safety backup downloads automatically.',
      dropLine: 'Drop a .json file here',
      dropHint: 'or use Choose file…',
      dragLine: 'Release to read the file',
      choose: 'Choose file…',
      reading: (name: string) => `Reading ${name}…`,
    },
    fileRejection: {
      type: "That file type isn't supported — pick a .json backup.",
      size: "That file is larger than 25 MB — it doesn't look like a Quirenote export.",
      count: 'Drop one file at a time.',
      empty: 'That file is empty.',
    },
    formatRejection: {
      notJson: "That file isn't valid JSON.",
      notABackup: 'This is not a Quirenote backup — it has no "quirenote-backup" marker.',
      newerFormat: (version: string) =>
        `This backup was written by a newer version of the app (format ${version}). Update the app, or export again from the version that wrote it.`,
      olderFormat: (version: string) =>
        `This backup was written by an older version of the app (format ${version}). It can no longer be imported.`,
      unsupportedFormat: "This backup's format version isn't one this app can read.",
    },
    issue: {
      unknownAssetId: (value: string) => `unknown asset id "${value}"`,
      unknownQuoteAsset: (value: string) => `quote for an unknown asset "${value}"`,
      duplicateId: (value: string) => `duplicate id "${value}" (id is the primary key)`,
      duplicatePrice: (value: string) =>
        `a second price for asset "${value}" on this day (one per asset and day)`,
      unknownKey: (value: string) => `unexpected field "${value}"`,
      forbiddenKey: (value: string) => `forbidden key "${value}"`,
      expectedDatetime: 'expected a real timestamp (yyyy-MM-ddTHH:mm:ss, no time zone)',
      expectedDate: 'expected a real date (yyyy-MM-dd)',
      expectedPositiveAmount: 'expected a positive number',
      unitsOnNonPositionRow: 'only a buy, sell, reinvest or redemption carries units',
      unitsMissingOnPositionRow: 'a buy, sell, reinvest or redemption must state its units',
      assetMissingOnAssetRow: 'only a deposit or a withdrawal may omit an asset',
      withholdingOnNonPayoutRow:
        'only a dividend accrual or an interest payout carries a withholding',
      withholdingAboveAmount: 'a withholding must be smaller than the payout it was taken from',
      noteLength: 'a note needs 1 to 100 characters of text',
      invalid: 'invalid value',
    },
    problemCount: (total: number, shown: number) => {
      const found = total === 1 ? '1 problem found' : `${total} problems found`;
      return shown < total ? `${found} — showing the first ${shown}` : found;
    },
    report: {
      title: "This file can't be imported",
      lead: 'Nothing was changed. Fix the file and try again.',
      hint: 'Rows are checked before anything is written — one bad row stops the whole import.',
      close: 'Close',
      another: 'Choose another file…',
    },
    preview: {
      title: 'Import',
      banner:
        'Replaces everything in your portfolio. Every asset, snapshot and transaction is deleted and rebuilt from this file. This cannot be undone.',
      diffLabel: 'What changes',
      colTable: 'Table',
      colAdded: 'Added',
      colReplaced: 'Replaced',
      colRemoved: 'Removed',
      rowAssets: 'Assets',
      rowSnapshots: 'Snapshots',
      rowTransactions: 'Transactions',
      warningsLabel: 'Check before you continue',
      settingsOptIn: 'Also apply the settings saved in this file',
      noSettings: 'This file carries no settings.',
      cancel: 'Cancel',
      confirm: 'Replace all data',
      pending: 'Replacing…',
    },
    // Counted nouns: every sentence that quotes one takes the finished phrase.
    count: {
      assets: (n: number) => `${n} asset${n === 1 ? '' : 's'}`,
      snapshots: (n: number) => `${n} snapshot${n === 1 ? '' : 's'}`,
      transactions: (n: number) => `${n} transaction${n === 1 ? '' : 's'}`,
    },
    fileSubline: (name: string, date: string, time: string) => `${name} · exported ${date} ${time}`,
    resultLine: (assets: string, snapshots: string, transactions: string) =>
      `After import: ${assets} · ${snapshots} · ${transactions}.`,
    settingsOptInHelper: (symbol: string) =>
      `Replaces your default currency (${symbol}). Automation and reminder preferences are never touched.`,
    safetyBackupDone: (name: string) => `Safety backup downloaded — ${name}.json.`,
    safetyBackupPending: (name: string) =>
      `A backup of your current data downloads automatically before anything is replaced — ${name}.json.`,
    warning: {
      // The list joiner and the verb agreement are assembled per language:
      // English needs "and" plus is/are, Ukrainian neither.
      rowsRemoved: (parts: string[]) => {
        const subject =
          parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
        const single = parts.length === 1 && parts[0].startsWith('1 ');
        return single
          ? `${subject} is missing from this file — it will be removed.`
          : `${subject} are missing from this file — they will be removed.`;
      },
      noAssets: 'This file has no assets — the portfolio will be empty after import.',
      noSnapshots: (current: number) =>
        `This file has no snapshots — all ${current} saved days would be removed.`,
      exportedLongAgo: (days: number, date: string) => `Exported ${days} days ago (${date}).`,
      dataMoved:
        'The data changed while this dialog was open. The summary above is updated — check it and confirm again.',
    },
    toast: {
      success: (assets: string, snapshots: string, transactions: string) =>
        `Data imported — ${assets}, ${snapshots}, ${transactions}.`,
      failed: 'Could not import — nothing was changed.',
      safetyFailed: 'Could not create the safety backup — nothing was imported.',
    },
  },
  asset: {
    // Tag vocabulary. LONG is the Attributes card, SHORT the Portfolio table
    // and Overview meta — the reference gives them different words, not just
    // different lengths, so both survive as their own map.
    yieldLong: {
      div_cap: 'div + cap',
      capitalization: 'capitalization',
      fixed_coupon: 'fixed coupon',
      dividends: 'dividends',
    },
    yieldShort: {
      div_cap: 'div + cap',
      capitalization: 'cap',
      fixed_coupon: 'coupon',
      dividends: 'dividends',
    },
    yieldOption: {
      fixed_coupon: 'Fixed coupon',
      dividends: 'Dividends',
      capitalization: 'Capitalization',
      div_cap: 'Dividends + capitalization',
    },
    schedule: {
      maturity: 'At maturity',
      monthly: 'Monthly',
      quarterly: 'Quarterly',
      semiannual: 'Semi-annual',
      none: 'None (price only)',
    },
    // The frequency WORD inside the Coupon fact ("₴1,240 semi-annual"), which
    // is the schedule in lower case in English and a different construction in
    // Ukrainian — hence its own map rather than a toLowerCase().
    couponFrequency: {
      maturity: 'at maturity',
      monthly: 'monthly',
      quarterly: 'quarterly',
      semiannual: 'semi-annual',
      none: '',
    },
    field: {
      name: 'Name',
      code: 'Code',
      expectedPct: 'Expected, %',
      targetPct: 'Target share, %',
      yieldType: 'Yield type',
      payoutSchedule: 'Payout schedule',
      firstPurchase: 'First purchase',
      maturity: 'Maturity',
      nextCoupon: 'Next coupon',
      couponRatePct: 'Coupon rate, %',
      linkToInzhur: 'Link to Inzhur',
      // The fixed-coupon group's heading, shown only for a bond.
      fixedCouponGroup: 'Fixed coupon',
    },
    message: {
      name: 'Name is required.',
      code: 'Code is 1–2 letters.',
      expectedPct: 'Enter a percentage.',
      targetPct: 'Enter a percentage.',
      couponRatePct: 'Enter the coupon rate.',
      firstPurchase: 'Pick a date.',
      maturity: 'Pick a date.',
      nextCoupon: 'Pick a date.',
      refFund: 'Enter the fund slug.',
      refBond: 'Enter the bond ISIN.',
      summary: 'Check the highlighted fields and try again.',
    },
    // A placeholder MODELS the input convention, so it follows the language like any
    // other figure (Contract 0) and models what the field will ACCEPT: the Ukrainian
    // `16,5` is unreadable under English, so swapping these for the Ukrainian forms
    // would make the field refuse its own example (*Language, numbers, fonts*).
    placeholder: {
      name: 'OVDP UA4000241234',
      expectedPct: '16.5',
      targetPct: '10',
      couponRatePct: '15.68',
      maturity: '25 Feb 2027',
      nextCoupon: '25 Aug 2026',
    },
    picker: {
      placeholder: 'Pick from Inzhur…',
      loading: 'Loading Inzhur assets…',
      failed: "Couldn't load the list — enter it manually.",
      empty: 'Nothing of this kind in the feed — enter it manually.',
      toManual: 'Enter manually',
      toPicker: 'Pick from the list',
      helper:
        'Linked assets are valued as units × the fetched sell price. Units come from your transactions — record the quantity when you buy.',
      fund: 'Fund',
      bond: 'Bond',
      fundManual: 'Fund slug',
      bondManual: 'Bond ISIN',
      matures: (date: string) => `matures ${date}`,
    },
  },
  // The last Inzhur parse, said out loud (components/ui/ParseSkips).
  parse: {
    reason: {
      not_an_array: 'the response was not a list of assets',
      shape: 'unreadable fields',
      no_ref: 'no ISIN or slug to identify it',
    },
    allClean: (entries: number, at: string) => `All ${entries} feed entries read cleanly · ${at}`,
    failed: (count: number) =>
      count === 1 ? '1 feed entry could not be read' : `${count} feed entries could not be read`,
    readFine: (entries: number) => `${entries} read fine`,
    hide: 'hide',
    show: 'show',
  },
  sync: {
    staleWrite:
      'This changed in another tab or on another device, so nothing was saved. The screen shows the current data now — check it and try again.',
  },
  loading: { status: 'Loading your portfolio…' },
  reminders: {
    quoteMissing: 'No quotes saved today yet.',
    coupon: (asset: string, when: string, date: string) =>
      `${asset} pays a coupon ${when} (${date}).`,
    couponOverdue: (asset: string, date: string) =>
      `${asset} coupon was due ${date} — record it on Daily quotes.`,
    maturesToday: (asset: string, date: string) => `${asset} matures today (${date}).`,
    matures: (asset: string, when: string, date: string) => `${asset} matures ${when} (${date}).`,
    inDays: (days: number) => (days === 1 ? 'in 1 day' : `in ${days} days`),
    moreReminders: (hidden: number) => `+${hidden} more reminder${hidden === 1 ? '' : 's'}`,
    enterQuotes: 'Enter quotes →',
    openDailyQuotes: 'Open Daily quotes →',
    dismiss: 'Dismiss reminder',
    andMore: (rest: number) => ` · +${rest} more`,
  },
  dates: {
    // Chart axes and month labels. The formatter owns full DATES (Contract 0); these
    // are the month WORDS a chart axis and a sentence need on their own, written out
    // rather than taken from `Intl`: they follow the language the USER chose, where
    // `toLocaleString` would answer with the one the platform reports.
    monthShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    monthFull: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    // Joins the two coupon months in the Seasonality card.
    listAnd: ' & ',
    pick: 'Pick a date',
    selected: (date: string) => `Date: ${date}`,
    // The calendar's caption is two buttons, and its year grid pages by twelve.
    // These four are their accessible names — the only strings the custom
    // caption needs, because the month words are `monthFull` above.
    pickMonth: 'Pick a month',
    pickYear: 'Pick a year',
    prevYears: 'Previous years',
    nextYears: 'Next years',
    // The month AFTER a preposition of time ("pays in early June"). English repeats
    // monthFull; Ukrainian needs the genitive — "на початку червня", never "червень" —
    // so the two lists cannot be one.
    monthIn: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    // "~10th" in English; Ukrainian has no ordinal suffix of this kind and
    // writes the day with a genitive marker instead.
    dayOfMonth: (n: number) => {
      const v = n % 100;
      if (v >= 11 && v <= 13) return `${n}th`;
      switch (n % 10) {
        case 1:
          return `${n}st`;
        case 2:
          return `${n}nd`;
        case 3:
          return `${n}rd`;
        default:
          return `${n}th`;
      }
    },
  },
  /**
   * UKRAINIAN PLURALS ARE THE RULE, NOT THE ENGLISH PATTERN — `1 місяць`, `3 місяці`,
   * `12 місяців` are three forms. Written out rather than generated because there are
   * exactly six and the set is closed; the generated form is what `assets.deleteBody`
   * needs and this does not.
   *
   * The option HINT is not here: it is the resolved start date, formatted at render
   * through `f.dateShort(window.from)` — derived, so it needs no string and stays
   * correct as the history grows.
   */
  period: {
    ariaLabel: 'Period',
    /**
     * TWO FORMS, because the mark means "extrapolated from under a year" and not
     * "annualized" — that is what `/yield`'s header means by it. Three characters
     * meaning opposite things on two adjacent screens is worse than no mark:
     * `/yield` drops it once a window reaches 365 days, so this must too.
     */
    portfolioXirr: (rate: string) => `Portfolio XIRR ${rate}`,
    /** Same figure, marked as an extrapolation — the `/yield` header's rule. */
    portfolioXirrAnn: (rate: string) => `Portfolio XIRR ${rate} (ann.)`,
    all: 'Since start',
    '1m': '1 month',
    '3m': '3 months',
    '6m': '6 months',
    '12m': '12 months',
    ytd: 'Year to date',
    /** Shown after the dates when `resolveWindow` reports `clamped`. */
    clamped: 'Full history — shorter than the period you picked.',
    /**
     * The same mark, in the OPTION ROW, where the choice is actually made: a mark
     * that only appears after the press marks nothing. Short because it shares its
     * row with a label and a date.
     */
    clampedHint: 'all of it',
  },
  analytics: {
    // Column and field terms shared by several screens — one place, so the
    // same concept cannot end up with two words on two tables.
    asset: 'Asset',
    invested: 'Invested, ₴',
    valueNow: 'Value now, ₴',
    deltaTotal: 'Δ total',
    annualized: 'Annualized',
    totalReturn: 'Total return',
    vsExpected: 'vs expected',
    yieldType: 'Yield type',
    capitalGainUah: 'Capital gain, ₴',
    capitalGainPct: 'Capital gain, %',
    ofItReinvested: 'of it reinvested',
    // The unit that follows a rate on the Attributes facts ("16.5 % / yr").
    perYear: '/ yr',
    // Percentage POINTS, the unit of a vs-expected gap. NBSP in both languages:
    // a figure that wraps away from its unit is the failure f.pp's `%` branch
    // already guards against.
    ppSuffix: ' pp',
    share: 'Share',
    // The accessible name of a share's «—»: a bare dash reads as nothing, or "hyphen".
    notComputable: 'cannot be computed',
    cashShort: 'Free cash below zero',
    cashShortDetail:
      'Free cash is below zero or unreadable — look for a missing deposit or a withdrawal larger than the balance.',
    snapshot: 'Snapshot',
    cash: 'Cash',
    totalUah: 'Total, ₴',
    prev: 'Prev',
    next: 'Next',
    date: 'Date',
    type: 'Type',
    amountUah: 'Amount, ₴',
    // The payout log's two read-back columns (#138). Units where the table puts
    // them, because `RecordCard` reuses these VERBATIM as the 360 card's labels.
    withheldUah: 'Withheld, ₴',
    netOfTaxUah: 'Net of tax, ₴',
    destination: 'Destination',
    dividends: 'Dividends',
    coupons: 'Coupons',
    upcoming: 'Upcoming',
    noUpcoming: 'No upcoming payouts.',
    receivedTotal: 'Received total',
    reinvested: 'Reinvested',
    overview: {
      assets: 'Assets',
      nextPayouts: 'Next payouts',
      rebalanceHint: 'Rebalance hint',
      onTarget: 'Allocation is on target.',
      openAllocation: 'Open Allocation →',
      incomeReceived: 'Income received',
      totalCapital: 'Total capital',
      capitalGain: 'Capital gain',
      totalReturnNet: 'Total return (net)',
      depositedReinvested: 'Deposited / Reinvested',
      freeCash: 'Free cash',
    },
    portfolio: {
      bestPerformer: 'Best performer',
      // The income kind named in the engine card's sub-line.
      dividendsWord: 'dividends',
      couponsWord: 'coupons',
      laggard: 'Laggard',
      incomeEngine: 'Income engine',
      noQuotes: 'No quotes yet.',
      autoReinvested: ' · auto-reinvested',
    },
    // Each card is a sentence built around ONE <strong> span, so it splits in
    // two: the bolded opener and the rest. Both languages put the bold first,
    // which is what makes the split translatable at all.
    seasonality: {
      incomeAnchor: 'Income anchor',
      couponSeason: 'Coupon season',
      quietStretch: 'Quiet stretch',
      axisByDay: 'By day',
      axisByMonth: 'By month',
      axisAriaLabel: 'Chart axis',
      // The chart's two series, in the tooltip. Words the app already prints, not new copy.
      received: 'Received',
      expected: 'Expected',
      anchorDay: (day: number) => `Day ${day}`,
      // Lowercase: it sits after a figure on the chart's own bar label.
      dayShort: (day: number) => `day ${day}`,
      anchorRest: (asset: string, frequency: string, first: string, last: string) =>
        ` is the paycheck: ${asset} dividends land ${frequency}, ${first} → ${last} and growing.`,
      anchorEmpty: 'No recurring income yet.',
      couponMonths: (months: string, day: number) => `${months} (day ${day})`,
      /**
       * AGREES WITH THE SUBJECT: a window can leave the months list with exactly one
       * entry, and «Серпень … несуть» is what a fixed plural verb renders then.
       */
      couponRest: (asset: string, count: number) =>
        `${count === 1 ? ' carries' : ' carry'} the big ${asset} coupons`,
      couponOther: (asset: string, when: string, month: string) =>
        `; ${asset} pays in ${when} ${month}`,
      couponEmpty: 'No bond coupons yet.',
      quietDays: (from: number, to: number) => `Days ${from}–${to}`,
      quietRest: ' see almost no cash events — a good window for rebalancing buys.',
      quietEmpty: 'Income is spread evenly across the month.',
      frequency: {
        monthly: 'every month',
        quarterly: 'every quarter',
        semiannual: 'twice a year',
        maturity: 'at maturity',
        none: '',
      },
      dayPart: { early: 'early', mid: 'mid', late: 'late' },
    },
    allocation: {
      currentVsTarget: 'Current vs target',
      rebalancePlan: 'Rebalance plan',
      buy: 'Buy',
      trim: 'Trim',
      withinRange: 'within ±0.5% — no action',
      // The donut's centre: a rounded thousands figure, so the unit word is
      // part of the phrase and not something the money formatter can place.
      centerTotal: (thousands: number) => `₴${thousands}k`,
      assetsPlusCash: (n: number) => `${n} ${n === 1 ? 'asset' : 'assets'} + cash`,
    },
    yield: {
      xirr: 'XIRR',
      // "(ann.)" only while history < 365 days — an extrapolation, said as one.
      xirrAnn: 'XIRR (ann.)',
    },
    balances: {
      pending: 'pending',
      // The legend the mark points at, and the marked cell's own `title`. It says
      // the total leaves the value out, which is why the row still adds up.
      notHeldQuote:
        'Quote saved for a day on which your transactions hold no units of this asset: shown, not counted in the row total.',
    },
    attributes: {
      ytmAtPurchase: 'YTM at purchase',
      coupon: 'Coupon',
      maturity: 'Maturity',
      targetShare: 'Target share',
      firstPurchase: 'First purchase',
      nextCoupon: 'Next coupon',
      expectedReturn: 'Expected return',
      actualAnn: 'Actual (ann.)',
      payoutSchedule: 'Payout schedule',
    },
    prose: {
      totalPlusCash: (cash: string) => `Total + cash ${cash}`,
      // Shown only when the solved YTM and the stored one disagree — the rest
      // of the app still measures against the stored figure.
      ytmDerived: (stored: string) =>
        `Solved from the price you paid. The stored expected return is ${stored}, and that is what /yield compares against.`,
      capitalGainNote:
        'Capital gain = value + sale and redemption proceeds − invested (incl. reinvested payouts). Payout income counts in Total return on the Yield screen.',
      inWeeks: (pct: string, weeks: number) => `${pct} in ${weeks} weeks`,
      watchVsExpected: (pct: string, expected: string) => `${pct} · watch vs ${expected} expected`,
      ofReceivedIncome: (pct: string) => `${pct} of received income`,
      reinvestedInto: (amount: string) => `reinvested (${amount})`,
      toAccount: 'account',
      ofAccount: (pct: string) => `${pct} of account`,
      // The line under the capital card (rate-attribution.dc.html): `nbu` is the link, and
      // `rateLine` or `rateNone` follows it. The no-break spaces keep «NBU 41.4983» and
      // «for 10 Oct 2026» whole, so a narrow card breaks before «for».
      nbu: 'NBU',
      rateLine: (rate: string, date: string) => `\u00A0${rate} for\u00A0${date}`,
      rateNone: ' rate unavailable',
      // Starts with the visible word, so the name holds what is on screen (WCAG 2.5.3).
      nbuLabel: 'NBU, open data',
      plusReinvested: (amount: string) => `+ ${amount} reinvested`,
      sinceDate: (pct: string, date: string) => `${pct} since ${date}`,
      onNetDeposits: (pct: string) => `${pct} on net deposits`,
      couponOf: (asset: string) => `Coupon ${asset}`,
      dividendOf: (asset: string) => `${asset} dividend`,
      // The Payouts table's own tag — lowercase, one word per row.
      dividendTag: 'dividend',
      couponTag: 'coupon',
      dividendsAndCoupons: (dividends: string, coupons: string) =>
        `${dividends} dividends · ${coupons} coupons`,
      dividendsCouponsSplit: (dividends: string, coupons: string) =>
        `dividends ${dividends} · coupons ${coupons}`,
      showingSnapshots: (shown: number, total: number, since: string) =>
        `Showing last ${shown} snapshots · ${total} total since ${since}`,
      netOfTax: (amount: string) => `net of tax ${amount}`,
      seasonalityNote:
        // WINDOW-AGNOSTIC: under a window a day can carry income and still draw a
        // grey stub because the income fell outside, so the footnote has to name the
        // period or it misreads a windowed-out day as a quiet one.
        "* expected — projected from the asset's next coupon date. Gray stubs = days with no income IN THE SELECTED PERIOD.",
      /**
       * WINDOW-AGNOSTIC: the date it names is the window's start, which at
       * `Від початку` IS the first purchase — so one sentence serves the widest
       * window and every narrower one.
       */
      yieldNote: (start: string) =>
        `Annualized = total Δ scaled to 365 days from ${start}. Coupons count toward Δ on accrual. Total return is net of taxes and includes payouts. XIRR is money-weighted and annualized — with under a year of history, treat it as an extrapolation.`,
      /**
       * The legend the grey owes. 90 % is `1 - SHORT_BASIS_TOLERANCE` read aloud;
       * the two move together.
       */
      shortBasisNote:
        'Grey = annualized over a basis this asset was held for less than 90 % of, so the rate reads low.',
      // The hint is assembled around two <strong> spans, so it is two slots
      // rather than one sentence. The slot ORDER happens to match in both
      // languages — asset · connector · delta · phrase(target) · amount.
      rebalanceIs: 'is',
      underTarget: (target: string) => `under its ${target} target — top up`,
    },
    empty: {
      chart: 'No snapshots yet — save your first daily quote to start this chart.',
      table: 'No snapshots yet — save your first daily quote to fill this table.',
      rebalance: 'No snapshots yet — save your first daily quote to see the rebalance hint.',
      allocation: 'No snapshots yet — save your first daily quote to see the allocation mix.',
    },
  },
  assets: {
    edit: 'Edit',
    delete: 'Delete',
    // Four rows of identical "Edit / Delete" tell a screen reader nothing about
    // WHICH asset, on a pair where one choice is destructive. Same shape as
    // `targets.fieldAria`.
    editAria: (asset: string) => `Edit ${asset}`,
    deleteAria: (asset: string) => `Delete ${asset}`,
    actionsHeader: 'Actions',
    // The leading plus is a <Plus> ICON, not text — it stays out of the string.
    add: 'Add asset',
    empty: 'No assets yet — add your first asset to start tracking.',
    deleteTitle: (name: string) => `Delete ${name}?`,
    // The cascade the confirm is really asking about, and the one sentence here with
    // TWO counts — a shared template would have to get both right.
    deleteBody: (transactions: number, quoteDays: number) =>
      `This removes the asset and everything recorded for it — ${transactions} transaction${transactions === 1 ? '' : 's'} and quotes on ${quoteDays} day${quoteDays === 1 ? '' : 's'}. This cannot be undone.`,
    deleteAction: 'Delete asset',
    editTitle: 'Edit asset',
    saveChanges: 'Save changes',
    cancel: 'Cancel',
    addedToast: 'Asset added',
    updatedToast: 'Asset updated',
    deletedToast: 'Asset deleted',
    saveFailed: 'Could not save the asset — please try again.',
    deleteFailed: 'Could not complete — nothing was deleted.',
  },
  // No `save` or `now` key: the header's button does the write, and the row shows a
  // bare share.
  targets: {
    title: 'Targets',
    savedToast: 'Targets saved',
    saveFailed: 'Could not save targets — please try again.',
    invalid: 'Enter a percentage.',
    fieldAria: (asset: string) => `${asset} target, %`,
    sumOk: (sum: string) => `Σ ${sum}`,
    sumOff: (sum: string) => `Σ ${sum} — targets don't add up to 100%`,
  },
  danger: {
    // The typed word is DATA, not copy: the confirm compares it with the word the
    // dialog names, so translating it would make the button unarmable.
    typeToConfirm: (word: string) => `Type ${word} to confirm`,
    backupFirst: 'Download backup first',
    backupDone: 'Backup downloaded ✓',
    failed: 'Could not complete — nothing was deleted.',
    trigger: 'Erase data…',
    title: 'Erase data?',
    body: 'This permanently deletes every asset, snapshot and transaction. The unsaved quote draft is cleared too — settings are kept. This cannot be undone.',
    action: 'Erase data',
    success: 'Data erased',
  },
  settings: {
    sections: {
      data: 'Data',
      automation: 'Automation',
      appearance: 'Appearance',
      admin: 'Administration',
    },
    theme: {
      title: 'Theme',
      helper: 'System follows your device setting.',
      ariaLabel: 'Colour theme',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
    },
    currency: {
      title: 'Currency',
      helper:
        'The currency the app opens in. The sidebar toggle previews the other one without saving it.',
    },
    language: {
      title: 'Language',
      helper: 'Changes text, number and date formats.',
      ariaLabel: 'Interface language',
      // Each language NAMES ITSELF in its own script, in both dictionaries. A switch
      // that labels a language in a language you cannot read is the one place where
      // translating the label defeats its purpose.
      uk: 'Українська',
      en: 'English',
    },
    backup: {
      title: 'Backup',
      helper: 'Full JSON backup — quirenote-backup-<date>.json. Restore it with Import below.',
      button: 'Download backup',
      failedToast: 'Could not build the backup — please try again.',
      unreadableToast: (issue: string) =>
        `Backup not saved: this build cannot read the file it just built (${issue}).`,
    },
    dangerZone: {
      title: 'Danger zone',
      helper: 'The action asks for a typed confirmation and offers a backup first.',
    },
    quoteSuggest: {
      title: 'Quote suggestions',
      helper:
        'Pre-fill ghost values for unquoted fixed-coupon assets from coupon accrual. Suggestions stay ghosts until you accept them.',
    },
    couponSuggest: {
      title: 'Coupon suggestions',
      helper:
        'Offer one-tap recording when a coupon date arrives. Every entry is confirmed by you — amounts stay editable.',
    },
    reminders: {
      title: 'Reminders',
      helper:
        'In-app banners for missing quotes, upcoming and overdue coupons, and maturities. Nothing leaves the app.',
      leadTitle: 'Lead time, days',
      leadHelper: 'How many days ahead coupon reminders appear.',
      leadAriaLabel: 'Reminder lead time, days',
      leadInvalid: 'Enter 1–30 days.',
      dismissedTitle: 'Dismissed reminders',
      dismissedHelper: 'Dismissed banners stay hidden until their date passes.',
      restore: 'Restore dismissed',
      restoreWithCount: (count: number) => `Restore dismissed (${count})`,
      restoredToast: 'Dismissed reminders restored',
    },
    parse: {
      title: 'Last feed parse',
      helper:
        'What the last Inzhur fetch could and could not read. Entries that fail are skipped, never guessed — the rest of the feed still loads.',
    },
    archive: {
      title: 'Price archive',
      helper:
        'Quote coverage by source, two archive repairs and the run log. Only the super-admin sees this card.',
      open: 'Open',
    },
  },
  // `design/extensions/archive-admin.dc.html`, T9.
  archive: {
    read: {
      stamp: (at: string) => `Snapshot ${at}`,
      reading: 'Reading the archive…',
      refresh: 'Refresh',
      refreshing: 'Refreshing',
      refreshingAt: (at: string) => `Snapshot ${at} · refreshing…`,
      refreshFailed: (at: string) => `Snapshot ${at} · refresh failed:`,
      failed: 'Couldn’t read the archive',
      capture_failed: 'The capture answered with an error.',
      capture_timeout: 'The archive didn’t answer within 25 s; the read may still be running.',
      status: (n: number) => `The answer was HTTP ${n}.`,
      offline: 'The server did not answer.',
      retry: 'Try again',
      unread: 'The archive has not been read yet',
      unreadLead:
        'The diagnosis reads the whole archive and takes up to 25 s, so it runs only when you ask.',
      start: 'Read the archive',
      starting: 'Reading',
    },
    source: { inzhur: 'Inzhur · quotes and NAV', nbu_fv: 'NBU · fair value' },
    kpi: {
      empty: (n: number, shown: string) => `${shown} ${n === 1 ? 'day' : 'days'}`,
      emptySub: (k: number, m: number, u: number) =>
        `empty days · in ${k} of ${m} ${m === 1 ? 'group' : 'groups'} · ${u} not measured`,
      noEmpty: 'no empty days',
      gaps: 'Published less written (gaps)',
      size: 'Captures · size',
    },
    coverage: {
      title: (source: string) => `Coverage · ${source}`,
      span: (from: string, n: number) => `${from} — today · groups: ${n}`,
      captured: 'Captured',
      imported: 'Imported history',
      empty: 'Empty day',
      unserved: 'Dates not served',
      today: 'today',
      notMeasured: 'not measured',
      cut: (n: number, shown: string, date: string) =>
        `${shown} more empty ${n === 1 ? 'day' : 'days'} before ${date} — dates not served`,
    },
    spot: {
      title: 'Latest rows',
      total: (rows: string, size: string) => `Stored captures: ${rows} · ${size}`,
      date: 'Date',
      instrument: 'Instrument',
      basis: 'Basis',
      price: 'Price',
      ytm: 'YTM',
      clean: 'Clean price',
      line: (price: string, ytm: string, clean: string) =>
        `Price ${price} · YTM ${ytm} · Clean ${clean}`,
    },
    repairs: {
      title: 'Repairs',
      start: 'Start…',
      observe: {
        title: 'Backfill observations',
        helper:
          'Re-reads the source’s stored captures over a range and writes the observations missing; a day with no capture cannot be filled this way. A long range can finish partly — the log shows where to continue.',
        source: 'Source',
        from: 'From',
        to: 'To',
        sources: { inzhur: 'Inzhur', nbu_fv: 'NBU' },
      },
      import: {
        title: 'Import fund history',
        helper:
          'Downloads a fund’s NAV history as the provider publishes it and writes the days the archive does not hold yet.',
        funds: 'Funds',
        names: { 'inzhur-reit': 'Inzhur REIT', 'inzhur-energy': 'Inzhur Energy' },
      },
      confirm: {
        observe: 'Start the backfill?',
        import: 'Start the import?',
        body: 'The start goes to the server with these parameters.',
        operation: 'Operation',
        days: 'Days in range',
        ops: { observe: 'Observation backfill', importFundHistory: 'Fund history import' },
        cancel: 'Cancel',
        start: 'Start',
      },
      refused: {
        prodOnly:
          'Starting is off here: only production runs repairs. The diagnosis and the log work.',
        // By the field and the code the route's 422 names (`issuesOf`): `refs.<n>` reads as
        // `refsN`, and a code with no field before it holds for any field.
        field: {
          'to.custom': 'The end is before the start.',
          invalid_format: 'A calendar day is needed.',
          invalid_type: 'Required.',
          'source.invalid_value': 'Unknown source.',
          'refs.too_small': 'Choose at least one fund.',
          'refs.custom': 'A fund is named twice.',
          'refsN.invalid_value': 'Unknown fund.',
        },
        other: (field: string, code: string) => `The server refused the start: ${field} — ${code}.`,
        startFailed:
          'The server could not start it. If the run was recorded, the log will show it failed.',
        network:
          'The server did not answer. The start may have arrived: check the log before trying again.',
        throttled: 'Too many starts at once. Try again in a moment.',
        internal:
          'The server did not take the start. Try again; if it was recorded after all, it will appear in the log.',
      },
    },
    runs: {
      title: 'Run log',
      order: 'newest first',
      columns: {
        state: 'State',
        operation: 'Operation',
        started: 'Started',
        by: 'Started by',
        result: 'Result',
      },
      state: { pending: 'Sending', running: 'Running', succeeded: 'Done', failed: 'Failed' },
      observe: (source: string) => `Backfill · ${source}`,
      import: 'History import',
      pending: 'Request sent, waiting for the server.',
      justNow: 'just now',
      running: (at: string) => `Running. With no answer by ${at} the run counts as failed.`,
      until: (at: string) => `until ${at}`,
      nbu: (dates: string, written: string, mismatched: string) =>
        `Dates: ${dates} · rows written ${written} · mismatched ${mismatched}`,
      inzhur: (
        dates: string,
        written: string,
        skipped: string,
        termsWritten: string,
        termsRefused: string,
      ) =>
        `Dates: ${dates} · rows written ${written}, skipped ${skipped} · terms: written ${termsWritten}, refused ${termsRefused}`,
      fund: (ref: string, n: number, rows: string, written: string, from: string, to: string) =>
        `${ref}: ${rows} ${n === 1 ? 'row' : 'rows'}, written ${written} · ${from} – ${to}`,
      incomplete: (next: string) => `Not finished — continue from ${next}`,
      reason: {
        start_failed: 'The start was refused.',
        capture_failed: 'The capture ended in an error.',
        deadline_exceeded: (minutes: number) =>
          `Over the time limit: the run didn’t answer within ${minutes} min, no result.`,
      },
      you: 'You',
      by: 'Started by:',
      empty: 'No runs yet',
      emptyLead: 'A start from the forms above appears here: who, what, when and how it ended.',
      more: 'Show more',
      staleStatus: (at: string, n: number) =>
        `The log did not refresh at ${at}: the answer was HTTP ${n}. Still refreshing.`,
      staleOffline: (at: string) =>
        `The log did not refresh at ${at}: the server did not answer. Still refreshing.`,
      failed: 'Couldn’t read the log',
      failedLead: (cause: string) => `${cause} Runs go on without it.`,
    },
  },
  // `design/extensions/own-account.dc.html`, T9; the copy's failure is the owner's ruling on #192.
  profile: {
    title: 'Profile',
    subtitle: 'Your account, how you sign in, and your data',
    sections: { account: 'Account', data: 'Your data', sessions: 'Sessions', signIn: 'Sign-in' },
    email: 'Address',
    /** Shown for the super-admin alone: a role is named where it names a privilege. */
    role: 'Role',
    superAdmin: 'Super-admin',
    since: 'Member since',
    id: 'Account ID',
    copy: 'Copy',
    copied: 'Copied',
    copiedStatus: 'Account ID copied',
    copyFailed: 'Not copied',
    copyFailedStatus: 'Couldn’t copy the account ID. It is selected, so you can copy it yourself.',
    google: 'Google',
    linked: 'Linked',
    notLinked: 'Not linked',
    passkeys: {
      title: 'Passkeys',
      /** A passkey Cognito gave no name. */
      unnamed: 'Passkey',
      created: (date: string) => `Created ${date}`,
      none: 'No passkeys yet.',
      google:
        'Passkeys show after a sign-in with a password or a passkey. You signed in with Google.',
      failed: 'Couldn’t read your passkeys. Reload the page to try again.',
    },
    assets: 'Assets',
    transactions: 'Transactions',
    firstActivity: 'First transaction',
    copyData: {
      title: 'A copy of your data',
      helper: 'A full JSON copy and CSV tables are in Settings, under Data.',
      open: 'Go to Settings',
    },
    // `privacy-notice.dc.html` S6: the row after the copy, to the notice.
    privacy: {
      title: 'How we handle your data',
      helper: 'Who holds it, why, for how long, and your rights.',
      open: 'Privacy',
    },
    // `terms-of-use.dc.html` T4: the row after the notice's, to the terms.
    terms: {
      title: 'Terms of use',
      helper: 'The terms the service runs on, and what it does not do.',
      open: 'Terms',
    },
    // `own-account.dc.html` T4 and `re-authentication.dc.html` T9: the action's own lines.
    signOutEverywhere: {
      title: 'Sign out everywhere',
      helper: 'Ends the sign-in on every device, this one included. You confirm it’s you first.',
      open: 'Sign out everywhere…',
      confirm: {
        title: 'Sign out everywhere?',
        body: 'The sign-in ends on every device, this one included. Next, confirm it’s you.',
        cancel: 'Cancel',
        continue: 'Continue',
      },
      reauth: {
        lead: 'Before you sign out everywhere, confirm your sign-in.',
        action: 'Sign out everywhere',
        busy: 'Signing out…',
        failed: 'Couldn’t sign out everywhere. Try again.',
        confirmedLead: 'You can now sign out on every device, this one included.',
      },
    },
  },
  // Re-authentication's own lines (`re-authentication.dc.html` T9); the action brings the rest.
  reauth: {
    title: 'Confirm it’s you',
    continue: 'Confirm',
    passkey: {
      usePassword: 'Confirm with your password',
      notFinished:
        'Passkey confirmation didn’t finish: it was cancelled, or this device has no passkey for this address.',
    },
    // The address is the signed-in account's own, so the sentence names the password alone.
    password: { wrong: 'Incorrect password.' },
    confirmed: { title: 'You’ve confirmed it’s you' },
    google: {
      completing: 'Finishing your Google confirmation.',
      failed: 'Your Google confirmation didn’t finish.',
    },
    timeLeft: (time: string) => `${time} left`,
    // Said once, to a screen reader, as the time left turns to seconds.
    timeReminder: '1 minute left.',
    expired: 'The time to confirm ran out. Confirm it’s you again.',
  },
  // The brief on #164 and its amendments; `failed` is the owner's ruling on #165.
  auth: {
    signIn: {
      title: 'Sign in',
      lead: 'Use the address your invitation was sent to.',
      continue: 'Continue',
      checking: 'Checking…',
      applyPrompt: 'No access yet?',
      applyLink: 'Apply for access',
    },
    email: 'Email',
    emailMissing: 'Enter your email address.',
    emailInvalid: 'Use Latin letters, like name@example.com.',
    change: 'Change',
    changeLabel: 'Change the address',
    // A sign-in on its way in: back from Google, and a passkey being verified.
    signingIn: 'Signing in…',
    passkey: {
      title: 'Confirm with your passkey',
      lead: 'Your browser opened its passkey window.',
      usePassword: 'Use your password instead',
      notFinished:
        'Passkey sign-in didn’t finish: it was cancelled, or this device has no passkey for this address.',
    },
    // `failed` names no cause: a refused application and a cancelled chooser come back alike.
    google: {
      or: 'or',
      continue: 'Continue with Google',
      failed: 'Google sign-in didn’t finish.',
      completing: 'Finishing your Google sign-in.',
    },
    retry: 'Try again',
    password: {
      title: 'Enter your password',
      label: 'Password',
      show: 'Show password',
      hide: 'Hide password',
      submit: 'Sign in',
      busy: 'Signing in…',
      missing: 'Enter your password.',
      wrong: 'Incorrect email or password.',
    },
    setPassword: {
      title: 'Set your password',
      lead: 'The temporary password from your invitation works only for the first sign-in. Choose your own.',
      label: 'New password',
      // The pool's own policy, as `template-user.yaml` writes it out.
      rule: 'At least 8 characters, with an upper-case and a lower-case letter, a number and a symbol.',
      reused: 'That’s the temporary password. Choose your own.',
      /** Back on the password step: the session the temporary password opened lives three minutes. */
      expired: 'The time to set your password ran out. Enter the temporary password again.',
      submit: 'Save and continue',
      busy: 'Saving…',
    },
    addPasskey: {
      title: 'Add a passkey',
      lead: 'Next time, sign in with this device’s fingerprint, face or screen lock instead of a password.',
      create: 'Create a passkey',
      later: 'Not now',
      createdTitle: 'Passkey created',
      createdLead: 'Next time, the browser will offer it right after your address.',
      continue: 'Continue',
      notCreated:
        'The passkey wasn’t created: the window was closed, or this device can’t store one.',
      // Cognito's refusal, not the dialog's: neither of `notCreated`'s two causes.
      failed: 'The passkey couldn’t be saved. Try again.',
    },
    tooMany: 'Too many attempts. Try again later.',
    offline: 'Couldn’t connect. Check your connection and try again.',
    failed: 'Sign-in couldn’t finish. Try again.',
    apply: {
      title: 'Apply for access',
      lead: 'Quirenote is by application. If yours is approved, the invitation goes to this address.',
      submit: 'Apply',
      busy: 'Sending…',
      signInPrompt: 'Already have access?',
      signInLink: 'Sign in',
      busyServer: 'Too many requests right now. Try again in a moment.',
      failed: 'The application couldn’t be sent. Try again.',
      termsOutdated:
        'The terms of use have changed. Reload the page to read them, then apply again.',
      recordedTitle: 'Application recorded',
      recordedLead: (email: string) =>
        `If it’s approved, the invitation will go to ${email}. No other email is sent.`,
      back: 'Back to sign in',
    },
    /** The Turnstile check under a form's button (`bot-check.dc.html` T5). */
    botCheck: {
      /** A press before the token where the start cannot wait: the passkey sheet opens only after it. */
      pending: 'The security check is still running. Try again in a moment.',
      /** The widget failed, or the route refused its token. */
      failed: 'The security check didn’t finish. Try again.',
      /** No widget on the page: the script never ran, or Turnstile refused this page or browser. */
      unavailable:
        'The security check couldn’t load. Check your connection or ad blocker, then reload the page.',
    },
    signedInAs: (email: string) => `Signed in as ${email}`,
    /** The address's name as the profile's link, in the panel and the rail. */
    profileLink: (email: string) => `Profile: ${email}`,
    /** The account row when the ID token names no address. */
    signedIn: 'Signed in',
    signOut: 'Sign out',
    /** The same row answered signed out, and the entry under it, a link to `/sign-in`. */
    notSignedIn: 'Not signed in',
    signInEntry: 'Sign in',
    signOutFailed: 'Sign-out couldn’t finish — you’re still signed in. Try again.',
    // The other half of `signOutFailed`: `/sign-in` says it once, on a sign-out's arrival.
    signedOut: 'You’re signed out.',
    // Logged to the console by the auth pages in a production build; the body alone carries the
    // meaning, since the headline's styling reaches no screen reader.
    selfXss: {
      headline: 'Stop!',
      body: 'This console is a browser tool for developers. If someone told you to copy and paste something here, it is a scam called Self-XSS that would hand them your Quirenote account. Do not enter or paste code that you do not understand.',
    },
    pending: {
      title: 'Your application is being reviewed',
      lead: 'Access opens once it’s approved. There’s nothing else to do.',
    },
    rejected: {
      title: 'Your account is disabled',
      lead: 'Access to it is closed. To ask why, write to support@quirenote.com.',
    },
    noApplication: {
      title: 'No application for this account',
      lead: 'Sign out, then apply with the address you’ll use.',
      apply: 'Sign out and apply',
    },
    forbidden: {
      title: 'No access',
      lead: 'This account has no access to Quirenote.',
    },
    terms: {
      title: 'Accept the terms of use',
      lead: 'To open Quirenote, accept the terms it runs on.',
    },
  },
  // The privacy notice (`privacy-notice.dc.html`, brief #497); the Ukrainian prevails and this
  // says no more. A list is an array of its items; `[text](href)` is a link inside its sentence;
  // a section's title is bare, and the page numbers it.
  privacy: {
    link: 'Privacy',
    title: 'Privacy policy',
    updated: (date: string) => `Last updated: ${date}`,
    contents: 'Contents',
    back: 'Back to Quirenote',
    newTab: '(opens in a new tab)',
    intro: [
      'This page says which of your data Quirenote handles, why, who receives it, how long it is kept, and what your rights are. We handle it under Ukraine’s Law on Personal Data Protection and give all the information Article 13 of the GDPR asks for.',
      'The page is in Ukrainian and English. Where the two differ, the Ukrainian version applies.',
    ],
    sections: {
      controller: section(
        'Who is responsible for your data',
        'The controller is Roman Kushyk, a private individual in Ukraine. For any question about your data, write to support@quirenote.com; on request we also give the controller’s place of residence.',
        'We have not appointed a data protection officer: the law does not require one for this processing.',
      ),
      data: section(
        'What data we handle',
        [
          'Application: your email address, when you applied, and which version of the terms of use you accepted and when.',
          'Account: your address, role, the dates you applied and were approved, and which version of the terms of use you accepted and when. Amazon Cognito keeps your password; Quirenote does not keep it. Passkeys: Amazon Cognito keeps their ID, name, device type and creation date; the private key stays on your device.',
          'Google sign-in: Google gives Amazon Cognito your name, address and profile photo. Only the address, the mark that Google verified it, and your Google account ID are kept.',
          'Portfolio: the accounts, assets, transactions with their notes, prices and settings you enter.',
          'Technical data: the IP address and browser details received by Cloudflare, whose network the site opens through, and by Amazon Web Services, whose servers run the app and the sign-in. To check a form, the server passes your IP address to Cloudflare. The service’s logs name an account by its ID, not its address.',
          'Messages: what you write to support@quirenote.com.',
        ],
        'Your address is needed to apply: without it we cannot review the application. Everything else you enter yourself.',
      ),
      purposes: section(
        'Why, and on what basis',
        [
          'To review your application and send the invitation — steps before a contract, at your request (Law, Article 11(1)(3); GDPR Article 6(1)(b)).',
          'To sign you in, keep, compute and show your portfolio, keep a record of our agreement (which version of the terms of use you accepted and when), and answer your messages — performing the contract (the same articles).',
          'To protect the service from bots and abuse: Cloudflare’s check, logs, backups — our legitimate interest in network and information security (Law, Article 11(1)(6); GDPR Article 6(1)(f) and Recital 49).',
        ],
        'We do not ask for consent, because no processing rests on it. We send no advertising, build no profiles and make no automated decisions with legal effects on you: Cloudflare only checks that a person is sending the form, and a person reviews the application.',
      ),
      recipients: section(
        'Who receives your data',
        [
          'Amazon Web Services stores the data and sends the invitation: region eu-north-1, Stockholm, Sweden.',
          'Cloudflare, Inc. (USA): the network the site opens through, and the check on the application and sign-in forms (Turnstile). Cloudflare also uses the check’s data itself, as a separate controller, to detect bots better: [Cloudflare’s Turnstile notice](https://www.cloudflare.com/turnstile-privacy-policy/).',
          'Google LLC (USA), only if you sign in with Google.',
          'Mail to support@quirenote.com is forwarded by Cloudflare to the owner’s Gmail inbox (Google LLC).',
          'Your browser requests Inzhur’s public price list itself (the “Fetch quotes” button, or picking an Inzhur asset in the form), so Inzhur sees your IP address. We pass nothing about you to Inzhur.',
        ],
        'We pass your data to no one else, and we do not sell it.',
      ),
      transfers: section(
        'Transfers abroad',
        'Sweden is in the European Economic Area. Cloudflare, Inc. and Google LLC are certified under the EU–US Data Privacy Framework, for which the European Commission adopted an adequacy decision (2023/1795). Ukrainian law recognises adequate protection both in EEA states and in the USA (Law, Article 29).',
      ),
      retention: section('How long we keep it', [
        'An application — until it is reviewed. A declined one is deleted when it is declined.',
        'Your account and portfolio — as long as the account exists. To delete it, write to support@quirenote.com.',
        'Data removed with “Erase data” leaves the working database within 30 days.',
        'Database backups are kept 35 days, so deleted data leaves them within 35 days of leaving the working database.',
        'Service logs — 30 days. The AWS account’s event history (CloudTrail), which shows Google sign-ins with the IP address and browser details, and account actions by ID — 90 days; AWS does not let it be shortened.',
        'Correspondence — as long as your account exists; deleted with it. A message from someone with no account is deleted once it is answered.',
        'Cookies and browser entries — as in “Cookies and browser storage”.',
      ]),
      rights: section(
        'Your rights',
        'You can:',
        [
          'know which of your data we handle, where it comes from, where it is stored, why, and who receives it;',
          'get a copy: a JSON copy of your portfolio and CSV tables are in Settings, under Data, and we send your account’s data on request;',
          'correct inaccurate data;',
          'delete your data or your account;',
          'restrict processing;',
          'object to processing, including processing that rests on our legitimate interest;',
          'be protected against unlawful processing and against accidental loss, destruction or damage of your data;',
          'move your data to another service — the same copy;',
          'know how automated processing works, and be protected from automated decisions with legal effects (we make none);',
          'withdraw or limit consent, where processing rests on consent (ours does not).',
        ],
        'Write to support@quirenote.com. Within 10 working days we tell you whether we will meet the request, and we meet it within 30 calendar days, or within one month where the month is shorter.',
        'You can complain to the Ukrainian Parliament Commissioner for Human Rights ([ombudsman.gov.ua](https://ombudsman.gov.ua/), hotline 1678, hotline@ombudsman.gov.ua) or to a court. If you are in the EU or EEA, you can also complain to the supervisory authority of the state where you live or work, or where the infringement took place.',
      ),
      cookies: {
        ...section(
          'Cookies and browser storage',
          'All of them are needed for the service to work. There are no analytics or advertising cookies, so we do not ask consent for any. Cloudflare’s check sets no cookie.',
        ),
        // What each entry is for and how long it lasts; its name is the code's, beside it on the page.
        rows: {
          refresh: 'keeps you signed in · 2 hours, extended on every refresh',
          origin: 'lets a stolen sign-in be revoked · 24 hours',
          access: 'the encrypted access token · up to 1 hour',
          google: 'Google sign-in · 15 minutes',
          cognito: 'Google sign-in · 1 hour',
          settings: 'your settings on this device · until you clear them',
          draft: 'the day’s quote draft · until you sign out or the session ends',
          inzhur: 'Inzhur’s last price list · until you clear them',
          handoff:
            'carrying a sign-out and a re-authentication across a page load · until the tab closes',
        },
        cognitoName: 'Amazon Cognito’s cookie on auth.quirenote.com',
      },
      changes: section(
        'Changes',
        'The date of the last update is at the top. We announce material changes in the app before they take effect.',
      ),
    },
    firstLayer:
      'Quirenote uses your address to review your application and send the invitation, and Cloudflare checks that a person is sending the form. With your application, Quirenote records which version of the terms you accepted and when, to keep a record of the agreement with you. Who handles this data, where it is kept and your rights: the [Privacy policy](/privacy).',
  },
  // `terms-of-use.dc.html` T1 and T7 (brief #514): the Ukrainian prevails and the English says no
  // more. A section's title is bare, and the page numbers it.
  terms: {
    link: 'Terms',
    title: 'Terms of use',
    updated: (date: string) => `Last updated: ${date}`,
    intro: [
      'These terms are an agreement between you and the owner of Quirenote about using the service. You accept them whole, as a contract of adhesion (Civil Code of Ukraine, Article 634), when you press “Apply” or “Accept terms”. They start to apply to you when the application is approved, or, if you accepted them with “Accept terms”, from the moment you accepted them.',
      'The page is in Ukrainian and English. Where the two differ, the Ukrainian version applies.',
    ],
    sections: {
      operator: section(
        'Who provides the service',
        'Quirenote is provided by Roman Kushyk, a private individual in Ukraine (“we”). Write to support@quirenote.com.',
        'The service is free, and we do not provide it as a business. So these terms are not a public contract and not a public offer (Civil Code, Articles 633 and 641): we may refuse to give an account.',
      ),
      service: section(
        'What Quirenote is',
        'Quirenote is an information tool for keeping track of your own portfolio: domestic government bonds, Inzhur funds and cash in accounts. Every figure is computed from what you enter and from the data named in section 4.',
      ),
      advice: section(
        'This is not advice',
        'Quirenote gives no individual investment, tax or legal advice and forecasts no prices. Investment advice is an activity of investment firms (Law of Ukraine on Capital Markets and Organised Commodity Markets, Article 44(10)), and we do not carry it out. The hints the service shows are computed from your data and the target shares you set yourself. You make your own decisions about your investments and taxes.',
      ),
      sources: section(
        'Where the data comes from',
        [
          'The hryvnia’s rate to the dollar is the National Bank of Ukraine’s official rate, from its open data, with a link to the source.',
          'For assets linked to Inzhur, the service also uses prices and payment schedules from the archive it keeps.',
          'Your browser requests Inzhur’s price list itself, when you press “Fetch quotes” or open the choice of an Inzhur asset in the form.',
          'A price you entered yourself for a day takes precedence.',
        ],
        'We show this data as we received or computed it: it may be late, incomplete or inaccurate. We do not check what you enter yourself.',
      ),
      account: section('Your account', [
        'A declined application is deleted, and we do not give a reason.',
        'A password cannot be reset in the app. Keep your device, passkeys and password safe: whoever holds them signs in to your account.',
        'If you lose access or see a sign-in that is not yours, write to support@quirenote.com.',
      ]),
      data: section(
        'Your data',
        [
          'The data you enter is yours. We use it only to provide the service to you.',
          'A JSON copy of your portfolio and CSV tables are in Settings, under Data; the “Erase data” button there erases the portfolio.',
          'To delete your account, write to support@quirenote.com.',
          'We back up the database, but we advise you to keep a copy of your own too.',
        ],
        'How we handle personal data is set out in the [Privacy policy](/privacy).',
      ),
      use: section('What you may not do', [
        'access the service with bots or scripts, or overload it;',
        'get around Cloudflare’s check or the service’s other limits;',
        'try to reach another person’s account or data;',
        'use the service against the law.',
      ]),
      availability: section(
        'Availability and changes to the service',
        'The service is provided “as is”. We do not promise that it will run without interruptions or errors: failures and maintenance can stop it. We may change, add and remove features. If we close the service, we will announce it in the app in advance, so that you have time to save a copy of your data.',
      ),
      liability: section(
        'Liability',
        'The service is free, so our liability for losses is limited as Article 906(2) of the Civil Code sets it for free services. This limit does not apply to an intentional breach (Article 614(3) of the Code). We are not liable for a breach caused by chance or force majeure (Article 617 of the Code).',
      ),
      termination: section(
        'Ending the agreement',
        'You can stop using the service at any time and ask for your account to be deleted (section 6). We may disable or delete an account that breaches these terms; we write to you first, unless the breach threatens the service or other users. Before an account is deleted, save a copy of your data.',
      ),
      changes: section(
        'Changes to these terms',
        'The date of the last update is at the top, and it is how we record which version you accepted. We announce material changes in the app before they take effect. If you do not agree with new terms, you can stop using the service and ask for your account to be deleted (section 6).',
      ),
      law: section(
        'Law and disputes',
        'These terms are governed by the law of Ukraine. We first try to settle a dispute by correspondence; if that fails, a court of Ukraine hears it under the rules of jurisdiction.',
      ),
    },
    // `terms-of-use.dc.html` T2: directly above the button, naming it.
    accept: 'By pressing “Apply”, you accept the [Terms of use](/terms).',
    // `terms-acceptance-step.dc.html` T7: the step an account with no recorded version meets.
    step: {
      accept: 'By pressing “Accept terms”, you accept the [Terms of use](/terms).',
      submit: 'Accept terms',
      busy: 'Accepting…',
      decline: 'Decline and sign out',
      failed: 'Couldn’t accept the terms. Try again.',
      outdated:
        'The terms of use have changed. Reload the page to read them, then accept them again.',
      firstLayer:
        'Quirenote records on your account which version of the terms you accepted and when, to keep a record of the agreement with you. Who handles this data, where it is kept and your rights: the [Privacy policy](/privacy).',
    },
  },
  transaction: {
    title: 'Transaction',
    badge: 'Occasional',
    subtitle: 'Deposits, buys, accruals, reinvests — opened only when something happened.',
    date: 'Date',
    type: 'Type',
    asset: 'Asset',
    assetPlaceholder: 'Select an asset…',
    newAssetOption: '+ New asset…',
    newAssetDetails: 'New asset details',
    amount: 'Amount, ₴',
    amountPlaceholder: '10,000.00',
    // ISSUE #31. The amount field holds one of two things, and its label says
    // which — a toggle that silently changed what a number meant would be a
    // worse bug than the one it fixes.
    amountUnit: 'Per unit, ₴',
    priceTotal: 'Total amount',
    priceUnit: 'Price per unit',
    quantity: 'Units',
    quantityPlaceholder: '6,164',
    // On any `movesPosition` row, not just per-unit mode — there the count is what a
    // total is derived FROM, here it is required outright.
    quantityMissing: 'Enter the number of units.',
    quantityNotPositive: 'Units have to be a positive number.',
    // THE THIRD FAILURE, and it is not the other two: the text is not a number under
    // THIS language's grammar (*Language, numbers, fonts*), so «positive» is not what
    // is wrong with a pasted «16,5» — it is positive.
    quantityUnreadable: 'Enter a number.',
    submit: 'Record transaction',
    amountMissing: 'Enter an amount.',
    amountNotPositive: 'The amount has to be a positive number.',
    amountUnreadable: 'Enter a number.',
    // The withholding has no MISSING arm: it is optional, and the bond half of
    // this portfolio never carries one. `withholdingUnreadable` is deliberately
    // byte-identical to the two sentences above and below it — one failure, one
    // wording, which `unreadable-message.test.ts` holds.
    withholding: 'Tax withheld, ₴',
    withholdingPlaceholder: '65.44',
    withholdingNotPositive: 'The withholding has to be a positive number.',
    withholdingUnreadable: 'Enter a number.',
    withholdingAboveAmount: 'The withholding has to be smaller than the amount.',
    // THE LEDGER ROW'S OWN LINE. The withheld half arrives already signed,
    // through `signedMoney`, so this template carries no glyph of its own; the net
    // half reuses the wording `analytics.prose.netOfTax` settled. «Утримано» is
    // deliberately absent — spelled out, the row overruns on a four-figure payout.
    withheldAndNet: (withheld: string, net: string) => `${withheld} · net of tax ${net}`,
    // The chip on a row dated after today, which counts in no figure until its day; the title
    // takes the row's own date in full.
    ahead: 'Not yet counted',
    aheadTitle: (date: string) => `Counts from ${date}.`,
    note: 'Note',
    notePlaceholder: 'What this row was',
    noteTooLong: 'A note is at most 100 characters of text.',
    productTooSmall: 'The price times the count rounds to nothing — check both.',
    invalid: 'Check the highlighted fields and try again.',
    recentEmpty: 'No transactions yet.',
    // The Type select spells out "Interest payout"; the Recent rows say
    // "Coupon" for the same type, per the design copy.
    types: {
      buy: 'Buy',
      sell: 'Sell',
      deposit: 'Deposit',
      withdrawal: 'Withdrawal',
      dividend_accrual: 'Dividend accrual',
      interest_payout: 'Interest payout',
      reinvest: 'Reinvest',
      redemption: 'Redemption',
    },
    recentCoupon: 'Coupon',
    // A row with no asset — a deposit or a withdrawal belongs to the whole book.
    portfolioRow: 'Portfolio',
    recordedToast: 'Transaction recorded',
    failedToast: 'Could not record transaction — please try again.',
    // A ledger row can be removed, and the row asks before it goes — the same
    // inline shape the quote rows and the coupon card already use, rather than a
    // modal for one line.
    delete: {
      aria: 'Delete this record',
      // THE QUESTION NAMES THE RECORD, because the asking state replaces the
      // row's own label: two coupons of the same amount, or two rows for one
      // asset days apart, are otherwise indistinguishable at the moment of
      // confirming something unrecoverable.
      ask: (amount: string, date: string) => `Delete ${amount} of ${date}?`,
      confirm: 'Delete',
      cancel: 'No',
      doneToast: 'Transaction deleted',
      // Deleting a confirmed coupon takes its occurrence back too, so the toast
      // says so — the schedule moved, not only the ledger.
      couponReopenedToast: 'Transaction deleted — the coupon is due again',
      failedToast: 'Could not delete transaction — please try again.',
    },
  },
  // The screen-level edit control and the one dialog that guards it. Deliberately
  // NOT a per-page vocabulary: two screens use these words and a third would too.
  edit: {
    edit: 'Edit',
    cancel: 'Cancel',
    save: 'Save',
    done: 'Done',
    discardTitle: 'Discard changes?',
    discardBody: 'The changes on this page have not been saved. Leaving now discards them.',
    keepEditing: 'Keep editing',
    discard: 'Discard',
  },
  dailyQuotes: {
    fetch: {
      idle: 'Fetch quotes',
      loading: 'Fetching…',
      fetchedAt: (time: string) => `Fetched ${time}`,
      unlinked: 'No Inzhur-linked assets yet — link one on Portfolio.',
      otherDay: 'Inzhur prices are today’s — set the date to today to fetch.',
      feedAsOf: (date: string) => `Inzhur as of ${date}`,
      feedAt: (time: string) => `Inzhur ${time}`,
    },
    chip: {
      auto: 'auto',
      manual: 'manual',
      asOf: (date: string) => `as of ${date}`,
      suggested: 'suggested',
      accrual: 'accrual',
      fetched: (time: string) => `fetched ${time}`,
    },
    yesterdayValue: (amount: string) => `${amount} yesterday`,
    useFetched: (value: string) => `Use fetched ${value}?`,
    useCached: (value: string, date: string) => `Use ${value} (as of ${date})?`,
    useSuggested: (value: string) => `Use suggested ${value}?`,
    priceDoesNotFit: (published: string, implied: string) =>
      `Price does not fit ${published} on any day of the last two weeks — it would imply ${implied} if struck today.`,
    filled: (n: number, total: number) => `${n} of ${total} filled`,
    dateLabel: 'Date',
    saveSnapshot: 'Save snapshot',
    copyYesterday: 'Copy yesterday',
    lastSaved: (when: string) => `Last saved ${when}`,
    notSavedYet: 'Not saved yet',
    snapshotSavedToast: 'Snapshot saved',
    // Save refuses what it cannot read instead of writing an empty day (#1).
    unreadable: 'Enter a number.',
    unreadableToast: (names: string) => `Not saved — check ${names}.`,
    nothingToSave: 'Nothing to save — enter at least one quote.',
    saveFailed: 'Could not save the snapshot — please try again.',
    // A HEADING, not an inline prefix — so no trailing colon.
    yieldSinceStart: 'Yield since start',
    yieldChartLink: 'Yield chart →',
    // Names the CHANGE, never the total: the sidebar already carries the saved
    // capital, and one quantity with two values on one screen is what this block
    // exists to avoid.
    pendingChange: {
      label: 'This snapshot changes',
      none: 'Nothing entered yet',
      // NOT `filled(n, m)`: that counts rows with a valid value, this counts
      // rows whose value DIFFERS from its baseline.
      count: (n: number, total: number) => `${n} of ${total} assets`,
    },
    keepMyValue: 'Keep my value',
    dismissSuggestion: 'Dismiss suggestion',
    // What the pricing model makes of the provider's own quote.
    model: {
      stale: (days: number, atLeast: boolean, date: string) =>
        `Provider price is ${atLeast ? 'at least ' : ''}${days === 1 ? 'a day' : `${days} days`} old — it still prices to ${date}.`,
      unexplained:
        "This price matches no yield the schedule can produce — the feed's payment schedule or its price may be wrong.",
      tooCloseToMaturity: 'Too close to maturity to check the yield from the price.',
    },
    fetchFailed: "Couldn't reach Inzhur — check your connection.",
    // A linked row valued from the asset's old hand-typed total, because one of
    // its transactions carries no unit count. The row LOOKS filled, which is why
    // it needs saying — names the fix, not the fault.
    staleLedgerRows: (names: string) =>
      `Valued from an old stored unit count: ${names} — some of their transactions have no Units.`,
    negativeUnits: (names: string) =>
      `Fewer than zero units: ${names} — recorded sales exceed recorded purchases.`,
    noUnitsRecorded: (names: string) =>
      `No units recorded yet: ${names} — record a purchase with its Units to value these.`,
    useValuesFrom: (date: string) => `Use values from ${date}`,
    quoteAria: (asset: string) => `${asset} quote`,
    // The coupon-due card. `Amount, ₴` and the failure toast are the transaction
    // section's (same field, same failure), so they are not repeated here.
    coupon: {
      badge: 'Coupon due',
      heading: (name: string, amount: string) => `${name} — coupon ${amount}`,
      headingNoAmount: (name: string) => `${name} — coupon`,
      scheduled: (date: string) =>
        `Scheduled for ${date}. Confirm to record it — the amount is editable, history is never rewritten.`,
      reinvest: 'Also record a reinvest of this amount',
      reinvestHint: 'Same date, same asset — the payout then counts as reinvested, not paid out.',
      confirm: 'Record coupon',
      skip: 'Skip',
      recordedToast: 'Coupon recorded',
      recordedReinvestToast: 'Coupon + reinvest recorded',
    },
    provenance: {
      auto: 'Filled from Inzhur (units × sell price).',
      manual: 'Typed by hand — fetch never overwrites it.',
      stale: 'From the last successful fetch — Inzhur was unreachable.',
      accrual: 'Filled from coupon accrual — a suggestion you accepted.',
      ghost: 'Suggested from coupon accrual — accept or type your own.',
    },
  },
  // The app's own not-found and failure states (`boundaries.dc.html`). The two failures, a screen's
  // and the whole app's, share their words: GOV.UK's "same page for all unexpected problems".
  boundary: {
    notFound: {
      title: 'Page not found',
      lead: 'If you typed the address, check it is correct. If you pasted it, check you copied all of it.',
      home: 'Go to Daily quotes',
    },
    failed: {
      title: 'This page couldn’t be shown',
      lead: 'Reload the page to try again. Reloading won’t delete your data.',
      reload: 'Reload the page',
    },
  },
  screen: {
    transactions: {
      title: 'Transactions',
      subtitle: 'Record a purchase, sale, coupon or dividend.',
    },
    dailyQuotes: {
      title: 'Daily quotes',
      subtitle: 'The everyday ritual — nothing else competes with it.',
    },
    overview: {
      title: 'Overview',
      // The rate is under the capital card, not here (rate-attribution.dc.html).
      subtitle: (date: string) => `Portfolio at a glance · ${date}`,
    },
    balances: {
      title: 'Balances',
      subtitle: 'Total capital by daily snapshot',
    },
    payouts: {
      title: 'Payouts',
      subtitle: 'Dividends and coupons received, by month',
    },
    yield: {
      title: 'Yield',
      subtitle: 'Cumulative return per asset since first purchase, %',
    },
    attributes: {
      title: 'Attributes',
      subtitle: 'Reference data per asset — created with a transaction, edited on Portfolio',
    },
    seasonality: {
      title: 'Seasonality',
      subtitle: 'When money actually arrives — income by day of month',
    },
    portfolio: {
      title: 'Portfolio',
      subtitle: 'Positions, cost basis and result per asset',
    },
    allocation: {
      title: 'Allocation',
      subtitle: 'Current mix vs your targets — edit them here',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Preferences, data and automation',
    },
    archive: {
      back: 'Settings',
      title: 'Price archive',
      subtitle: 'Quote coverage, archive repairs and the run log',
    },
  },
};

export type Dict = typeof en;

export const uk: Dict = {
  nav: {
    groupEntry: 'Ввід',
    groupAnalytics: 'Аналітика',
    dailyQuotes: 'Щоденні котирування', // ✎
    transactions: 'Транзакції',
    overview: 'Огляд', // ✎
    balances: 'Баланси', // ✎
    payouts: 'Виплати', // ✎
    yield: 'Дохідність', // ✎
    attributes: 'Атрибути', // ✎
    seasonality: 'Сезонність', // ✎
    portfolio: 'Портфель', // ✎
    allocation: 'Розподіл', // ✎
    settings: 'Налаштування', // ✎
    navigation: 'Навігація', // ✎
    openNav: 'Відкрити навігацію', // ✎
    closeNav: 'Закрити навігацію', // ✎
    collapseNav: 'Згорнути навігацію', // ✎
    expandNav: 'Розгорнути навігацію',
    currencyShown: (code: string) => `Валюта: ${code}`,
    // «Згорнути Аналітика» is the nominative sitting in an accusative slot.
    // Naming the GROUP first keeps the case on a word this template owns, so
    // the splice stays nominative and no per-group form is needed — the same
    // trap `dates.monthIn` solves for months.
    collapseGroup: (group: string) => `Згорнути групу «${group}»`,
    expandGroup: (group: string) => `Розгорнути групу «${group}»`,
  },
  sidebar: {
    totalCapital: 'Загальний капітал', // ✎
  },
  toast: {
    close: 'Закрити сповіщення',
  },
  csv: {
    title: 'Експорт для таблиць (CSV)',
    helper:
      'По файлу на таблицю, готові для табличного редактора. Зрізи експортуються широко — рядок на дату, стовпець на актив; порожня клітинка означає, що котирування того дня не збережено, а не нуль.',
    formatNote:
      'Машинний формат: крапка в дробах, кома як роздільник, UTF-8, CRLF. Власне форматування застосунку у файл не потрапляє.',
    columnNote:
      'Стовпці зрізів названо «Назва активу (id)» — id у дужках однозначно називає актив, коли два фонди мають однакову назву.',
    failed: 'Не вдалося сформувати CSV — спробуйте ще раз.',
    assets: 'Активи',
    snapshots: 'Зрізи',
    transactions: 'Транзакції',
  },
  importing: {
    row: {
      title: 'Імпорт',
      helper:
        'Відновлення з резервної копії JSON. Імпорт замінює все — спершу ви переглядаєте підсумок, а страхувальна копія завантажується автоматично.',
      dropLine: 'Перетягніть сюди файл .json',
      dropHint: 'або скористайтеся «Обрати файл…»',
      dragLine: 'Відпустіть, щоб прочитати файл',
      choose: 'Обрати файл…',
      reading: (name: string) => `Читання ${name}…`,
    },
    fileRejection: {
      type: 'Такий тип файлу не підтримується — оберіть копію .json.',
      size: 'Файл більший за 25 МБ — на експорт Quirenote це не схоже.',
      count: 'Перетягуйте по одному файлу.',
      empty: 'Файл порожній.',
    },
    formatRejection: {
      notJson: 'Це не коректний JSON.',
      notABackup: 'Це не копія Quirenote — у ній немає позначки «quirenote-backup».',
      newerFormat: (version: string) =>
        `Цю копію створила новіша версія застосунку (формат ${version}). Оновіть застосунок або експортуйте знову з тієї версії, що її створила.`,
      olderFormat: (version: string) =>
        `Цю копію створила старіша версія застосунку (формат ${version}). Імпортувати її вже не можна.`,
      unsupportedFormat: 'Версію формату цієї копії застосунок прочитати не може.',
    },
    issue: {
      unknownAssetId: (value: string) => `невідомий ідентифікатор активу «${value}»`,
      unknownQuoteAsset: (value: string) => `котирування невідомого активу «${value}»`,
      duplicateId: (value: string) =>
        `дубльований ідентифікатор «${value}» (ідентифікатор — первинний ключ)`,
      duplicatePrice: (value: string) =>
        `друга ціна активу «${value}» за цей день (одна на актив і день)`,
      unknownKey: (value: string) => `неочікуване поле «${value}»`,
      forbiddenKey: (value: string) => `заборонений ключ «${value}»`,
      expectedDatetime: 'очікується справжня мітка часу yyyy-MM-ddTHH:mm:ss без часового поясу',
      expectedDate: 'очікується справжня дата yyyy-MM-dd',
      expectedPositiveAmount: 'очікується додатне число',
      unitsOnNonPositionRow: 'одиниці має лише купівля, продаж, реінвест або погашення',
      unitsMissingOnPositionRow: 'купівля, продаж, реінвест і погашення мають вказувати одиниці',
      // SUBJECT FIRST HERE, unlike its siblings. They disambiguate by NUMBER —
      // plural «одиниці» against singular «має» forces the trailing noun to be
      // the subject — and this pair is singular on both sides, so Ukrainian's
      // default order would read «актив» as the subject and inverts the meaning.
      assetMissingOnAssetRow: 'лише поповнення або виведення може не вказувати актив',
      // SUBJECT FIRST — and the first attempt swapped the NOUN and left the
      // order, which changed nothing: «податок» is masculine INANIMATE, so its
      // nominative and accusative are identical exactly as the neuter
      // «утримання» it replaced. The object-first shape still parsed as "the
      // withheld tax has a dividend accrual" all the way to «виплата», the one
      // feminine nominative that forces the reader back. Number cannot
      // disambiguate here the way it does for «одиниці», so order must.
      withholdingOnNonPayoutRow:
        'лише нарахування дивідендів або виплата відсотків має утриманий податок',
      withholdingAboveAmount: 'утриманий податок має бути меншим за виплату, з якої його стягнули',
      noteLength: 'нотатка — від 1 до 100 символів тексту',
      invalid: 'некоректне значення',
    },
    problemCount: (total: number, shown: number) => {
      const found = `${total} ${plural(total, 'проблема', 'проблеми', 'проблем')}`;
      return shown < total ? `${found} — показано перші ${shown}` : found;
    },
    report: {
      title: 'Цей файл неможливо імпортувати',
      lead: 'Нічого не змінено. Виправте файл і спробуйте ще раз.',
      hint: 'Рядки перевіряються до будь-якого запису — один хибний рядок зупиняє весь імпорт.',
      close: 'Закрити',
      another: 'Обрати інший файл…',
    },
    preview: {
      title: 'Імпорт',
      banner:
        'Замінює все у вашому портфелі. Кожен актив, зріз і транзакцію буде видалено й відтворено з цього файлу. Скасувати це неможливо.',
      diffLabel: 'Що зміниться',
      colTable: 'Таблиця',
      colAdded: 'Додано',
      colReplaced: 'Замінено',
      colRemoved: 'Вилучено',
      rowAssets: 'Активи',
      rowSnapshots: 'Зрізи',
      rowTransactions: 'Транзакції',
      warningsLabel: 'Перевірте, перш ніж продовжити',
      settingsOptIn: 'Також застосувати налаштування, збережені у файлі',
      noSettings: 'Файл не містить налаштувань.',
      cancel: 'Скасувати',
      confirm: 'Замінити всі дані',
      pending: 'Заміна…',
    },
    count: {
      assets: (n: number) => `${n} ${plural(n, 'актив', 'активи', 'активів')}`,
      snapshots: (n: number) => `${n} ${plural(n, 'зріз', 'зрізи', 'зрізів')}`,
      transactions: (n: number) => `${n} ${plural(n, 'транзакція', 'транзакції', 'транзакцій')}`,
    },
    fileSubline: (name: string, date: string, time: string) =>
      `${name} · експортовано ${date} ${time}`,
    resultLine: (assets: string, snapshots: string, transactions: string) =>
      `Після імпорту: ${assets} · ${snapshots} · ${transactions}.`,
    settingsOptInHelper: (symbol: string) =>
      `Замінює вашу валюту за замовчуванням (${symbol}). Автоматизація та налаштування нагадувань лишаються недоторканими.`,
    safetyBackupDone: (name: string) => `Страхувальну копію завантажено — ${name}.json.`,
    safetyBackupPending: (name: string) =>
      `Копія ваших поточних даних завантажиться автоматично, перш ніж щось буде замінено — ${name}.json.`,
    warning: {
      // Ukrainian joins with «і» and needs no verb agreement here: «немає»
      // governs the genitive and reads the same for one row or many, so this
      // sentence carries no singular/plural branch at all.
      rowsRemoved: (parts: string[]) => {
        const subject =
          parts.length > 1 ? `${parts.slice(0, -1).join(', ')} і ${parts.at(-1)}` : parts[0];
        return `${subject} немає в цьому файлі — їх буде вилучено.`;
      },
      noAssets: 'У файлі немає активів — після імпорту портфель буде порожній.',
      noSnapshots: (current: number) =>
        `У файлі немає зрізів — усі ${current} ${plural(current, 'збережений день', 'збережені дні', 'збережених днів')} буде вилучено.`,
      exportedLongAgo: (days: number, date: string) =>
        `Експортовано ${days} ${plural(days, 'день', 'дні', 'днів')} тому (${date}).`,
      dataMoved:
        'Дані змінилися, поки діалог був відкритий. Підсумок вище оновлено — перевірте його й підтвердьте ще раз.',
    },
    toast: {
      success: (assets: string, snapshots: string, transactions: string) =>
        `Дані імпортовано — ${assets}, ${snapshots}, ${transactions}.`,
      failed: 'Не вдалося імпортувати — нічого не змінено.',
      safetyFailed: 'Не вдалося створити страхувальну копію — нічого не імпортовано.',
    },
  },
  asset: {
    yieldLong: {
      div_cap: 'див + кап',
      capitalization: 'капіталізація',
      fixed_coupon: 'фіксований купон',
      dividends: 'дивіденди',
    },
    yieldShort: {
      div_cap: 'див + кап',
      capitalization: 'кап',
      fixed_coupon: 'купон',
      dividends: 'дивіденди',
    },
    yieldOption: {
      fixed_coupon: 'Фіксований купон',
      dividends: 'Дивіденди',
      capitalization: 'Капіталізація',
      div_cap: 'Дивіденди + капіталізація',
    },
    schedule: {
      maturity: 'При погашенні',
      monthly: 'Щомісяця',
      quarterly: 'Щокварталу',
      semiannual: 'Раз на півроку',
      none: 'Немає (лише ціна)',
    },
    couponFrequency: {
      maturity: 'при погашенні',
      monthly: 'щомісяця',
      quarterly: 'щокварталу',
      semiannual: 'раз на півроку',
      none: '',
    },
    field: {
      name: 'Назва',
      code: 'Код',
      expectedPct: 'Очікувано, %',
      targetPct: 'Цільова частка, %',
      yieldType: 'Тип дохідності',
      payoutSchedule: 'Графік виплат',
      firstPurchase: 'Перша купівля',
      maturity: 'Погашення',
      nextCoupon: 'Наступний купон',
      couponRatePct: 'Ставка купона, %',
      linkToInzhur: 'Прив’язати до Inzhur',
      fixedCouponGroup: 'Фіксований купон',
    },
    message: {
      name: 'Назва обов’язкова.',
      code: 'Код — 1–2 літери.',
      expectedPct: 'Введіть відсоток.',
      targetPct: 'Введіть відсоток.',
      couponRatePct: 'Введіть ставку купона.',
      firstPurchase: 'Оберіть дату.',
      maturity: 'Оберіть дату.',
      nextCoupon: 'Оберіть дату.',
      refFund: 'Введіть ідентифікатор фонду.',
      refBond: 'Введіть ISIN ОВДП.',
      summary: 'Перевірте підсвічені поля та спробуйте ще раз.',
    },
    placeholder: {
      name: 'ОВДП UA4000241234',
      expectedPct: '16,5',
      targetPct: '10',
      couponRatePct: '15,68',
      maturity: '25.02.2027',
      nextCoupon: '25.08.2026',
    },
    picker: {
      placeholder: 'Обрати з Inzhur…',
      loading: 'Завантаження активів Inzhur…',
      failed: 'Не вдалося завантажити список — введіть вручну.',
      empty: 'Нічого такого виду в стрічці — введіть вручну.',
      toManual: 'Ввести вручну',
      toPicker: 'Обрати зі списку',
      helper:
        'Прив’язані активи оцінюються як одиниці × отримана ціна продажу. Одиниці беруться з транзакцій — вказуйте кількість при купівлі.',
      fund: 'Фонд',
      bond: 'ОВДП',
      fundManual: 'Ідентифікатор фонду',
      bondManual: 'ISIN ОВДП',
      matures: (date: string) => `погашення ${date}`,
    },
  },
  parse: {
    reason: {
      not_an_array: 'відповідь не була списком активів',
      shape: 'нечитабельні поля',
      no_ref: 'немає ISIN чи слаґа, щоб упізнати запис',
    },
    allClean: (entries: number, at: string) =>
      `Усі ${entries} ${plural(entries, 'запис', 'записи', 'записів')} стрічки прочитано чисто · ${at}`,
    failed: (count: number) =>
      `${count} ${plural(count, 'запис', 'записи', 'записів')} стрічки не вдалося прочитати`,
    readFine: (entries: number) => `${entries} прочитано нормально`,
    hide: 'сховати',
    show: 'показати',
  },
  sync: {
    staleWrite:
      'Це змінилося в іншій вкладці чи на іншому пристрої, тож нічого не збережено. Екран показує актуальні дані — перевірте їх і спробуйте ще раз.',
  },
  loading: { status: 'Завантаження портфеля…' },
  reminders: {
    quoteMissing: 'Котирувань сьогодні ще не збережено.',
    coupon: (asset: string, when: string, date: string) =>
      `${asset} платить купон ${when} (${date}).`,
    couponOverdue: (asset: string, date: string) =>
      `Купон ${asset} мав бути ${date} — запишіть його на екрані котирувань.`,
    maturesToday: (asset: string, date: string) => `${asset} погашається сьогодні (${date}).`,
    matures: (asset: string, when: string, date: string) =>
      `${asset} погашається ${when} (${date}).`,
    // Three forms, and 2-4 take «дні»: a count spliced into one shared string gives
    // «2 днів».
    inDays: (days: number) => `через ${days} ${plural(days, 'день', 'дні', 'днів')}`,
    moreReminders: (hidden: number) =>
      `+${hidden} ${plural(hidden, 'нагадування', 'нагадування', 'нагадувань')}`,
    enterQuotes: 'Ввести котирування →',
    openDailyQuotes: 'Відкрити котирування →',
    dismiss: 'Відхилити нагадування',
    andMore: (rest: number) => ` · +${rest}`,
  },
  dates: {
    monthShort: [
      'січ',
      'лют',
      'бер',
      'кві',
      'тра',
      'чер',
      'лип',
      'сер',
      'вер',
      'жов',
      'лис',
      'гру',
    ],
    monthFull: [
      'січень',
      'лютий',
      'березень',
      'квітень',
      'травень',
      'червень',
      'липень',
      'серпень',
      'вересень',
      'жовтень',
      'листопад',
      'грудень',
    ],
    listAnd: ' і ',
    pick: 'Оберіть дату',
    selected: (date: string) => `Дата: ${date}`,
    pickMonth: 'Виберіть місяць',
    pickYear: 'Виберіть рік',
    prevYears: 'Попередні роки',
    nextYears: 'Наступні роки',
    monthIn: [
      'січня',
      'лютого',
      'березня',
      'квітня',
      'травня',
      'червня',
      'липня',
      'серпня',
      'вересня',
      'жовтня',
      'листопада',
      'грудня',
    ],
    dayOfMonth: (n: number) => `${n}-го`,
  },
  period: {
    ariaLabel: 'Період',
    portfolioXirr: (rate: string) => `XIRR портфеля ${rate}`,
    portfolioXirrAnn: (rate: string) => `XIRR портфеля ${rate} (річн.)`,
    all: 'Від початку',
    '1m': '1 місяць',
    '3m': '3 місяці',
    '6m': '6 місяців',
    '12m': '12 місяців',
    ytd: 'Від початку року',
    clamped: 'Уся історія — коротша за обраний період.',
    clampedHint: 'уся історія',
  },
  analytics: {
    asset: 'Актив',
    invested: 'Вкладено, ₴',
    valueNow: 'Вартість зараз, ₴',
    deltaTotal: 'Δ загалом',
    annualized: 'Річна',
    totalReturn: 'Загальна дохідність',
    vsExpected: 'проти очікуваної',
    yieldType: 'Тип дохідності',
    capitalGainUah: 'Приріст капіталу, ₴',
    capitalGainPct: 'Приріст капіталу, %',
    ofItReinvested: 'з них реінвестовано',
    perYear: '/ рік',
    ppSuffix: ' в.п.',
    share: 'Частка',
    notComputable: 'не обчислюється',
    cashShort: 'Вільні кошти нижче нуля',
    cashShortDetail:
      'Вільні кошти нижче нуля або не читаються — перевірте, чи не бракує поповнення і чи не перевищує виведення баланс.',
    snapshot: 'Зріз',
    cash: 'Готівка',
    totalUah: 'Разом, ₴',
    prev: 'Назад',
    next: 'Далі',
    date: 'Дата',
    type: 'Тип',
    amountUah: 'Сума, ₴',
    withheldUah: 'Утримано, ₴',
    netOfTaxUah: 'Після податку, ₴',
    destination: 'Призначення',
    dividends: 'Дивіденди',
    coupons: 'Купони',
    upcoming: 'Найближчі',
    noUpcoming: 'Найближчих виплат немає.',
    receivedTotal: 'Отримано загалом',
    reinvested: 'Реінвестовано',
    overview: {
      assets: 'Активи',
      nextPayouts: 'Найближчі виплати',
      rebalanceHint: 'Підказка ребалансу',
      onTarget: 'Розподіл відповідає цілям.',
      openAllocation: 'Відкрити розподіл →',
      incomeReceived: 'Отриманий дохід',
      totalCapital: 'Загальний капітал',
      capitalGain: 'Приріст капіталу',
      totalReturnNet: 'Загальна дохідність (чиста)',
      depositedReinvested: 'Поповнено / Реінвестовано',
      freeCash: 'Вільні кошти',
    },
    portfolio: {
      bestPerformer: 'Найкращий',
      dividendsWord: 'дивідендів',
      couponsWord: 'купонів',
      laggard: 'Відстаючий',
      incomeEngine: 'Джерело доходу',
      noQuotes: 'Котирувань ще немає.',
      autoReinvested: ' · авто-реінвестиція',
    },
    seasonality: {
      incomeAnchor: 'Якір доходу',
      couponSeason: 'Купонний сезон',
      quietStretch: 'Тиха смуга',
      axisByDay: 'За днями',
      axisByMonth: 'За місяцями',
      axisAriaLabel: 'Вісь графіка',
      received: 'Отримано',
      expected: 'Очікувано',
      anchorDay: (day: number) => `День ${day}`,
      dayShort: (day: number) => `день ${day}`,
      anchorRest: (asset: string, frequency: string, first: string, last: string) =>
        ` — це зарплата: дивіденди ${asset} надходять ${frequency}, ${first} → ${last} і зростають.`,
      anchorEmpty: 'Регулярних надходжень ще немає.',
      // Ukrainian writes month names in lowercase — but this one opens the
      // sentence, so the card capitalises it here rather than storing a
      // second, capitalised month list.
      couponMonths: (months: string, day: number) =>
        `${months.charAt(0).toUpperCase()}${months.slice(1)} (день ${day})`,
      couponRest: (asset: string, count: number) =>
        `${count === 1 ? ' несе' : ' несуть'} великі купони ${asset}`,
      couponOther: (asset: string, when: string, month: string) =>
        `; ${asset} платить ${when} ${month}`,
      couponEmpty: 'Купонів по ОВДП ще немає.',
      quietDays: (from: number, to: number) => `Дні ${from}–${to}`,
      quietRest: ' майже без грошових подій — добре вікно для докупівель під ребаланс.',
      quietEmpty: 'Дохід рівномірно розподілений протягом місяця.',
      frequency: {
        monthly: 'щомісяця',
        quarterly: 'щокварталу',
        semiannual: 'двічі на рік',
        maturity: 'при погашенні',
        none: '',
      },
      // Prepositional phrases, so they take the genitive month from
      // dates.monthIn — "на початку червня", not "на початку червень".
      dayPart: { early: 'на початку', mid: 'у середині', late: 'наприкінці' },
    },
    allocation: {
      currentVsTarget: 'Поточне проти цілі',
      rebalancePlan: 'План ребалансу',
      buy: 'Купити',
      trim: 'Зменшити',
      withinRange: 'у межах ±0,5 % — без дій',
      centerTotal: (thousands: number) => `${thousands} тис. ₴`,
      assetsPlusCash: (n: number) => `${n} ${plural(n, 'актив', 'активи', 'активів')} + готівка`,
    },
    yield: {
      xirr: 'XIRR',
      xirrAnn: 'XIRR (річн.)',
    },
    balances: {
      pending: 'очікується',
      notHeldQuote:
        'Котирування збережене на день, коли за транзакціями одиниць цього активу не було: показане, але не враховане в сумі рядка.',
    },
    attributes: {
      ytmAtPurchase: 'YTM на купівлі',
      coupon: 'Купон',
      maturity: 'Погашення',
      targetShare: 'Цільова частка',
      firstPurchase: 'Перша купівля',
      nextCoupon: 'Наступний купон',
      expectedReturn: 'Очікувана дохідність',
      actualAnn: 'Фактична (річна)',
      payoutSchedule: 'Графік виплат',
    },
    prose: {
      totalPlusCash: (cash: string) => `Разом + готівка ${cash}`,
      ytmDerived: (stored: string) =>
        `Виведено з ціни, яку ви заплатили. Збережена очікувана дохідність — ${stored}, і саме з нею порівнює «Дохідність».`,
      capitalGainNote:
        'Приріст капіталу = вартість + надходження від продажів і погашень − вкладено (з реінвестованими виплатами). Дохід від виплат враховується в загальній дохідності на екрані «Дохідність».',
      inWeeks: (pct: string, weeks: number) => `${pct} за ${weeks} тиж.`,
      watchVsExpected: (pct: string, expected: string) => `${pct} · проти очікуваних ${expected}`,
      ofReceivedIncome: (pct: string) => `${pct} отриманого доходу`,
      reinvestedInto: (amount: string) => `реінвестовано (${amount})`,
      toAccount: 'на рахунок',
      ofAccount: (pct: string) => `${pct} від рахунку`,
      nbu: 'НБУ',
      rateLine: (rate: string, date: string) => `\u00A0${rate} на\u00A0${date}`,
      rateNone: ' — курс недоступний',
      nbuLabel: 'НБУ, відкриті дані',
      plusReinvested: (amount: string) => `+ ${amount} реінвестовано`,
      sinceDate: (pct: string, date: string) => `${pct} від ${date}`,
      onNetDeposits: (pct: string) => `${pct} на чисті поповнення`,
      couponOf: (asset: string) => `Купон ${asset}`,
      dividendOf: (asset: string) => `Дивіденд ${asset}`,
      dividendTag: 'дивіденд',
      couponTag: 'купон',
      dividendsAndCoupons: (dividends: string, coupons: string) =>
        `${dividends} дивідендів · ${coupons} купонів`,
      dividendsCouponsSplit: (dividends: string, coupons: string) =>
        `дивіденди ${dividends} · купони ${coupons}`,
      showingSnapshots: (shown: number, total: number, since: string) =>
        `Показано останні ${shown} ${plural(shown, 'зріз', 'зрізи', 'зрізів')} · усього ${total} від ${since}`,
      netOfTax: (amount: string) => `після податку ${amount}`,
      seasonalityNote:
        '* очікувано — спрогнозовано за датою наступного купона активу. Сірі стовпчики — дні без доходу У ВИБРАНОМУ ПЕРІОДІ.',
      yieldNote: (start: string) =>
        `Річна = загальна Δ, приведена до 365 днів від ${start}. Купони враховуються в Δ за нарахуванням. Загальна дохідність — чиста від податків і включає виплати. XIRR зважений за грошима та річний — за історії менш ніж рік вважайте його екстраполяцією.`,
      shortBasisNote:
        'Сірим — річна поділена на строк, з якого актив прожив менше за 90 %, тож ставка занижена.',
      rebalanceIs: 'на',
      underTarget: (target: string) => `нижче за ціль ${target} — поповнити на`,
    },
    empty: {
      chart: 'Зрізів ще немає — збережіть перше щоденне котирування, щоб побудувати графік.',
      table: 'Зрізів ще немає — збережіть перше щоденне котирування, щоб заповнити таблицю.',
      rebalance:
        'Зрізів ще немає — збережіть перше щоденне котирування, щоб побачити підказку ребалансу.',
      allocation:
        'Зрізів ще немає — збережіть перше щоденне котирування, щоб побачити структуру розподілу.',
    },
  },
  assets: {
    edit: 'Змінити',
    delete: 'Видалити',
    editAria: (asset: string) => `Змінити ${asset}`,
    deleteAria: (asset: string) => `Видалити ${asset}`,
    actionsHeader: 'Дії',
    add: 'Додати актив',
    empty: 'Активів ще немає — додайте перший, щоб почати облік.',
    deleteTitle: (name: string) => `Видалити ${name}?`,
    deleteBody: (transactions: number, quoteDays: number) =>
      `Це видалить актив і все, що для нього записано, — ${transactions} ${plural(transactions, 'транзакцію', 'транзакції', 'транзакцій')} і котирування за ${quoteDays} ${plural(quoteDays, 'день', 'дні', 'днів')}. Це не можна скасувати.`,
    deleteAction: 'Видалити актив',
    editTitle: 'Редагувати актив',
    saveChanges: 'Зберегти зміни',
    cancel: 'Скасувати',
    addedToast: 'Актив додано',
    updatedToast: 'Актив оновлено',
    deletedToast: 'Актив видалено',
    saveFailed: 'Не вдалося зберегти актив — спробуйте ще раз.',
    deleteFailed: 'Не вдалося виконати — нічого не видалено.',
  },
  targets: {
    title: 'Цілі',
    savedToast: 'Цілі збережено',
    saveFailed: 'Не вдалося зберегти цілі — спробуйте ще раз.',
    invalid: 'Введіть відсоток.',
    fieldAria: (asset: string) => `Ціль ${asset}, %`,
    sumOk: (sum: string) => `Σ ${sum}`,
    sumOff: (sum: string) => `Σ ${sum} — цілі не дають у сумі 100 %`,
  },
  danger: {
    typeToConfirm: (word: string) => `Введіть ${word} для підтвердження`,
    backupFirst: 'Спершу завантажте копію',
    backupDone: 'Копію завантажено ✓',
    failed: 'Не вдалося виконати — нічого не видалено.',
    trigger: 'Стерти дані…',
    title: 'Стерти дані?',
    body: 'Це назавжди видалить кожен актив, зріз і транзакцію. Незбережений чернетковий ввід котирувань також очищується — налаштування лишаються. Скасувати це неможливо.',
    action: 'Стерти дані',
    success: 'Дані стерто',
  },
  settings: {
    sections: {
      data: 'Дані',
      automation: 'Автоматизація',
      appearance: 'Вигляд',
      admin: 'Адміністрування',
    },
    theme: {
      title: 'Тема', // ✎
      helper: 'Системна стежить за налаштуванням пристрою.', // ✎
      ariaLabel: 'Тема оформлення', // ✎
      light: 'Світла', // ✎
      dark: 'Темна', // ✎
      system: 'Системна', // ✎
    },
    currency: {
      title: 'Валюта',
      helper:
        'Валюта, з якою відкривається застосунок. Перемикач у бічній панелі лише показує іншу, не зберігаючи вибір.',
    },
    language: {
      title: 'Мова', // ✎
      helper: 'Змінює текст, формат чисел і дат.', // ✎
      ariaLabel: 'Мова інтерфейсу', // ✎
      uk: 'Українська', // ✎
      en: 'English', // ✎
    },
    backup: {
      title: 'Резервна копія',
      helper:
        'Повна копія в JSON — quirenote-backup-<дата>.json. Відновлюється через Імпорт нижче.',
      button: 'Завантажити копію',
      failedToast: 'Не вдалося створити копію — спробуйте ще раз.',
      unreadableToast: (issue: string) =>
        `Копію не збережено: ця збірка не може прочитати щойно створений нею файл (${issue}).`,
    },
    dangerZone: {
      title: 'Небезпечна зона',
      helper: 'Дія просить підтвердження вводом і спершу пропонує резервну копію.',
    },
    quoteSuggest: {
      title: 'Пропозиції котирувань',
      helper:
        'Попередньо заповнює притлумлені значення для некотированих активів із фіксованим купоном за нарахуванням. Пропозиції лишаються притлумленими, доки їх не прийнято.',
    },
    couponSuggest: {
      title: 'Пропозиції купонів',
      helper:
        'Пропонує запис одним дотиком, коли настає дата купона. Кожен запис підтверджується вручну — суми лишаються редаговними.',
    },
    reminders: {
      title: 'Нагадування',
      helper:
        'Банери в застосунку про пропущені котирування, найближчі та прострочені купони й погашення. Нічого не залишає застосунок.',
      leadTitle: 'Завчасність, днів',
      leadHelper: 'За скільки днів наперед з’являються нагадування про купони.',
      leadAriaLabel: 'Завчасність нагадувань, днів',
      leadInvalid: 'Введіть від 1 до 30 днів.',
      dismissedTitle: 'Відхилені нагадування',
      dismissedHelper: 'Відхилені банери лишаються прихованими, доки не мине їхня дата.',
      restore: 'Повернути відхилені',
      restoreWithCount: (count: number) => `Повернути відхилені (${count})`,
      restoredToast: 'Відхилені нагадування повернуто',
    },
    parse: {
      title: 'Останній розбір стрічки',
      helper:
        'Що останнє отримання з Inzhur змогло і не змогло прочитати. Записи, які не вдалося прочитати, пропускаються, а не вгадуються — решта стрічки завантажується.',
    },
    archive: {
      title: 'Архів цін',
      helper:
        'Покриття котирувань за джерелами, два ремонти архіву й журнал запусків. Цю картку бачить лише суперадміністратор.',
      open: 'Відкрити',
    },
  },
  archive: {
    read: {
      stamp: (at) => `Знімок ${at}`,
      reading: 'Читаємо архів…',
      refresh: 'Оновити',
      refreshing: 'Оновлюємо',
      refreshingAt: (at) => `Знімок ${at} · оновлюємо…`,
      refreshFailed: (at) => `Знімок ${at} · оновити не вдалося:`,
      failed: 'Не вдалося прочитати архів',
      capture_failed: 'Захоплення відповіло помилкою.',
      capture_timeout: 'Архів не відповів за 25 с; читання ще може тривати.',
      status: (n) => `Відповідь HTTP ${n}.`,
      offline: 'Сервер не відповів.',
      retry: 'Спробувати ще раз',
      unread: 'Архів ще не прочитано',
      unreadLead:
        'Діагностика читає весь архів і триває до 25 с, тому запускається лише на вашу вимогу.',
      start: 'Прочитати архів',
      starting: 'Читаємо',
    },
    source: { inzhur: 'Inzhur · котирування й NAV', nbu_fv: 'НБУ · справедлива вартість' },
    kpi: {
      empty: (n, shown) => `${shown} ${plural(n, 'день', 'дні', 'днів')}`,
      emptySub: (k, m, u) =>
        `порожніх днів · у ${k} з ${m} ${plural(m, 'групи', 'груп', 'груп')} · ${u} не виміряно`,
      noEmpty: 'порожніх днів немає',
      gaps: 'Опубліковано мінус записано (gaps)',
      size: 'Захоплень · обсяг',
    },
    coverage: {
      title: (source) => `Покриття · ${source}`,
      span: (from, n) => `${from} — сьогодні · груп: ${n}`,
      captured: 'Захоплено',
      imported: 'Імпортована історія',
      empty: 'Порожній день',
      unserved: 'Дати не надано',
      today: 'сьогодні',
      notMeasured: 'не виміряно',
      cut: (n, shown, date) =>
        `ще ${shown} ${plural(n, 'порожній день', 'порожні дні', 'порожніх днів')} до ${date} — дати не надано`,
    },
    spot: {
      title: 'Останні рядки',
      total: (rows, size) => `Збережені захоплення: ${rows} · ${size}`,
      date: 'Дата',
      instrument: 'Інструмент',
      basis: 'База',
      price: 'Ціна',
      ytm: 'YTM',
      clean: 'Чиста ціна',
      line: (price, ytm, clean) => `Ціна ${price} · YTM ${ytm} · Чиста ${clean}`,
    },
    repairs: {
      title: 'Ремонт',
      start: 'Запустити…',
      observe: {
        title: 'Дозаписати спостереження',
        helper:
          'Перечитує збережені захоплення джерела за діапазон і дописує спостереження, яких бракує; день без захоплення так не заповнити. Довгий діапазон може завершитися частково — журнал покаже, звідки продовжити.',
        source: 'Джерело',
        from: 'Від',
        to: 'До',
        sources: { inzhur: 'Inzhur', nbu_fv: 'НБУ' },
      },
      import: {
        title: 'Імпортувати історію фондів',
        helper:
          'Завантажує опубліковану провайдером історію NAV фонду і дописує дні, яких в архіві ще немає.',
        funds: 'Фонди',
        names: { 'inzhur-reit': 'Inzhur REIT', 'inzhur-energy': 'Inzhur Energy' },
      },
      confirm: {
        observe: 'Запустити дозапис?',
        import: 'Запустити імпорт?',
        body: 'Запуск буде надіслано серверу з цими параметрами.',
        operation: 'Операція',
        days: 'Днів у діапазоні',
        ops: { observe: 'Дозапис спостережень', importFundHistory: 'Імпорт історії фондів' },
        cancel: 'Скасувати',
        start: 'Запустити',
      },
      refused: {
        prodOnly:
          'Запуск тут вимкнено: ремонти виконує лише продакшн. Діагностика й журнал працюють.',
        field: {
          'to.custom': 'Кінець раніше за початок.',
          invalid_format: 'Потрібна календарна дата.',
          invalid_type: 'Поле обов’язкове.',
          'source.invalid_value': 'Невідоме джерело.',
          'refs.too_small': 'Оберіть хоча б один фонд.',
          'refs.custom': 'Фонд вказано двічі.',
          'refsN.invalid_value': 'Невідомий фонд.',
        },
        other: (field, code) => `Сервер відхилив запуск: ${field} — ${code}.`,
        startFailed:
          'Сервер не зміг запустити. Якщо запуск записано, журнал покаже його як невдалий.',
        network: 'Сервер не відповів. Запуск міг дійти — перевірте журнал, перш ніж повторювати.',
        throttled: 'Забагато запусків поспіль. Спробуйте за мить.',
        internal:
          'Сервер не прийняв запуск. Спробуйте ще раз; якщо його все ж записано, він з’явиться в журналі.',
      },
    },
    runs: {
      title: 'Журнал запусків',
      order: 'новіші вгорі',
      columns: {
        state: 'Стан',
        operation: 'Операція',
        started: 'Почато',
        by: 'Запустив',
        result: 'Результат',
      },
      state: {
        pending: 'Надсилається',
        running: 'Виконується',
        succeeded: 'Готово',
        failed: 'Помилка',
      },
      observe: (source) => `Дозапис · ${source}`,
      import: 'Імпорт історії',
      pending: 'Запит надіслано, чекаємо на відповідь сервера.',
      justNow: 'щойно',
      running: (at) => `Триває. Без відповіді до ${at} запуск вважатиметься невдалим.`,
      until: (at) => `до ${at}`,
      nbu: (dates, written, mismatched) =>
        `Дат: ${dates} · рядків записано ${written} · розбіжностей ${mismatched}`,
      inzhur: (dates, written, skipped, termsWritten, termsRefused) =>
        `Дат: ${dates} · рядків записано ${written}, пропущено ${skipped} · умови: записано ${termsWritten}, відхилено ${termsRefused}`,
      fund: (ref, n, rows, written, from, to) =>
        `${ref}: ${rows} ${plural(n, 'рядок', 'рядки', 'рядків')}, записано ${written} · ${from} – ${to}`,
      incomplete: (next) => `Не завершено — далі з ${next}`,
      reason: {
        start_failed: 'Не вдалося запустити.',
        capture_failed: 'Захоплення завершилося помилкою.',
        deadline_exceeded: (minutes) =>
          `Перевищено ліміт часу: запуск не відповів за ${minutes} хв, результату немає.`,
      },
      you: 'Ви',
      by: 'Запустив:',
      empty: 'Ще жодного запуску',
      emptyLead: 'Запуск із форми вище з’явиться тут: хто, що, коли й чим завершився.',
      more: 'Показати ще',
      staleStatus: (at, n) => `Журнал не оновився о ${at}: відповідь HTTP ${n}. Оновлюємо далі.`,
      staleOffline: (at) => `Журнал не оновився о ${at}: сервер не відповів. Оновлюємо далі.`,
      failed: 'Не вдалося прочитати журнал',
      failedLead: (cause) => `${cause} Запуски тривають і без журналу.`,
    },
  },
  profile: {
    title: 'Профіль',
    subtitle: 'Обліковий запис, вхід і ваші дані',
    sections: { account: 'Обліковий запис', data: 'Ваші дані', sessions: 'Сеанси', signIn: 'Вхід' },
    email: 'Адреса',
    role: 'Роль',
    superAdmin: 'Суперадміністратор',
    since: 'Учасник з',
    id: 'Ідентифікатор',
    copy: 'Копіювати',
    copied: 'Скопійовано',
    copiedStatus: 'Ідентифікатор скопійовано',
    copyFailed: 'Не скопійовано',
    copyFailedStatus: 'Не вдалося скопіювати ідентифікатор. Його виділено — скопіюйте вручну.',
    google: 'Google',
    linked: 'Підключено',
    notLinked: 'Не підключено',
    passkeys: {
      title: 'Ключі доступу',
      unnamed: 'Ключ доступу',
      created: (date: string) => `Створено ${date}`,
      none: 'Ключів доступу ще немає.',
      google:
        'Ключі доступу видно після входу з паролем або ключем доступу. Ви увійшли через Google.',
      failed: 'Не вдалося прочитати ключі доступу. Перезавантажте сторінку, щоб спробувати ще раз.',
    },
    assets: 'Активи',
    transactions: 'Транзакції',
    firstActivity: 'Перша операція',
    copyData: {
      title: 'Копія даних',
      helper: 'Повна копія в JSON і таблиці CSV — у Налаштуваннях, розділ «Дані».',
      open: 'До налаштувань',
    },
    privacy: {
      title: 'Як ми обробляємо дані',
      helper: 'Хто їх зберігає, навіщо, скільки й ваші права.',
      open: 'Конфіденційність',
    },
    terms: {
      title: 'Умови користування',
      helper: 'На яких умовах працює сервіс і що він не робить.',
      open: 'Умови',
    },
    signOutEverywhere: {
      title: 'Вийти на всіх пристроях',
      helper: 'Завершує вхід на кожному пристрої, зокрема на цьому. Спершу підтвердьте, що це ви.',
      open: 'Вийти всюди…',
      confirm: {
        title: 'Вийти на всіх пристроях?',
        body: 'Вхід завершиться на кожному пристрої, зокрема на цьому. Далі підтвердьте, що це ви.',
        cancel: 'Скасувати',
        continue: 'Продовжити',
      },
      reauth: {
        lead: 'Перш ніж вийти на всіх пристроях, підтвердьте вхід.',
        action: 'Вийти всюди',
        busy: 'Виходимо…',
        failed: 'Не вдалося вийти на всіх пристроях. Спробуйте ще раз.',
        confirmedLead: 'Тепер можна вийти на всіх пристроях, зокрема на цьому.',
      },
    },
  },
  reauth: {
    title: 'Підтвердьте, що це ви',
    continue: 'Підтвердити',
    passkey: {
      usePassword: 'Підтвердити паролем',
      notFinished:
        'Підтвердження ключем доступу не завершено: його скасовано, або на цьому пристрої немає ключа для цієї адреси.',
    },
    password: { wrong: 'Неправильний пароль.' },
    confirmed: { title: 'Ви підтвердили, що це ви' },
    google: {
      completing: 'Завершуємо підтвердження через Google.',
      failed: 'Підтвердження через Google не завершено.',
    },
    timeLeft: (time: string) => `Залишилося ${time}`,
    timeReminder: 'Залишилася 1 хвилина.',
    expired: 'Час на підтвердження минув. Підтвердьте ще раз.',
  },
  auth: {
    signIn: {
      title: 'Вхід',
      lead: 'Вкажіть адресу, на яку прийшло запрошення.',
      continue: 'Продовжити',
      checking: 'Перевіряємо…',
      applyPrompt: 'Ще немає доступу?',
      applyLink: 'Подати заявку',
    },
    email: 'Електронна пошта',
    emailMissing: 'Вкажіть електронну пошту.',
    emailInvalid: 'Адреса — латиницею, як name@example.com.',
    change: 'Змінити',
    changeLabel: 'Змінити адресу',
    signingIn: 'Входимо…',
    passkey: {
      title: 'Підтвердьте ключем доступу',
      lead: 'Браузер відкрив вікно ключа доступу.',
      usePassword: 'Увійти з паролем',
      notFinished:
        'Вхід ключем доступу не завершено: його скасовано, або на цьому пристрої немає ключа для цієї адреси.',
    },
    google: {
      or: 'або',
      continue: 'Продовжити з Google',
      failed: 'Вхід через Google не завершено.',
      completing: 'Завершуємо вхід через Google.',
    },
    retry: 'Спробувати ще раз',
    password: {
      title: 'Введіть пароль',
      label: 'Пароль',
      show: 'Показати пароль',
      hide: 'Сховати пароль',
      submit: 'Увійти',
      busy: 'Входимо…',
      missing: 'Вкажіть пароль.',
      wrong: 'Неправильна адреса або пароль.',
    },
    setPassword: {
      title: 'Встановіть пароль',
      lead: 'Тимчасовий пароль із запрошення діє лише для першого входу. Придумайте власний.',
      label: 'Новий пароль',
      rule: 'Щонайменше 8 символів: велика й мала літери, цифра та символ.',
      reused: 'Це тимчасовий пароль. Придумайте власний.',
      expired: 'Час на встановлення пароля минув. Введіть тимчасовий пароль ще раз.',
      submit: 'Зберегти й продовжити',
      busy: 'Зберігаємо…',
    },
    addPasskey: {
      title: 'Додайте ключ доступу',
      lead: 'Наступного разу входьте відбитком, обличчям або блокуванням екрана цього пристрою — без пароля.',
      create: 'Створити ключ доступу',
      later: 'Не зараз',
      createdTitle: 'Ключ доступу створено',
      createdLead: 'Наступного разу браузер запропонує його одразу після адреси.',
      continue: 'Продовжити',
      notCreated:
        'Ключ доступу не створено: вікно закрито, або цей пристрій не може його зберегти.',
      failed: 'Не вдалося зберегти ключ доступу. Спробуйте ще раз.',
    },
    tooMany: 'Забагато спроб. Спробуйте пізніше.',
    offline: 'Не вдалося з’єднатися — перевірте мережу й спробуйте ще раз.',
    failed: 'Не вдалося увійти. Спробуйте ще раз.',
    apply: {
      title: 'Заявка на доступ',
      lead: 'Quirenote працює за заявками. Якщо вашу схвалять, запрошення прийде на цю адресу.',
      submit: 'Подати заявку',
      busy: 'Надсилаємо…',
      signInPrompt: 'Вже маєте доступ?',
      signInLink: 'Увійти',
      busyServer: 'Зараз забагато запитів. Спробуйте ще раз за мить.',
      failed: 'Не вдалося надіслати заявку. Спробуйте ще раз.',
      termsOutdated:
        'Умови користування змінилися. Перезавантажте сторінку, щоб прочитати їх, і подайте заявку ще раз.',
      recordedTitle: 'Заявку записано',
      recordedLead: (email: string) =>
        `Якщо її схвалять, запрошення прийде на ${email}. Інших листів не буде.`,
      back: 'Повернутися до входу',
    },
    botCheck: {
      pending: 'Перевірка безпеки ще триває. Спробуйте ще раз за мить.',
      failed: 'Перевірку безпеки не завершено. Спробуйте ще раз.',
      unavailable:
        'Не вдалося завантажити перевірку безпеки. Перевірте мережу чи блокувальник реклами й оновіть сторінку.',
    },
    signedInAs: (email: string) => `Ви увійшли як ${email}`,
    profileLink: (email: string) => `Профіль: ${email}`,
    signedIn: 'Ви увійшли',
    signOut: 'Вийти',
    notSignedIn: 'Ви не ввійшли',
    signInEntry: 'Увійти',
    signOutFailed: 'Не вдалося вийти — ви досі в застосунку. Спробуйте ще раз.',
    signedOut: 'Ви вийшли із застосунку.',
    selfXss: {
      headline: 'Стоп!',
      body: 'Ця консоль — інструмент браузера для розробників. Якщо хтось попросив вас скопіювати й вставити сюди щось, це шахрайство під назвою Self-XSS, яке віддасть їм ваш обліковий запис Quirenote. Не вводьте й не вставляйте код, якого не розумієте.',
    },
    pending: {
      title: 'Заявка на розгляді',
      lead: 'Доступ відкриється, щойно її схвалять. Більше нічого робити не потрібно.',
    },
    rejected: {
      title: 'Обліковий запис вимкнено',
      lead: 'Доступ до нього закрито. Щоб дізнатися причину, напишіть на support@quirenote.com.',
    },
    noApplication: {
      title: 'Для цього облікового запису немає заявки',
      lead: 'Вийдіть і подайте заявку з адресою, якою користуватиметеся.',
      apply: 'Вийти й подати заявку',
    },
    forbidden: {
      title: 'Немає доступу',
      lead: 'Цей обліковий запис не має доступу до Quirenote.',
    },
    terms: {
      title: 'Прийміть умови користування',
      lead: 'Щоб відкрити Quirenote, прийміть умови, на яких він працює.',
    },
  },
  privacy: {
    link: 'Конфіденційність',
    title: 'Політика конфіденційності',
    updated: (date: string) => `Останнє оновлення: ${date}`,
    contents: 'Зміст',
    back: 'До Quirenote',
    newTab: '(відкривається в новій вкладці)',
    intro: [
      'Тут сказано, які ваші дані обробляє Quirenote, навіщо, кому вони передаються, скільки зберігаються і які у вас права. Ми обробляємо їх за Законом України «Про захист персональних даних» і даємо всю інформацію, якої вимагає стаття 13 GDPR.',
      'Сторінка є українською й англійською. Якщо версії розходяться, чинна українська.',
    ],
    sections: {
      controller: section(
        'Хто відповідає за ваші дані',
        'Володілець персональних даних — Роман Кушик, фізична особа, Україна. З будь-яким питанням про ваші дані пишіть на support@quirenote.com; на запит повідомимо й місце проживання володільця.',
        'Інспектора з захисту даних ми не призначали: для такої обробки закон його не вимагає.',
      ),
      data: section(
        'Які дані ми обробляємо',
        [
          'Заявка: адреса електронної пошти, час подання, версія Умов користування, яку ви прийняли, і час її прийняття.',
          'Обліковий запис: адреса, роль, дати подання заявки й схвалення, версія Умов користування, яку ви прийняли, і час її прийняття. Пароль зберігає Amazon Cognito, Quirenote його не зберігає. Ключі доступу: Amazon Cognito зберігає їхні ідентифікатор, назву, тип пристрою й дату створення; закритий ключ лишається на вашому пристрої.',
          'Вхід через Google: Google передає Amazon Cognito ваше ім’я, адресу й фото профілю. Зберігаються лише адреса, позначка, що Google її підтвердив, і ідентифікатор облікового запису Google.',
          'Портфель: рахунки, активи, операції з нотатками, ціни й налаштування, які ви вносите.',
          'Технічні дані: IP-адреса й дані браузера, які отримують Cloudflare, через мережу якого відкривається сайт, і Amazon Web Services, на серверах якого працюють застосунок і вхід. Щоб перевірити форму, сервер передає Cloudflare вашу IP-адресу. У журналах сервісу обліковий запис названо ідентифікатором, а не адресою.',
          'Звернення: те, що ви пишете на support@quirenote.com.',
        ],
        'Адреса потрібна, щоб подати заявку: без неї ми не можемо її розглянути. Решту даних ви вносите самі.',
      ),
      purposes: section(
        'Навіщо й на якій підставі',
        [
          'Розглянути заявку й надіслати запрошення — дії перед укладенням договору на ваше прохання (пункт 3 частини першої статті 11 Закону; стаття 6(1)(b) GDPR).',
          'Дати вам вхід, зберігати, рахувати й показувати портфель, зберігати запис договору (яку версію Умов користування ви прийняли й коли) і відповідати на звернення — виконання договору (ті самі статті).',
          'Захищати сервіс від ботів і зловживань: перевірка Cloudflare, журнали, резервні копії — наш законний інтерес у безпеці мережі й інформації (пункт 6 частини першої статті 11 Закону; стаття 6(1)(f) і пункт 49 преамбули GDPR).',
        ],
        'Згоди ми не просимо, бо не обробляємо даних на її підставі. Ми не надсилаємо реклами, не будуємо профілів і не ухвалюємо автоматизованих рішень, які мають для вас правові наслідки: Cloudflare лише перевіряє, що форму надсилає людина, а заявку розглядає людина.',
      ),
      recipients: section(
        'Кому передаються дані',
        [
          'Amazon Web Services зберігає дані й надсилає запрошення: регіон eu-north-1, Стокгольм, Швеція.',
          'Cloudflare, Inc. (США): мережа, через яку відкривається сайт, і перевірка форм заявки й входу (Turnstile). Дані перевірки Cloudflare також використовує сам, як окремий володілець, щоб краще розпізнавати ботів: [повідомлення Cloudflare про Turnstile](https://www.cloudflare.com/turnstile-privacy-policy/).',
          'Google LLC (США), лише якщо ви входите через Google.',
          'Листи на support@quirenote.com Cloudflare пересилає на поштову скриньку власника в Gmail (Google LLC).',
          'Відкритий прайс Inzhur (кнопка «Отримати котирування» чи вибір активу Inzhur у формі) запитує ваш браузер, тож Inzhur бачить вашу IP-адресу. Про вас ми Inzhur нічого не передаємо.',
        ],
        'Нікому іншому ми ваших даних не передаємо й не продаємо.',
      ),
      transfers: section(
        'Передача за кордон',
        'Швеція входить до Європейської економічної зони. Cloudflare, Inc. і Google LLC сертифіковані за Рамковою програмою захисту даних ЄС—США, щодо якої Європейська комісія ухвалила рішення про належний рівень захисту (2023/1795). Закон України визнає належним рівень захисту і в державах ЄЕЗ, і в США (стаття 29 Закону).',
      ),
      retention: section('Скільки ми зберігаємо', [
        'Заявку — доки її не розглянуто. Відхилену видаляємо в момент відхилення.',
        'Обліковий запис і портфель — доки існує обліковий запис. Щоб видалити його, напишіть на support@quirenote.com.',
        'Дані, стерті кнопкою «Стерти дані», зникають з робочої бази протягом 30 днів.',
        'Резервні копії бази зберігаються 35 днів, тож видалене зникає з них протягом 35 днів після того, як зникло з робочої бази.',
        'Журнали сервісу — 30 днів. Журнал подій облікового запису AWS (CloudTrail), де видно вхід через Google з IP-адресою й даними браузера та дії з обліковими записами за ідентифікатором, — 90 днів; AWS не дає його скоротити.',
        'Листування — доки існує ваш обліковий запис; видаляємо разом з ним. Лист від того, хто облікового запису не має, видаляємо, щойно на нього відповіли.',
        'Cookie й записи в браузері — як у розділі «Cookie та сховище браузера».',
      ]),
      rights: section(
        'Ваші права',
        'Ви можете:',
        [
          'знати, які ваші дані ми обробляємо, звідки вони, де зберігаються, навіщо й кому передаються;',
          'отримати їх копію: копія портфеля у JSON і таблиці CSV є в Налаштуваннях, у розділі «Дані», а дані облікового запису надішлемо на запит;',
          'виправити неточні дані;',
          'видалити дані або обліковий запис;',
          'обмежити обробку;',
          'заперечити проти обробки, зокрема тієї, що спирається на наш законний інтерес;',
          'бути захищеними від незаконної обробки, випадкової втрати, знищення чи пошкодження даних;',
          'перенести дані до іншого сервісу — та сама копія;',
          'знати, як працює автоматична обробка, і бути захищеними від автоматизованих рішень з правовими наслідками (таких ми не ухвалюємо);',
          'відкликати згоду або обмежити її, коли обробка спирається на згоду (наша не спирається).',
        ],
        'Пишіть на support@quirenote.com. Протягом 10 робочих днів ми повідомимо, чи виконаємо запит, і виконаємо його протягом 30 календарних днів, а якщо місяць коротший — протягом місяця.',
        'Скаргу можна подати Уповноваженому Верховної Ради України з прав людини ([ombudsman.gov.ua](https://ombudsman.gov.ua/), гаряча лінія 1678, hotline@ombudsman.gov.ua) або до суду. Якщо ви в ЄС чи ЄЕЗ, можна звернутися й до наглядового органу держави, де ви живете чи працюєте або де сталося порушення.',
      ),
      cookies: {
        ...section(
          'Cookie та сховище браузера',
          'Усі вони потрібні, щоб сервіс працював. Аналітичних і рекламних cookie немає, тож згоди на них ми не просимо. Перевірка Cloudflare cookie не ставить.',
        ),
        rows: {
          refresh: 'тримає вхід · 2 години, подовжується з кожним оновленням',
          origin: 'дає скасувати вхід, якщо його викрали · 24 години',
          access: 'зашифрований токен доступу · до 1 години',
          google: 'вхід через Google · 15 хвилин',
          cognito: 'вхід через Google · 1 година',
          settings: 'налаштування на цьому пристрої · доки ви їх не зітрете',
          draft: 'чернетка котирувань за день · до виходу чи кінця сеансу',
          inzhur: 'останній прайс Inzhur · доки ви їх не зітрете',
          handoff: 'перехід через вихід і повторний вхід · до закриття вкладки',
        },
        cognitoName: 'cookie Amazon Cognito на auth.quirenote.com',
      },
      changes: section(
        'Зміни',
        'Дату останнього оновлення вказано вгорі. Про суттєві зміни ми повідомимо в застосунку, перш ніж вони наберуть чинності.',
      ),
    },
    firstLayer:
      'Quirenote використовує адресу, щоб розглянути заявку й надіслати запрошення, а Cloudflare перевіряє, що форму надсилає людина. Разом із заявкою Quirenote записує, яку версію Умов і коли ви прийняли, щоб зберігати запис договору з вами. Хто обробляє ці дані, де їх зберігають і які у вас права — у [Політиці конфіденційності](/privacy).',
  },
  terms: {
    link: 'Умови',
    title: 'Умови користування',
    updated: (date: string) => `Останнє оновлення: ${date}`,
    intro: [
      'Ці умови — договір між вами й власником Quirenote про користування сервісом. Ви приймаєте їх цілком, як договір приєднання (стаття 634 Цивільного кодексу України), коли натискаєте «Подати заявку» чи «Прийняти умови». Діяти для вас вони починають, коли заявку схвалено, а якщо ви прийняли їх кнопкою «Прийняти умови» — з моменту прийняття.',
      'Сторінка є українською й англійською. Якщо версії розходяться, чинна українська.',
    ],
    sections: {
      operator: section(
        'Хто надає сервіс',
        'Quirenote надає Роман Кушик, фізична особа, Україна (далі — «ми»). Пишіть на support@quirenote.com.',
        'Сервіс безоплатний, і ми надаємо його не як підприємницьку діяльність. Тому ці умови — не публічний договір і не публічна оферта (статті 633 і 641 Цивільного кодексу): ми можемо відмовити в обліковому записі.',
      ),
      service: section(
        'Що таке Quirenote',
        'Quirenote — інформаційний інструмент для обліку вашого власного портфеля: облігацій внутрішньої державної позики, фондів Inzhur і грошей на рахунках. Кожну цифру він рахує з того, що вносите ви, і з даних, названих у розділі 4.',
      ),
      advice: section(
        'Це не порада',
        'Quirenote не дає індивідуальних інвестиційних, податкових чи юридичних порад і не прогнозує цін. Інвестиційне консультування — діяльність інвестиційних фірм (частина десята статті 44 Закону України «Про ринки капіталу та організовані товарні ринки»), і ми її не провадимо. Підказки, які показує сервіс, рахуються з ваших даних і цільових часток, які ви задали самі. Рішення про свої інвестиції й податки ви ухвалюєте самі.',
      ),
      sources: section(
        'Звідки дані',
        [
          'Курс гривні до долара — офіційний курс Національного банку України з його відкритих даних, з посиланням на джерело.',
          'Для активів, пов’язаних з Inzhur, сервіс використовує також ціни й графіки виплат з архіву, який веде сам.',
          'Прайс Inzhur ваш браузер запитує в Inzhur сам, коли ви натискаєте «Отримати котирування» чи відкриваєте вибір активу Inzhur у формі.',
          'Ціна, яку ви внесли самі на певний день, має перевагу.',
        ],
        'Ці дані ми показуємо такими, як їх отримали чи розрахували: вони можуть запізнюватися, бути неповними чи неточними. Те, що ви вносите самі, ми не перевіряємо.',
      ),
      account: section('Обліковий запис', [
        'Відхилену заявку видаляємо, а причину не повідомляємо.',
        'Пароль у застосунку відновити не можна. Бережіть пристрій, ключі доступу й пароль: хто ними володіє, той входить у ваш обліковий запис.',
        'Якщо втратили доступ чи помітили чужий вхід, напишіть на support@quirenote.com.',
      ]),
      data: section(
        'Ваші дані',
        [
          'Дані, які ви вносите, — ваші. Ми використовуємо їх лише для того, щоб надавати вам сервіс.',
          'Копія портфеля у JSON і таблиці CSV є в Налаштуваннях, у розділі «Дані»; там само кнопка «Стерти дані» стирає портфель.',
          'Щоб видалити обліковий запис, напишіть на support@quirenote.com.',
          'Ми робимо резервні копії бази, але радимо зберігати й власну копію.',
        ],
        'Як ми обробляємо персональні дані, сказано в [Політиці конфіденційності](/privacy).',
      ),
      use: section('Чого робити не можна', [
        'заходити в сервіс ботами чи скриптами або перевантажувати його;',
        'обходити перевірку Cloudflare чи інші обмеження сервісу;',
        'намагатися отримати доступ до чужого облікового запису чи чужих даних;',
        'користуватися сервісом усупереч закону.',
      ]),
      availability: section(
        'Доступність і зміни сервісу',
        'Сервіс надаємо «як є». Ми не обіцяємо, що він працюватиме без перерв і помилок: його можуть зупиняти збої й обслуговування. Ми можемо змінювати, додавати й прибирати функції. Якщо закриємо сервіс, повідомимо про це в застосунку заздалегідь, щоб ви встигли зберегти копію даних.',
      ),
      liability: section(
        'Відповідальність',
        'Сервіс безоплатний, тож наша відповідальність за збитки обмежена так, як для безоплатних послуг встановлює частина друга статті 906 Цивільного кодексу. Це обмеження не стосується умисного порушення (частина третя статті 614 Кодексу). За порушення через випадок чи непереборну силу ми не відповідаємо (стаття 617 Кодексу).',
      ),
      termination: section(
        'Припинення',
        'Ви можете будь-коли перестати користуватися сервісом і попросити видалити обліковий запис (розділ 6). Ми можемо вимкнути чи видалити обліковий запис, якщо ви порушуєте ці умови; спершу ми вам напишемо, крім випадків, коли порушення загрожує сервісу чи іншим користувачам. Перш ніж обліковий запис видалять, збережіть копію даних.',
      ),
      changes: section(
        'Зміни умов',
        'Дату останнього оновлення вказано вгорі, і за нею ми записуємо, яку версію ви прийняли. Про суттєві зміни ми повідомимо в застосунку, перш ніж вони наберуть чинності. Якщо ви не згодні з новими умовами, можете припинити користування й попросити видалити обліковий запис (розділ 6).',
      ),
      law: section(
        'Право й суперечки',
        'До цих умов застосовується право України. Суперечку ми спершу намагаємося розв’язати листуванням; якщо не вийде, її розглядає суд України за правилами підсудності.',
      ),
    },
    accept: 'Натискаючи «Подати заявку», ви приймаєте [Умови користування](/terms).',
    step: {
      accept: 'Натискаючи «Прийняти умови», ви приймаєте [Умови користування](/terms).',
      submit: 'Прийняти умови',
      busy: 'Приймаємо…',
      decline: 'Відхилити й вийти',
      failed: 'Не вдалося прийняти умови. Спробуйте ще раз.',
      outdated:
        'Умови користування змінилися. Перезавантажте сторінку, щоб прочитати їх, і прийміть їх ще раз.',
      firstLayer:
        'Quirenote записує в обліковому записі, яку версію Умов і коли ви прийняли, щоб зберігати запис договору з вами. Хто обробляє ці дані, де їх зберігають і які у вас права — у [Політиці конфіденційності](/privacy).',
    },
  },
  transaction: {
    title: 'Транзакція',
    badge: 'Нерегулярно',
    subtitle:
      'Поповнення, купівлі, нарахування, реінвестиції — відкривається лише тоді, коли щось сталося.',
    date: 'Дата',
    type: 'Тип',
    asset: 'Актив',
    assetPlaceholder: 'Оберіть актив…',
    newAssetOption: '+ Новий актив…',
    newAssetDetails: 'Дані нового активу',
    amount: 'Сума, ₴',
    amountPlaceholder: '10 000,00',
    amountUnit: 'За одиницю, ₴',
    priceTotal: 'Загальна сума',
    priceUnit: 'Ціна за одиницю',
    quantity: 'Одиниці',
    quantityPlaceholder: '6 164',
    quantityMissing: 'Введіть кількість одиниць.',
    quantityNotPositive: 'Кількість має бути додатним числом.',
    quantityUnreadable: 'Вкажіть число.',
    submit: 'Записати транзакцію',
    amountMissing: 'Введіть суму.',
    amountNotPositive: 'Сума має бути додатним числом.',
    amountUnreadable: 'Вкажіть число.',
    // ONE NOUN PHRASE FOR ONE FIELD: the label reads «Утримано податку», so the
    // refusals read «Утриманий податок…» rather than inventing a third word for
    // the same sum.
    withholding: 'Утримано податку, ₴',
    withholdingPlaceholder: '65,44',
    withholdingNotPositive: 'Утриманий податок має бути додатним числом.',
    withholdingUnreadable: 'Вкажіть число.',
    withholdingAboveAmount: 'Утриманий податок має бути меншим за суму.',
    withheldAndNet: (withheld: string, net: string) => `${withheld} · після податку ${net}`,
    ahead: 'Ще не враховано',
    aheadTitle: (date: string) => `Враховується з ${date}.`,
    note: 'Нотатка',
    notePlaceholder: 'Про що цей запис',
    noteTooLong: 'Нотатка — не більше 100 символів тексту.',
    productTooSmall: 'Ціна на кількість дає нуль — перевірте обидва поля.',
    invalid: 'Перевірте підсвічені поля та спробуйте ще раз.',
    recentEmpty: 'Транзакцій ще немає.',
    types: {
      buy: 'Купівля',
      sell: 'Продаж',
      deposit: 'Поповнення',
      withdrawal: 'Виведення',
      dividend_accrual: 'Нарахування дивідендів',
      interest_payout: 'Виплата відсотків',
      reinvest: 'Реінвестиція',
      redemption: 'Погашення',
    },
    recentCoupon: 'Купон',
    portfolioRow: 'Портфель',
    recordedToast: 'Транзакцію записано',
    failedToast: 'Не вдалося записати транзакцію — спробуйте ще раз.',
    delete: {
      aria: 'Видалити цей запис',
      ask: (amount: string, date: string) => `Видалити ${amount} від ${date}?`,
      confirm: 'Видалити',
      cancel: 'Ні',
      doneToast: 'Транзакцію видалено',
      couponReopenedToast: 'Транзакцію видалено — купон знову очікується',
      failedToast: 'Не вдалося видалити транзакцію — спробуйте ще раз.',
    },
  },
  edit: {
    edit: 'Редагувати',
    cancel: 'Скасувати',
    save: 'Зберегти',
    done: 'Готово',
    discardTitle: 'Відхилити зміни?',
    discardBody: 'Зміни на цій сторінці не збережено. Якщо вийти зараз, їх буде відхилено.',
    keepEditing: 'Продовжити редагування',
    discard: 'Відхилити',
  },
  dailyQuotes: {
    fetch: {
      idle: 'Отримати котирування',
      loading: 'Отримання…', // ✎
      fetchedAt: (time: string) => `Отримано ${time}`, // ✎
      unlinked: 'Ще немає активів, пов’язаних з Inzhur — прив’яжіть у Портфелі.',
      otherDay: 'Ціни Inzhur — на сьогодні; щоб їх отримати, оберіть сьогоднішню дату.',
      feedAsOf: (date: string) => `Inzhur станом на ${date}`, // ✎
      feedAt: (time: string) => `Inzhur ${time}`,
    },
    chip: {
      auto: 'авто',
      manual: 'вручну',
      asOf: (date: string) => `станом на ${date}`, // ✎
      suggested: 'пропозиція',
      accrual: 'нарахування',
      fetched: (time: string) => `отримано ${time}`,
    },
    yesterdayValue: (amount: string) => `${amount} учора`,
    useFetched: (value: string) => `Взяти отримане ${value}?`,
    useCached: (value: string, date: string) => `Взяти ${value} (станом на ${date})?`,
    useSuggested: (value: string) => `Взяти запропоноване ${value}?`,
    priceDoesNotFit: (published: string, implied: string) =>
      `Ціна не відповідає ${published} у жоден день останніх двох тижнів — за сьогоднішнього розрахунку вона означала б ${implied}.`,
    filled: (n: number, total: number) => `${n} з ${total} заповнено`,
    dateLabel: 'Дата',
    // `зріз` for snapshot — the term the Balances subtitle already uses.
    saveSnapshot: 'Зберегти зріз', // ✎
    copyYesterday: 'Скопіювати вчорашні',
    lastSaved: (when: string) => `Збережено ${when}`,
    notSavedYet: 'Ще не збережено',
    snapshotSavedToast: 'Зріз збережено',
    unreadable: 'Вкажіть число.',
    unreadableToast: (names: string) => `Не збережено — перевірте ${names}.`,
    nothingToSave: 'Нічого зберігати — введіть хоча б одне котирування.',
    saveFailed: 'Не вдалося зберегти зріз — спробуйте ще раз.',
    yieldSinceStart: 'Дохідність від початку',
    yieldChartLink: 'Графік дохідності →',
    pendingChange: {
      label: 'Цей зріз змінює',
      none: 'Ще нічого не введено',
      // The sheet's flat «активів» is RIGHT for every plural count — after «з»
      // the noun is genitive, so «2 з 4 активів» and «3 з 7 активів» alike. The
      // three-form rule is here for the ONE case it gets wrong: a single-asset
      // portfolio reads «1 з 1 активу», not «1 з 1 активів».
      count: (n: number, total: number) =>
        `${n} з ${total} ${plural(total, 'активу', 'активів', 'активів')}`,
    },
    keepMyValue: 'Лишити моє значення',
    dismissSuggestion: 'Відхилити пропозицію',
    model: {
      stale: (days: number, atLeast: boolean, date: string) =>
        `Ціна постачальника застаріла ${atLeast ? 'щонайменше ' : ''}на ${days} ${plural(days, 'день', 'дні', 'днів')} — вона досі відповідає ${date}.`,
      unexplained:
        'Ця ціна не відповідає жодній дохідності, яку може дати графік — помилятися може графік виплат стрічки або сама ціна.',
      tooCloseToMaturity: 'Занадто близько до погашення, щоб перевіряти дохідність за ціною.',
    },
    fetchFailed: 'Не вдалося зв’язатися з Inzhur — перевірте з’єднання.',
    staleLedgerRows: (names: string) =>
      `Оцінено за старою збереженою кількістю: ${names} — не в усіх їхніх транзакціях вказано одиниці.`,
    negativeUnits: (names: string) =>
      `Кількість нижча за нуль: ${names} — записаних продажів більше, ніж купівель.`,
    noUnitsRecorded: (names: string) =>
      `Кількість ще не записана: ${names} — запишіть купівлю з полем «Одиниці», щоб оцінити ці рядки.`,
    useValuesFrom: (date: string) => `Взяти значення від ${date}`,
    quoteAria: (asset: string) => `Котирування ${asset}`,
    coupon: {
      badge: 'Купон до сплати',
      heading: (name: string, amount: string) => `${name} — купон ${amount}`,
      headingNoAmount: (name: string) => `${name} — купон`,
      scheduled: (date: string) =>
        `Заплановано на ${date}. Підтвердьте, щоб записати — суму можна змінити, історія не переписується.`,
      reinvest: 'Також записати реінвестицію цієї суми',
      reinvestHint:
        'Та сама дата, той самий актив — виплата тоді рахується реінвестованою, а не виплаченою.',
      confirm: 'Записати купон',
      skip: 'Пропустити',
      recordedToast: 'Купон записано',
      recordedReinvestToast: 'Купон + реінвестицію записано',
    },
    provenance: {
      auto: 'Заповнено з Inzhur (одиниці × ціна продажу).',
      manual: 'Введено вручну — отримання цього не перезаписує.',
      stale: 'З останнього вдалого отримання — Inzhur був недоступний.',
      accrual: 'Заповнено з нарахування купона — прийнята пропозиція.',
      ghost: 'Запропоновано з нарахування купона — прийміть або введіть власне.',
    },
  },
  boundary: {
    notFound: {
      title: 'Сторінку не знайдено',
      lead: 'Якщо ви вводили адресу, перевірте, чи вона правильна. Якщо вставляли — чи скопіювали її повністю.',
      home: 'Перейти до щоденних котирувань',
    },
    failed: {
      title: 'Не вдалося показати сторінку',
      lead: 'Перезавантажте сторінку, щоб спробувати ще раз. Від цього ваші дані не зникнуть.',
      reload: 'Перезавантажити сторінку',
    },
  },
  screen: {
    transactions: {
      title: 'Транзакції',
      subtitle: 'Запишіть купівлю, продаж, купон або дивіденд.',
    },
    dailyQuotes: {
      title: 'Щоденні котирування',
      subtitle: 'Щоденний ритуал — ніщо інше з ним не конкурує.',
    },
    overview: {
      title: 'Огляд',
      subtitle: (date: string) => `Портфель одним поглядом · ${date}`,
    },
    balances: {
      title: 'Баланси',
      subtitle: 'Загальний капітал за щоденними зрізами',
    },
    payouts: {
      title: 'Виплати',
      subtitle: 'Отримані дивіденди та купони, за місяцями',
    },
    yield: {
      title: 'Дохідність',
      subtitle: 'Накопичена дохідність за активом від першої купівлі, %',
    },
    attributes: {
      title: 'Атрибути',
      subtitle: 'Довідкові дані активу — створюються транзакцією, редагуються в Портфелі',
    },
    seasonality: {
      title: 'Сезонність',
      subtitle: 'Коли гроші справді приходять — дохід за днями місяця',
    },
    portfolio: {
      title: 'Портфель',
      subtitle: 'Позиції, собівартість і результат за активом',
    },
    allocation: {
      title: 'Розподіл',
      subtitle: 'Поточна структура проти ваших цілей — редагуйте їх тут',
    },
    settings: {
      title: 'Налаштування',
      subtitle: 'Уподобання, дані та автоматизація',
    },
    archive: {
      back: 'Налаштування',
      title: 'Архів цін',
      subtitle: 'Покриття котирувань, ремонт архіву і журнал запусків',
    },
  },
};
