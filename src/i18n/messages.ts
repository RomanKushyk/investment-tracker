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
      unlinked: 'No Inzhur-linked assets yet — link one in Settings → Portfolio.',
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
      subtitle: (date: string, rate: string) => `Portfolio at a glance · ${date} · rate ${rate} ₴/$`,
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
      subtitle: 'Reference data per asset — created with a transaction, edited in Settings → Portfolio',
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
    demoTitle: 'Демонстраційні дані — еталонний набір. Перемкнути: Налаштування → Дані.',
  },
  transaction: {
    title: 'Транзакція',
    badge: 'Нерегулярно',
    subtitle: 'Внески, купівлі, нарахування, реінвестиції — відкривається лише тоді, коли щось сталося.',
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
      unlinked: 'Ще немає активів, пов’язаних з Inzhur — прив’яжіть у Налаштуваннях → Портфель.',
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
    useCached: (value: string, date: string) => `Взяти ${value} (станом на ${date})?`,
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
      ghost: 'Запропоновано з нарахування купона — прийміть або введіть власне.',
    },
  },
  screen: {
    dailyQuotes: {
      title: 'Щоденні котирування',
      subtitle: 'Щоденний ритуал — ніщо інше з ним не конкурує.',
    },
    overview: {
      title: 'Огляд',
      subtitle: (date: string, rate: string) => `Портфель одним поглядом · ${date} · курс ${rate} ₴/$`, // ✎
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
      subtitle: 'Довідкові дані активу — створюються транзакцією, редагуються в Налаштуваннях → Портфель',
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
