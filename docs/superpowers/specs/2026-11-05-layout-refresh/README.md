# The layout refresh: the signed spec

The layout refresh moves Quirenote toward a floating shell, glass surfaces over an ambient glow of the asset hues, and a dock at 360, keeping the parchment and copper palette. It was decided wave by wave, each wave a set of rendered variants that the owner picked from. This folder is its written record: one file per area, holding the signed picks with their values, the rejected options with their reasons, what research settled, and what an implementation must check. Beside them, `renders/` holds the signed frames.

Epic #611 makes this folder the only design reference. Until #621 retires `design/`, *Design pipeline* in `docs/DECISIONS.md` still names the old sheets as the reference.

**What is in a file and what is not.** Signed values are spec: sizes, radii, tokens, opacities, timings and copy. Readings measured on the renders, such as contrast ratios, are not; a figure lives in a test. Where a later wave overturns an earlier one, the later wave's file says so.

**Provenance.** Waves 1–14 were signed on a private review page ([part 1](https://claude.ai/artifact/2885hXysnZCFidJP5gtRoR)), which also holds every round's variants. The frames here are copied unchanged from its «Final» blocks; wave 4 has no «Final», so its frames are those of its pick, T2.

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

Each file shows all of its wave's frames. Waves 15–24 follow in #613.
