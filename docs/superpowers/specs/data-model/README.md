# Data model — the long sections

The document itself is [`../2026-08-04-data-model.md`](../2026-08-04-data-model.md) and it stays the entry point. These sections moved
**verbatim** on 2026-08-26 (D95) so no file exceeds 200 lines; nothing was summarised.

**The spec is live and load-bearing.** The observation key is **immutable on DSQL (D30)**: changing it is a DROP/CREATE of a live archive, not a migration. Read `price-archive.md` before proposing any column.

| File | Holds |
|---|---|
| [`ledger.md`](ledger.md) | The ledger |
| [`operating-capture.md`](operating-capture.md) | Operating the capture — what the super-admin sees and controls |
| [`price-archive.md`](price-archive.md) | Price archive |
| [`sources.md`](sources.md) | Sources |
