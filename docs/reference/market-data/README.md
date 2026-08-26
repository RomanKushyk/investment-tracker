# market-data/ — the per-source detail

The map itself is [`../MARKET-DATA-SOURCES.md`](../MARKET-DATA-SOURCES.md): the
one-line summary, the closed list, **the rules this leaves us with**, and what it
does not give. Only the six source write-ups live here, moved **verbatim** on
2026-08-26 (D95).

| File | Holds |
|---|---|
| [`sources-1-3.md`](sources-1-3.md) | §1 SMIDA · §2 stockmarket.gov.ua · §3 UAIB |
| [`sources-4-6.md`](sources-4-6.md) | §4 ПФТС · §5 data.gov.ua · §6 Minfin |

Two things a reader must carry in from the index before using anything here:
**egress matters and is labelled per source** — measurements were taken from a
non-Ukrainian edge, not from `eu-north-1` where the backend runs — and **§1's
permission question is closed: D86 rules that our code does not fetch SMIDA,
categorically.** Reading a page by hand is not what that governs.
