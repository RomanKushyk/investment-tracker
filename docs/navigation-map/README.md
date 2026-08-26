# navigation-map/ — the route checkpoints

The map itself is [`../../navigation-map.md`](../../navigation-map.md) and it is
the entry point: how to connect and reset, the route index with its Status
column, the global shell, the cross-cutting recipes and the known deliberate
deviations from the design reference (D5). Only the per-route checkpoints live
here, moved **verbatim** on 2026-08-26 (D95).

| File | Holds |
|---|---|
| [`mobile-shell.md`](mobile-shell.md) | The whole below-768px shell — header bar, drawer, record cards, quotes, overlays, charts |
| [`routes-1.md`](routes-1.md) | `/` · `/transactions` · `/overview` (and under a period) · `/balances` · `/payouts` |
| [`routes-2.md`](routes-2.md) | `/yield` (and under a period) · `/attributes` · `/seasonality` · `/portfolio` · `/allocation` · `/settings` |

**Do not run a checkpoint from a stale dataset.** Every expected figure is the D5
seed; connecting and resetting is step one in the map and it is not optional.
**Update the route's Status row in the map and the checkpoints here together** —
a Status that says a route is verified while its checkpoints describe an older
screen is worse than no map.
