# The layout refresh: the signed spec

The layout refresh moves Quirenote toward a floating shell, glass surfaces over an ambient glow of the asset hues, and a dock at 360, keeping the parchment and copper palette. It was decided wave by wave, each wave a set of rendered variants that the owner picked from. This folder is its written record: one file per area, holding the signed picks with their values, the rejected options with their reasons, what research settled, and what an implementation must check. Beside them, `renders/` holds the signed frames.

This folder is the only design reference (*Design pipeline* in `docs/DECISIONS.md`). A new or amended area file joins the wave table below with its renders; a signed line is overturned by a later file, never rewritten.

**What is in a file and what is not.** Signed values are spec: sizes, radii, tokens, opacities, timings and copy. Readings measured on the renders, such as contrast ratios, are not; a figure lives in a test. Where a later wave overturns an earlier one, the later wave's file says so, and the overturned line in the earlier file points to it.

**«Перенесено».** Where a file ends with this section, it holds the rules of the retired design sheets (named in these files as `parchment-5h`, `mobile` and the like, readable in [`design/` at the last commit that held it](https://github.com/RomanKushyk/investment-tracker/tree/40aba902b95a0d8edc2c46f39c73f4acfe869eb4/design)) that, once checked, no code, test or decision recorded. Each section names the area whose sheets it covers.

**Provenance.** The waves were signed on two private review pages, which also hold every round's variants: [part 1](https://claude.ai/artifact/2885hXysnZCFidJP5gtRoR) for waves 1–14 and [part 2](https://claude.ai/artifact/Bc8Yh9sY1EnR6hE9zS4ZMw) for waves 15–24. The frames here are copied unchanged from each wave's «Final» block, with these exceptions:
- Waves 4 and 23 have no «Final» frame, so their frames are those of their picks.
- Wave 19 was signed on players. Its frames are their end states: the arrived screens from the «Final», and the placeholder states from its slow-read player at 1440 and from Step 2's player at 360.
- Wave 21 adds the step frames its «Final» names (the feet, the rail and the counts) and its hover label's (T1). Wave 22 adds the nested container its «Final» names.
- Wave 25 adds each round's sheet, its variants side by side, beside the five composite frames of its «Final».
- Wave 26 adds each round's sheet beside the six composite frames of its «Final»; its motion is shown as stills, and the review page plays it.

A third private review page, [part 3](https://claude.ai/artifact/TgGrhxuQGwSY1MBWxdz1os), holds wave 25, with every round's variants.
Wave 26 is on the same page, above wave 25.

## Waves

| Wave | Area | File | Renders |
| --- | --- | --- | --- |
| 1 | The shell: the floating sidebar, the page anatomy, the figures and the dock | [shell.md](shell.md) | [/overview, 1440, dark](renders/fin-o-1440-dark.jpeg) |
| 2 | Glass on the content cards, the sidebar and the dock | [glass.md](glass.md) | [/overview, 1440, dark](renders/w2f-o-1440-dark.jpeg) |
| 3 | Charts: anatomy, series identity, allocation and bars | [charts.md](charts.md) | [/yield, 1440, dark](renders/w3f-yield-1440-dark.jpeg) |
| 4 | The glass material, revised | [glass.md](glass.md) | [T2, dark](renders/w4-T2-dark.jpeg) |
| 5 | The 360 bar, the «Ще» sheet and the docks | [mobile-bar-and-sheet.md](mobile-bar-and-sheet.md) | [the user's dock, dark](renders/w5f-user-dark.jpeg) |
| 6 | Tables and ledgers | [tables.md](tables.md) | [/balances, 1440, dark](renders/w6f-balances-1440-dark.jpeg) |
| 7 | The «Атрибути» asset item | [attributes-item.md](attributes-item.md) | [1440, dark](renders/w7f-1440-dark.jpeg) |
| 8 | Forms and dialogs | [forms-and-dialogs.md](forms-and-dialogs.md) | [/transactions, 1440, dark](renders/w8f-tx-1440-dark.jpeg) |
| 9 | Sign-in and the signed-out pages | [signed-out.md](signed-out.md) | [the address step, 1440, dark](renders/w9f-address-1440-dark.jpeg) |
| 10 | The super-admin pages | [super-admin.md](super-admin.md) | [«Архів цін», 1440, dark](renders/w10f-read-1440-dark.jpeg) |
| 11 | Notices and toasts | [notices-and-toasts.md](notices-and-toasts.md) | [the reminders card, 1440, dark](renders/w11f-strip-1440-dark.jpeg) |
| 12 | Empty, loading and error | [empty-loading-error.md](empty-loading-error.md) | [the first look, 1440, dark](renders/w12f-first-1440-dark.jpeg) |
| 13 | Privacy and Terms | [legal.md](legal.md) | [/privacy, 1440](renders/w13f-privacy-1440.jpeg) |
| 14 | Telling the /yield lines apart | [yield-series-shapes.md](yield-series-shapes.md) | [the «Разом» chart](renders/w14f.jpeg) |
| 15 | The glass in the light theme | [glass-light.md](glass-light.md) | [light beside dark](renders/w15f.jpeg) |
| 16 | Dialog buttons, dialog and field radii | [dialog-buttons-and-radii.md](dialog-buttons-and-radii.md) | [360, 1440 and the radii](renders/w16f.jpeg) |
| 17 | Interactive controls | [controls.md](controls.md) | [Settings, popovers and the focus walk](renders/w17g.jpeg) |
| 18 | Typography and numbers | [type.md](type.md) | [/overview, Settings and the tables](renders/w18f.jpeg) |
| 19 | Page transitions and load motion | [motion.md](motion.md) | [«Баланси» arrived, 1440, dark](renders/w19-dark-d-new.jpeg) |
| 20 | The asset palette and its selector | [palette.md](palette.md) | [eight assets, dark](renders/w20s1-C3-dark.jpeg) |
| 21 | The rail, the collapsed shell and the account foot | [rail-and-account-foot.md](rail-and-account-foot.md) | [1440, 1024 and 768](renders/w21f.jpeg) |
| 22 | Controls and overlays the refresh never drew | [controls-and-overlays.md](controls-and-overlays.md) | [«Щоденні котирування»](renders/w22f.jpeg) |
| 23 | Loading shapes, compositions and the sweep | [loading-and-compositions.md](loading-and-compositions.md) | [the placeholders](renders/w23s1-L2.jpeg) |
| 24 | The logo | [brand.md](brand.md) | [every site](renders/w24f.jpeg) |
| 25 | Open values: charts, tables, type and the palette | [open-values-charts-type.md](open-values-charts-type.md) | [/yield, 1440 and 360](renders/w25f1.jpeg) |
| 26 | Open values: the shell, dialogs, motion, the overview and controls | [open-values-shell-controls.md](open-values-shell-controls.md) | [the shell, 1440 and 360](renders/w26f1.jpeg) |

Each file shows all of its wave's frames.
