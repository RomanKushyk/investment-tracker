/**
 * The message dictionary. English is CANONICAL — its shape is the type, and
 * Ukrainian must match it exactly:
 *
 *   const en = { … }          // the source of both keys and structure
 *   type Dict = typeof en     // values widen to string / to a function type
 *   const uk: Dict = { … }    // a missing or extra key is a compile error
 *
 * That is why `en` carries no `as const`: with it, every value would become a
 * literal type and `uk` could only satisfy `Dict` by repeating the English
 * strings. Widening is the point.
 *
 * Namespace is `screen.section.item` (G-plan A10). Strings that take values are
 * FUNCTIONS rather than templates with placeholders — the parameter list is
 * then part of the type, so a translation cannot silently drop an interpolation
 * or take it in the wrong order.
 *
 * Ukrainian is the default language (Phase 5 owner ruling), so `uk` is not a
 * fallback: `en` is the one that has to keep up.
 *
 * PROVENANCE. Strings marked ✎ below are the drafts the phase-5 design session
 * left in `design/extensions/appearance-language.dc.html`, which its own
 * handover note says are "drafts for A10's table, not pins" — A10 owns the
 * final wording. Everything unmarked is written here and has not been reviewed
 * by the owner yet.
 */

/**
 * The Ukrainian plural rule, which has three forms where English has two:
 *   1, 21, 31 …            -> one   (1 день)
 *   2-4, 22-24 …           -> few   (2 дні)
 *   0, 5-20, 25-30 …       -> many  (5 днів)
 * The 11-14 band is the exception every naive implementation gets wrong: it
 * takes `many` despite ending in 1-4.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const en = {
  nav: {
    groupDailyEntry: 'Daily entry',
    groupAnalytics: 'Analytics',
    groupSettings: 'Settings',
    dailyQuotes: 'Daily quotes',
    overview: 'Overview',
    balances: 'Balances',
    payouts: 'Payouts',
    yield: 'Yield',
    attributes: 'Attributes',
    seasonality: 'Seasonality',
    portfolio: 'Portfolio',
    allocation: 'Allocation',
    settings: 'Settings',
  },
  sidebar: {
    brandTagline: 'Invest tracker',
    totalCapital: 'Total capital',
    demoBadge: 'DEMO',
    demoTitle: 'Demo dataset — reference data. Switch in Settings → Data.',
  },
  csv: {
    title: 'Spreadsheet export (CSV)',
    helper:
      'One file per table, ready for a spreadsheet. Snapshots export wide — one row per date, one column per asset; an empty cell means no quote was saved that day, never zero.',
    // Still true under Contract 0, and worth saying twice: the FILE format is
    // machine-fixed and does not follow the language. Only the display does.
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
        'Restore a JSON backup. Import replaces everything in the active dataset — you review a summary first, and a safety backup downloads automatically.',
      dropLine: 'Drop a .json file here',
      dropHint: 'or use Choose file…',
      dragLine: 'Release to read the file',
      choose: 'Choose file…',
      demoNote:
        'You are in the demo dataset — importing here replaces the reference portfolio. "Reset demo data…" brings it back.',
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
      notABackup:
        'This is not a Quirenote backup — it has no "quirenote-backup" marker.',
      newerFormat: (version: string) =>
        `This backup was written by a newer version of the app (format ${version}). Update the app, or export again from the version that wrote it.`,
      unsupportedFormat:
        "This backup's format version isn't one this app can read.",
    },
    issue: {
      unknownAssetId: (value: string) => `unknown asset id "${value}"`,
      unknownQuoteAsset: (value: string) =>
        `quote for an unknown asset "${value}"`,
      duplicateDate: (value: string) =>
        `duplicate date ${value} (date is the primary key)`,
      duplicateId: (value: string) =>
        `duplicate id "${value}" (id is the primary key)`,
      unknownKey: (value: string) => `unexpected field "${value}"`,
      expectedDatetime: 'expected timezone-less yyyy-MM-ddTHH:mm:ss',
      expectedDate: 'expected a yyyy-MM-dd date',
      expectedPositiveAmount: 'expected a positive number',
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
      title: (dataset: string) => `Import into ${dataset}`,
      banner: (dataset: string) =>
        `Replaces everything in the ${dataset} dataset. Every asset, snapshot and transaction is deleted and rebuilt from this file. This cannot be undone.`,
      bannerDemoSuffix:
        ' "Reset demo data…" restores the reference portfolio afterwards.',
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
      waiting: 'Waiting for another tab…',
    },
    // Counted nouns. English needs one plural form, Ukrainian three — so the
    // COUNT PHRASES are built per language rather than shared with a noun
    // spliced in, and every sentence that quotes one takes the finished phrase.
    count: {
      assets: (n: number) => `${n} asset${n === 1 ? '' : 's'}`,
      snapshots: (n: number) => `${n} snapshot${n === 1 ? '' : 's'}`,
      transactions: (n: number) => `${n} transaction${n === 1 ? '' : 's'}`,
    },
    fileSubline: (name: string, date: string, time: string, dataset: string) =>
      `${name} · exported ${date} ${time} · from ${dataset}`,
    resultLine: (assets: string, snapshots: string, transactions: string) =>
      `After import: ${assets} · ${snapshots} · ${transactions}.`,
    settingsOptInHelper: (symbol: string, rate: string) =>
      `Replaces your currency and ₴/$ rate (${symbol} · ${rate}). Dataset, automation and reminder preferences are never touched.`,
    safetyBackupDone: (name: string) =>
      `Safety backup downloaded — ${name}.json.`,
    safetyBackupPending: (dataset: string, name: string) =>
      `A backup of your current ${dataset} data downloads automatically before anything is replaced — ${name}.json.`,
    warning: {
      // The list joiner and the verb agreement are assembled per language:
      // English needs "and" plus is/are, Ukrainian neither.
      rowsRemoved: (parts: string[], dataset: string) => {
        const subject =
          parts.length > 1
            ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
            : parts[0];
        const single = parts.length === 1 && parts[0].startsWith('1 ');
        return single
          ? `${subject} in ${dataset} is missing from this file — it will be removed.`
          : `${subject} in ${dataset} are missing from this file — they will be removed.`;
      },
      noAssets:
        'This file has no assets — the dataset will be empty after import.',
      noSnapshots: (current: number, dataset: string) =>
        `This file has no snapshots — all ${current} saved days in ${dataset} would be removed.`,
      otherDataset: (dataset: string) =>
        `This file was exported from the ${dataset} dataset.`,
      exportedLongAgo: (days: number, date: string) =>
        `Exported ${days} days ago (${date}).`,
      newerDbVersion: (file: string, app: string) =>
        `The file comes from a newer database version (${file} vs ${app}) — fields this app does not know are ignored.`,
    },
    toast: {
      success: (assets: string, snapshots: string, transactions: string) =>
        `Data imported — ${assets}, ${snapshots}, ${transactions}.`,
      failed: 'Could not import — nothing was changed.',
      safetyFailed:
        'Could not create the safety backup — nothing was imported.',
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
      kind: 'Kind',
      units: 'Units',
      expectedPct: 'Expected, %',
      targetPct: 'Target, %',
      yieldType: 'Yield type',
      payoutSchedule: 'Payout schedule',
      firstPurchase: 'First purchase',
      maturity: 'Maturity',
      nextCoupon: 'Next coupon',
      couponAmount: 'Coupon amount, ₴',
      reinvestPolicy: 'Reinvest policy',
      linkToInzhur: 'Link to Inzhur',
      // The fixed-coupon group's heading, shown only for a bond.
      fixedCouponGroup: 'Fixed coupon',
    },
    message: {
      name: 'Name is required.',
      code: 'Code is 1–2 letters.',
      expectedPct: 'Enter a percentage.',
      targetPct: 'Enter a percentage.',
      couponAmount: 'Enter an amount.',
      firstPurchase: 'Pick a date.',
      maturity: 'Pick a date.',
      nextCoupon: 'Pick a date.',
      refFund: 'Enter the fund slug.',
      refBond: 'Enter the bond ISIN.',
      units: 'Enter the number of units.',
      summary: 'Check the highlighted fields and try again.',
    },
    picker: {
      placeholder: 'Pick from Inzhur…',
      loading: 'Loading Inzhur assets…',
      failed: "Couldn't load the list — enter it manually.",
      empty: 'Nothing of this kind in the feed — enter it manually.',
      toManual: 'Enter manually',
      toPicker: 'Pick from the list',
      demo: 'Live list is disabled in demo — enter the slug or ISIN manually.',
      helper:
        'Linked assets are valued as units × the fetched sell price — use Fetch quotes on Daily quotes.',
      fund: 'Fund',
      bond: 'Bond',
      fundManual: 'Fund slug',
      bondManual: 'Bond ISIN',
      matures: (date: string) => `matures ${date}`,
    },
  },
  reminders: {
    quoteMissing: 'No quotes saved today yet.',
    coupon: (asset: string, when: string, date: string) =>
      `${asset} pays a coupon ${when} (${date}).`,
    couponOverdue: (asset: string, date: string) =>
      `${asset} coupon was due ${date} — record it on Daily quotes.`,
    maturesToday: (asset: string, date: string) =>
      `${asset} matures today (${date}).`,
    matures: (asset: string, when: string, date: string) =>
      `${asset} matures ${when} (${date}).`,
    // English has TWO plural forms; Ukrainian has three, which is why this is a
    // function per language rather than a string with a count spliced in.
    inDays: (days: number) => (days === 1 ? 'in 1 day' : `in ${days} days`),
    moreReminders: (hidden: number) =>
      `+${hidden} more reminder${hidden === 1 ? '' : 's'}`,
    enterQuotes: 'Enter quotes →',
    openDailyQuotes: 'Open Daily quotes →',
    dismiss: 'Dismiss reminder',
    andMore: (rest: number) => ` · +${rest} more`,
  },
  dates: {
    // Chart axes and month labels. The formatter owns full DATES (Contract 0);
    // these are the month WORDS a chart axis and a sentence need on their own.
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
    share: 'Share',
    snapshot: 'Snapshot',
    cash: 'Cash',
    totalUah: 'Total, ₴',
    prev: 'Prev',
    next: 'Next',
    date: 'Date',
    type: 'Type',
    amountUah: 'Amount, ₴',
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
      ledgerDrift:
        "Stored cash differs from the transaction ledger. Record a missing deposit or withdrawal, or correct the snapshot's cash.",
    },
    portfolio: {
      bestPerformer: 'Best performer',
      laggard: 'Laggard',
      incomeEngine: 'Income engine',
      noQuotes: 'No quotes yet.',
    },
    seasonality: {
      incomeAnchor: 'Income anchor',
      couponSeason: 'Coupon season',
      quietStretch: 'Quiet stretch',
    },
    allocation: {
      currentVsTarget: 'Current vs target',
      rebalancePlan: 'Rebalance plan',
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
      reinvestPolicy: 'Reinvest policy',
    },
    prose: {
      totalPlusCash: (cash: string) => `Total + cash ${cash}`,
      capitalGainNote:
        'Capital gain = value − invested (incl. reinvested payouts). Payout income counts in Total return on the Yield screen.',
      inWeeks: (pct: string, weeks: number) => `${pct} in ${weeks} weeks`,
      watchVsExpected: (pct: string, expected: string) =>
        `${pct} · watch vs ${expected} expected`,
      ofReceivedIncome: (pct: string) => `${pct} of received income`,
      reinvestedInto: (amount: string) => `reinvested (${amount})`,
      toAccount: 'account',
      seasonalityNote:
        "* expected — projected from the asset's next coupon date. Gray stubs = ordinary price-drift days with no income.",
      yieldNote: (start: string) =>
        `Annualized = total Δ scaled to 365 days from first purchase (${start}). Coupons count toward Δ on accrual. Total return is net of taxes and includes payouts. XIRR is money-weighted and annualized — with under a year of history, treat it as an extrapolation.`,
      // The hint is assembled around two <strong> spans, so it is two slots
      // rather than one sentence. The slot ORDER happens to match in both
      // languages — asset · connector · delta · phrase(target) · amount.
      rebalanceIs: 'is',
      underTarget: (target: string) => `under its ${target} target — top up`,
    },
    empty: {
      chart:
        'No snapshots yet — save your first daily quote to start this chart.',
      table:
        'No snapshots yet — save your first daily quote to fill this table.',
      rebalance:
        'No snapshots yet — save your first daily quote to see the rebalance hint.',
      allocation:
        'No snapshots yet — save your first daily quote to see the allocation mix.',
    },
  },
  assets: {
    edit: 'Edit',
    delete: 'Delete',
    // The leading plus is a <Plus> ICON, not text — it stays out of the string.
    add: 'Add asset',
    empty: 'No assets yet — add your first asset to start tracking.',
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteAction: 'Delete asset',
    cancel: 'Cancel',
    addedToast: 'Asset added',
    updatedToast: 'Asset updated',
    deletedToast: 'Asset deleted',
    saveFailed: 'Could not save the asset — please try again.',
    deleteFailed: 'Could not complete — nothing was deleted.',
  },
  targets: {
    title: 'Targets',
    save: 'Save targets',
    savedToast: 'Targets saved',
    saveFailed: 'Could not save targets — please try again.',
    invalid: 'Enter a percentage.',
    now: (pct: string) => `now ${pct}`,
  },
  datasetSwitch: { demo: 'Demo', live: 'Live' },
  danger: {
    // The typed word is DATA, not copy: the confirm compares it with the
    // dataset name, so translating it would make the button unarmable.
    typeToConfirm: (word: string) => `Type ${word} to confirm`,
    backupFirst: 'Download backup first',
    backupDone: 'Backup downloaded ✓',
    failed: 'Could not complete — nothing was deleted.',
    live: {
      trigger: 'Erase live data…',
      title: 'Erase live data?',
      body: 'This permanently deletes every asset, snapshot and transaction in the live dataset. The unsaved quote draft is cleared too — settings are kept. This cannot be undone.',
      action: 'Erase live data',
      success: 'Live data erased',
    },
    demo: {
      trigger: 'Reset demo data…',
      title: 'Reset demo data?',
      body: 'This replaces everything in the demo dataset with the built-in reference portfolio. Any changes you made in demo mode are lost.',
      action: 'Reset demo data',
      success: 'Demo data reset',
    },
  },
  nbu: {
    fetch: 'Fetch rate',
    fetching: 'Fetching…',
    title: 'Fetch the official National Bank of Ukraine rate',
    useIt: 'Use it',
    demoDisabled: 'Demo data — no requests leave the app.',
    failed: 'Could not reach the NBU rate directory — please try again.',
    applied: (rate: string) => `Rate set to ${rate}`,
    shown: (rate: string, date: string) => `NBU ${rate} for ${date}`,
    stale: ' · last known, not refreshed',
    none: (rate: string) => `No rate available — the stored ${rate} stays in effect.`,
  },
  settings: {
    sections: {
      portfolio: 'Portfolio',
      data: 'Data',
      automation: 'Automation',
      appearance: 'Appearance',
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
      helper: 'Mirrors the sidebar toggle — headline figures only.',
    },
    rate: {
      title: '₴/$ rate',
      helper:
        'Used for the $ view of headline figures. Tables always stay in ₴.',
      ariaLabel: '₴/$ rate',
      invalid: 'Enter a rate above 0.',
    },
    language: {
      title: 'Language',
      helper: 'Changes text, number and date formats.',
      ariaLabel: 'Interface language',
      // Each language NAMES ITSELF in its own script, in both dictionaries. A
      // switch that labels a language in a language you cannot read is the one
      // place where translating the label defeats its purpose (brief S2).
      uk: 'Українська',
      en: 'English',
    },
    dataset: {
      title: 'Dataset',
      helper:
        'Demo holds the built-in reference portfolio. Live starts empty and holds your real data. Switching reloads the app.',
    },
    backup: {
      title: 'Backup',
      helper:
        'Full JSON backup of the active dataset — quirenote-backup-<date>.json. Restore it with Import below.',
      button: 'Download backup',
    },
    dangerZone: {
      title: 'Danger zone',
      helper:
        'Both actions ask for a typed confirmation and offer a backup first.',
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
  },
  transaction: {
    title: 'Transaction',
    badge: 'Occasional',
    subtitle:
      'Deposits, buys, accruals, reinvests — opened only when something happened.',
    date: 'Date',
    type: 'Type',
    asset: 'Asset',
    assetPlaceholder: 'Select an asset…',
    newAssetOption: '+ New asset…',
    newAssetDetails: 'New asset details',
    amount: 'Amount, ₴',
    // A placeholder MODELS the input convention, so it follows the language
    // like any other figure (Contract 0) — the parity test caught this one
    // sharing the Ukrainian form with English.
    amountPlaceholder: '10,000.00',
    source: 'Source of funds',
    submit: 'Record transaction',
    invalid: 'Check the highlighted fields and try again.',
    recentTitle: 'Recent transactions',
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
      tax: 'Tax',
    },
    recentCoupon: 'Coupon',
    sources: {
      own: 'Own funds',
      accrual: 'Accrual',
      reinvest_reit: 'Reinvest (REIT)',
      reinvest_6475: 'Reinvest (…6475)',
    },
  },
  dailyQuotes: {
    fetch: {
      idle: 'Fetch quotes',
      loading: 'Fetching…',
      fetchedAt: (time: string) => `Fetched ${time}`,
      unlinked:
        'No Inzhur-linked assets yet — link one in Settings → Portfolio.',
      demo: 'Fetching is disabled in the demo dataset — switch to Live in Settings → Data.',
      feedAsOf: (date: string) => `Inzhur as of ${date}`,
      feedAt: (time: string) => `Inzhur ${time}`,
    },
    chip: {
      auto: 'auto',
      manual: 'manual',
      asOf: (date: string) => `as of ${date}`,
      suggested: 'suggested',
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
    yieldSinceStart: 'Yield since start:',
    yieldChartLink: 'Yield chart →',
    keepMyValue: 'Keep my value',
    dismissSuggestion: 'Dismiss suggestion',
    provenance: {
      auto: 'Filled from Inzhur (units × sell price).',
      manual: 'Typed by hand — fetch never overwrites it.',
      stale: 'From the last successful fetch — Inzhur was unreachable.',
      accrual: 'Filled from coupon accrual — a suggestion you accepted.',
      ghost: 'Suggested from coupon accrual — accept or type your own.',
    },
  },
  screen: {
    dailyQuotes: {
      title: 'Daily quotes',
      subtitle: 'The everyday ritual — nothing else competes with it.',
    },
    overview: {
      title: 'Overview',
      // ✎ the extension draws "Портфель одним поглядом · 27.07.2026 · курс 44,83 ₴/$"
      subtitle: (date: string, rate: string) =>
        `Portfolio at a glance · ${date} · rate ${rate} ₴/$`,
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
      subtitle:
        'Reference data per asset — created with a transaction, edited in Settings → Portfolio',
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
      subtitle: 'Current mix vs targets set in Settings → Portfolio',
    },
    settings: {
      title: 'Settings',
      subtitle: 'Preferences, data and portfolio configuration',
    },
  },
};

/** The shape both languages share. Derived, never written by hand. */
export type Dict = typeof en;

export const uk: Dict = {
  nav: {
    groupDailyEntry: 'Щоденний ввід',
    groupAnalytics: 'Аналітика',
    groupSettings: 'Налаштування',
    dailyQuotes: 'Щоденні котирування', // ✎
    overview: 'Огляд', // ✎
    balances: 'Баланси', // ✎
    payouts: 'Виплати', // ✎
    yield: 'Дохідність', // ✎
    attributes: 'Атрибути', // ✎
    seasonality: 'Сезонність', // ✎
    portfolio: 'Портфель', // ✎
    allocation: 'Розподіл', // ✎
    settings: 'Налаштування', // ✎
  },
  sidebar: {
    brandTagline: 'Інвест-трекер',
    totalCapital: 'Загальний капітал', // ✎
    // A dataset marker, not prose: it stays readable as the same token in both
    // languages, the way the ₴/$ segment labels do.
    demoBadge: 'DEMO',
    demoTitle:
      'Демонстраційні дані — еталонний набір. Перемкнути: Налаштування → Дані.',
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
        'Відновлення з резервної копії JSON. Імпорт замінює все в активному наборі — спершу ви переглядаєте підсумок, а страхувальна копія завантажується автоматично.',
      dropLine: 'Перетягніть сюди файл .json',
      dropHint: 'або скористайтеся «Обрати файл…»',
      dragLine: 'Відпустіть, щоб прочитати файл',
      choose: 'Обрати файл…',
      demoNote:
        'Ви в демонстраційному наборі — імпорт замінить еталонний портфель. «Скинути демонстраційні дані…» поверне його.',
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
      notABackup:
        'Це не копія Quirenote — у ній немає позначки «quirenote-backup».',
      newerFormat: (version: string) =>
        `Цю копію створила новіша версія застосунку (формат ${version}). Оновіть застосунок або експортуйте знову з тієї версії, що її створила.`,
      unsupportedFormat:
        'Версію формату цієї копії застосунок прочитати не може.',
    },
    issue: {
      unknownAssetId: (value: string) =>
        `невідомий ідентифікатор активу «${value}»`,
      unknownQuoteAsset: (value: string) =>
        `котирування невідомого активу «${value}»`,
      duplicateDate: (value: string) =>
        `дубльована дата ${value} (дата — первинний ключ)`,
      duplicateId: (value: string) =>
        `дубльований ідентифікатор «${value}» (ідентифікатор — первинний ключ)`,
      unknownKey: (value: string) => `неочікуване поле «${value}»`,
      expectedDatetime: 'очікується yyyy-MM-ddTHH:mm:ss без часового поясу',
      expectedDate: 'очікується дата yyyy-MM-dd',
      expectedPositiveAmount: 'очікується додатне число',
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
      title: (dataset: string) => `Імпорт у набір ${dataset}`,
      banner: (dataset: string) =>
        `Замінює все в наборі ${dataset}. Кожен актив, зріз і транзакцію буде видалено й відтворено з цього файлу. Скасувати це неможливо.`,
      bannerDemoSuffix:
        ' «Скинути демонстраційні дані…» згодом поверне еталонний портфель.',
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
      waiting: 'Очікування іншої вкладки…',
    },
    count: {
      assets: (n: number) => `${n} ${plural(n, 'актив', 'активи', 'активів')}`,
      snapshots: (n: number) => `${n} ${plural(n, 'зріз', 'зрізи', 'зрізів')}`,
      transactions: (n: number) =>
        `${n} ${plural(n, 'транзакція', 'транзакції', 'транзакцій')}`,
    },
    fileSubline: (name: string, date: string, time: string, dataset: string) =>
      `${name} · експортовано ${date} ${time} · з набору ${dataset}`,
    resultLine: (assets: string, snapshots: string, transactions: string) =>
      `Після імпорту: ${assets} · ${snapshots} · ${transactions}.`,
    settingsOptInHelper: (symbol: string, rate: string) =>
      `Замінює вашу валюту та курс ₴/$ (${symbol} · ${rate}). Набір даних, автоматизація та налаштування нагадувань лишаються недоторканими.`,
    safetyBackupDone: (name: string) =>
      `Страхувальну копію завантажено — ${name}.json.`,
    safetyBackupPending: (dataset: string, name: string) =>
      `Копія ваших поточних даних набору ${dataset} завантажиться автоматично, перш ніж щось буде замінено — ${name}.json.`,
    warning: {
      // Ukrainian joins with «і» and needs no verb agreement here: «немає»
      // governs the genitive and reads the same for one row or many, so this
      // sentence carries no singular/plural branch at all.
      rowsRemoved: (parts: string[], dataset: string) => {
        const subject =
          parts.length > 1
            ? `${parts.slice(0, -1).join(', ')} і ${parts.at(-1)}`
            : parts[0];
        return `${subject} у наборі ${dataset} немає в цьому файлі — їх буде вилучено.`;
      },
      noAssets: 'У файлі немає активів — після імпорту набір буде порожній.',
      noSnapshots: (current: number, dataset: string) =>
        `У файлі немає зрізів — усі ${current} збережених днів у наборі ${dataset} буде вилучено.`,
      otherDataset: (dataset: string) =>
        `Цей файл експортовано з набору ${dataset}.`,
      exportedLongAgo: (days: number, date: string) =>
        `Експортовано ${days} ${plural(days, 'день', 'дні', 'днів')} тому (${date}).`,
      newerDbVersion: (file: string, app: string) =>
        `Файл походить із новішої версії бази (${file} проти ${app}) — поля, яких застосунок не знає, ігноруються.`,
    },
    toast: {
      success: (assets: string, snapshots: string, transactions: string) =>
        `Дані імпортовано — ${assets}, ${snapshots}, ${transactions}.`,
      failed: 'Не вдалося імпортувати — нічого не змінено.',
      safetyFailed:
        'Не вдалося створити страхувальну копію — нічого не імпортовано.',
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
      kind: 'Вид',
      units: 'Одиниці',
      expectedPct: 'Очікувано, %',
      targetPct: 'Ціль, %',
      yieldType: 'Тип дохідності',
      payoutSchedule: 'Графік виплат',
      firstPurchase: 'Перша купівля',
      maturity: 'Погашення',
      nextCoupon: 'Наступний купон',
      couponAmount: 'Сума купона, ₴',
      reinvestPolicy: 'Політика реінвестування',
      linkToInzhur: 'Прив’язати до Inzhur',
      fixedCouponGroup: 'Фіксований купон',
    },
    message: {
      name: 'Назва обов’язкова.',
      code: 'Код — 1–2 літери.',
      expectedPct: 'Введіть відсоток.',
      targetPct: 'Введіть відсоток.',
      couponAmount: 'Введіть суму.',
      firstPurchase: 'Оберіть дату.',
      maturity: 'Оберіть дату.',
      nextCoupon: 'Оберіть дату.',
      refFund: 'Введіть ідентифікатор фонду.',
      refBond: 'Введіть ISIN облігації.',
      units: 'Введіть кількість одиниць.',
      summary: 'Перевірте підсвічені поля та спробуйте ще раз.',
    },
    picker: {
      placeholder: 'Обрати з Inzhur…',
      loading: 'Завантаження активів Inzhur…',
      failed: 'Не вдалося завантажити список — введіть вручну.',
      empty: 'Нічого такого виду в стрічці — введіть вручну.',
      toManual: 'Ввести вручну',
      toPicker: 'Обрати зі списку',
      demo: 'Живий список вимкнено в демо — введіть ідентифікатор або ISIN вручну.',
      helper:
        'Прив’язані активи оцінюються як одиниці × отримана ціна продажу — скористайтеся «Отримати котирування» на екрані котирувань.',
      fund: 'Фонд',
      bond: 'Облігація',
      fundManual: 'Ідентифікатор фонду',
      bondManual: 'ISIN облігації',
      matures: (date: string) => `погашення ${date}`,
    },
  },
  reminders: {
    quoteMissing: 'Котирувань сьогодні ще не збережено.',
    coupon: (asset: string, when: string, date: string) =>
      `${asset} платить купон ${when} (${date}).`,
    couponOverdue: (asset: string, date: string) =>
      `Купон ${asset} мав бути ${date} — запишіть його на екрані котирувань.`,
    maturesToday: (asset: string, date: string) =>
      `${asset} погашається сьогодні (${date}).`,
    matures: (asset: string, when: string, date: string) =>
      `${asset} погашається ${when} (${date}).`,
    // Ukrainian has THREE plural forms and English two, so a shared template
    // with a count spliced in would be wrong for 2, 3 and 4 — "2 днів" instead
    // of "2 дні". Each language owns its own rule.
    inDays: (days: number) =>
      `через ${days} ${plural(days, 'день', 'дні', 'днів')}`,
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
    dayOfMonth: (n: number) => `${n}-го`,
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
    share: 'Частка',
    snapshot: 'Зріз',
    cash: 'Готівка',
    totalUah: 'Разом, ₴',
    prev: 'Назад',
    next: 'Далі',
    date: 'Дата',
    type: 'Тип',
    amountUah: 'Сума, ₴',
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
      depositedReinvested: 'Внесено / Реінвестовано',
      freeCash: 'Вільні кошти',
      ledgerDrift:
        'Збережена готівка розходиться з реєстром транзакцій. Запишіть пропущений внесок чи виведення або виправте готівку у зрізі.',
    },
    portfolio: {
      bestPerformer: 'Найкращий',
      laggard: 'Відстаючий',
      incomeEngine: 'Джерело доходу',
      noQuotes: 'Котирувань ще немає.',
    },
    seasonality: {
      incomeAnchor: 'Якір доходу',
      couponSeason: 'Купонний сезон',
      quietStretch: 'Тиха смуга',
    },
    allocation: {
      currentVsTarget: 'Поточне проти цілі',
      rebalancePlan: 'План ребалансу',
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
      reinvestPolicy: 'Політика реінвестування',
    },
    prose: {
      totalPlusCash: (cash: string) => `Разом + готівка ${cash}`,
      capitalGainNote:
        'Приріст капіталу = вартість − вкладено (з реінвестованими виплатами). Дохід від виплат враховується в загальній дохідності на екрані «Дохідність».',
      inWeeks: (pct: string, weeks: number) => `${pct} за ${weeks} тиж.`,
      watchVsExpected: (pct: string, expected: string) =>
        `${pct} · проти очікуваних ${expected}`,
      ofReceivedIncome: (pct: string) => `${pct} отриманого доходу`,
      reinvestedInto: (amount: string) => `реінвестовано (${amount})`,
      toAccount: 'на рахунок',
      seasonalityNote:
        '* очікувано — спрогнозовано за датою наступного купона активу. Сірі стовпчики = звичайні дні коливання ціни без доходу.',
      yieldNote: (start: string) =>
        `Річна = загальна Δ, приведена до 365 днів від першої купівлі (${start}). Купони враховуються в Δ за нарахуванням. Загальна дохідність — чиста від податків і включає виплати. XIRR зважений за грошима та річний — за історії менш ніж рік вважайте його екстраполяцією.`,
      rebalanceIs: 'на',
      underTarget: (target: string) => `нижче за ціль ${target} — поповнити на`,
    },
    empty: {
      chart:
        'Зрізів ще немає — збережіть перше щоденне котирування, щоб побудувати графік.',
      table:
        'Зрізів ще немає — збережіть перше щоденне котирування, щоб заповнити таблицю.',
      rebalance:
        'Зрізів ще немає — збережіть перше щоденне котирування, щоб побачити підказку ребалансу.',
      allocation:
        'Зрізів ще немає — збережіть перше щоденне котирування, щоб побачити структуру розподілу.',
    },
  },
  assets: {
    edit: 'Змінити',
    delete: 'Видалити',
    add: 'Додати актив',
    empty: 'Активів ще немає — додайте перший, щоб почати облік.',
    deleteTitle: (name: string) => `Видалити ${name}?`,
    deleteAction: 'Видалити актив',
    cancel: 'Скасувати',
    addedToast: 'Актив додано',
    updatedToast: 'Актив оновлено',
    deletedToast: 'Актив видалено',
    saveFailed: 'Не вдалося зберегти актив — спробуйте ще раз.',
    deleteFailed: 'Не вдалося виконати — нічого не видалено.',
  },
  targets: {
    title: 'Цілі',
    save: 'Зберегти цілі',
    savedToast: 'Цілі збережено',
    saveFailed: 'Не вдалося зберегти цілі — спробуйте ще раз.',
    invalid: 'Введіть відсоток.',
    now: (pct: string) => `зараз ${pct}`,
  },
  datasetSwitch: { demo: 'Демо', live: 'Живий' },
  danger: {
    typeToConfirm: (word: string) => `Введіть ${word} для підтвердження`,
    backupFirst: 'Спершу завантажте копію',
    backupDone: 'Копію завантажено ✓',
    failed: 'Не вдалося виконати — нічого не видалено.',
    live: {
      trigger: 'Стерти живі дані…',
      title: 'Стерти живі дані?',
      body: 'Це назавжди видалить кожен актив, зріз і транзакцію в живому наборі. Незбережений чернетковий ввід котирувань також очищується — налаштування лишаються. Скасувати це неможливо.',
      action: 'Стерти живі дані',
      success: 'Живі дані стерто',
    },
    demo: {
      trigger: 'Скинути демонстраційні дані…',
      title: 'Скинути демонстраційні дані?',
      body: 'Це замінить усе в демонстраційному наборі вбудованим еталонним портфелем. Будь-які зміни, зроблені в демо-режимі, буде втрачено.',
      action: 'Скинути демонстраційні дані',
      success: 'Демонстраційні дані скинуто',
    },
  },
  nbu: {
    fetch: 'Отримати курс',
    fetching: 'Отримання…',
    title: 'Отримати офіційний курс Національного банку України',
    useIt: 'Застосувати',
    demoDisabled: 'Демонстраційні дані — жоден запит не залишає застосунок.',
    failed: 'Не вдалося звернутися до довідника курсів НБУ — спробуйте ще раз.',
    applied: (rate: string) => `Курс встановлено на ${rate}`,
    shown: (rate: string, date: string) => `НБУ ${rate} на ${date}`,
    stale: ' · останній відомий, не оновлювався',
    none: (rate: string) => `Курс недоступний — лишається збережений ${rate}.`,
  },
  settings: {
    sections: {
      portfolio: 'Портфель',
      data: 'Дані',
      automation: 'Автоматизація',
      appearance: 'Вигляд',
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
      helper: 'Дублює перемикач у бічній панелі — лише підсумкові показники.',
    },
    rate: {
      title: 'Курс ₴/$',
      helper:
        'Використовується для показу підсумків у $. Таблиці завжди лишаються в ₴.',
      ariaLabel: 'Курс ₴/$',
      invalid: 'Введіть курс, більший за 0.',
    },
    language: {
      title: 'Мова', // ✎
      helper: 'Змінює текст, формат чисел і дат.', // ✎
      ariaLabel: 'Мова інтерфейсу', // ✎
      uk: 'Українська', // ✎
      en: 'English', // ✎
    },
    dataset: {
      title: 'Набір даних',
      helper:
        'Демонстраційний містить вбудований еталонний портфель. Живий починається порожнім і містить ваші справжні дані. Перемикання перезавантажує застосунок.',
    },
    backup: {
      title: 'Резервна копія',
      helper:
        'Повна копія активного набору в JSON — quirenote-backup-<дата>.json. Відновлюється через Імпорт нижче.',
      button: 'Завантажити копію',
    },
    dangerZone: {
      title: 'Небезпечна зона',
      helper:
        'Обидві дії просять підтвердження вводом і спершу пропонують резервну копію.',
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
      dismissedHelper:
        'Відхилені банери лишаються прихованими, доки не мине їхня дата.',
      restore: 'Повернути відхилені',
      restoreWithCount: (count: number) => `Повернути відхилені (${count})`,
      restoredToast: 'Відхилені нагадування повернуто',
    },
    parse: {
      title: 'Останній розбір стрічки',
      helper:
        'Що останнє отримання з Inzhur змогло і не змогло прочитати. Записи, які не вдалося прочитати, пропускаються, а не вгадуються — решта стрічки завантажується.',
    },
  },
  transaction: {
    title: 'Транзакція',
    badge: 'Нерегулярно',
    subtitle:
      'Внески, купівлі, нарахування, реінвестиції — відкривається лише тоді, коли щось сталося.',
    date: 'Дата',
    type: 'Тип',
    asset: 'Актив',
    assetPlaceholder: 'Оберіть актив…',
    newAssetOption: '+ Новий актив…',
    newAssetDetails: 'Дані нового активу',
    amount: 'Сума, ₴',
    amountPlaceholder: '10 000,00',
    source: 'Джерело коштів',
    submit: 'Записати транзакцію',
    invalid: 'Перевірте підсвічені поля та спробуйте ще раз.',
    recentTitle: 'Останні транзакції',
    recentEmpty: 'Транзакцій ще немає.',
    types: {
      buy: 'Купівля',
      sell: 'Продаж',
      deposit: 'Внесок',
      withdrawal: 'Виведення',
      dividend_accrual: 'Нарахування дивідендів',
      interest_payout: 'Виплата відсотків',
      reinvest: 'Реінвестиція',
      redemption: 'Погашення',
      tax: 'Податок',
    },
    recentCoupon: 'Купон',
    sources: {
      own: 'Власні кошти',
      accrual: 'Нарахування',
      reinvest_reit: 'Реінвестиція (REIT)',
      reinvest_6475: 'Реінвестиція (…6475)',
    },
  },
  dailyQuotes: {
    fetch: {
      idle: 'Отримати котирування',
      loading: 'Отримання…', // ✎
      fetchedAt: (time: string) => `Отримано ${time}`, // ✎
      unlinked:
        'Ще немає активів, пов’язаних з Inzhur — прив’яжіть у Налаштуваннях → Портфель.',
      demo: 'Отримання вимкнено на демонстраційному наборі — перемкніть на Живий у Налаштуваннях → Дані.',
      feedAsOf: (date: string) => `Inzhur станом на ${date}`, // ✎
      feedAt: (time: string) => `Inzhur ${time}`,
    },
    chip: {
      auto: 'авто',
      manual: 'вручну',
      asOf: (date: string) => `станом на ${date}`, // ✎
      suggested: 'пропозиція',
    },
    yesterdayValue: (amount: string) => `${amount} учора`,
    useFetched: (value: string) => `Взяти отримане ${value}?`,
    useCached: (value: string, date: string) =>
      `Взяти ${value} (станом на ${date})?`,
    useSuggested: (value: string) => `Взяти запропоноване ${value}?`,
    priceDoesNotFit: (published: string, implied: string) =>
      `Ціна не відповідає ${published} у жоден день останніх двох тижнів — за сьогоднішнього розрахунку вона означала б ${implied}.`,
    filled: (n: number, total: number) => `${n} з ${total} заповнено`,
    dateLabel: 'Дата',
    // `зріз` for snapshot — the term the design session drafted in
    // "Зберегти зріз", and the one the Balances subtitle already uses.
    saveSnapshot: 'Зберегти зріз', // ✎
    copyYesterday: 'Скопіювати вчорашні',
    lastSaved: (when: string) => `Збережено ${when}`,
    notSavedYet: 'Ще не збережено',
    snapshotSavedToast: 'Зріз збережено',
    yieldSinceStart: 'Дохідність від початку:',
    yieldChartLink: 'Графік дохідності →',
    keepMyValue: 'Лишити моє значення',
    dismissSuggestion: 'Відхилити пропозицію',
    provenance: {
      auto: 'Заповнено з Inzhur (одиниці × ціна продажу).',
      manual: 'Введено вручну — отримання цього не перезаписує.',
      stale: 'З останнього вдалого отримання — Inzhur був недоступний.',
      accrual: 'Заповнено з нарахування купона — прийнята пропозиція.',
      ghost:
        'Запропоновано з нарахування купона — прийміть або введіть власне.',
    },
  },
  screen: {
    dailyQuotes: {
      title: 'Щоденні котирування',
      subtitle: 'Щоденний ритуал — ніщо інше з ним не конкурує.',
    },
    overview: {
      title: 'Огляд',
      subtitle: (date: string, rate: string) =>
        `Портфель одним поглядом · ${date} · курс ${rate} ₴/$`, // ✎
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
      subtitle:
        'Довідкові дані активу — створюються транзакцією, редагуються в Налаштуваннях → Портфель',
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
      subtitle: 'Поточна структура проти цілей із Налаштувань → Портфель',
    },
    settings: {
      title: 'Налаштування',
      subtitle: 'Уподобання, дані та конфігурація портфеля',
    },
  },
};
