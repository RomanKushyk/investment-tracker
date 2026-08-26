# Ukrainian market data sources — what is machine-readable, and on what terms

Measured **2026-08-24**, no account used anywhere. Written because finding out
which of these exist at all was the expensive part, and because the most
authoritative host is misleading in two directions at once: `stockmarket.gov.ua`
answers `200` over five-year-old data, and answers `521` while being perfectly
healthy, depending on where you ask from.

**Egress matters here and is labelled per source.** Measurements were taken from
a non-Ukrainian network (Cloudflare edge `VIE`, Vienna) and, where that
disagreed, re-taken through a browser in Kyiv. **Nothing here was probed from
`eu-north-1`**, where our backend runs (`infra/README.md`) — so where this file
reasons about the daily job it is inferring from one non-Ukrainian egress to
another, and says so. Probe from the Lambda before depending on either result.

**Scope.** The *external* map only — what the market publishes about itself. Not
our archive (`infra/README.md`), and not the provider we already capture:
Inzhur's own public surface is in
[`INZHUR-PUBLIC-SURFACE.md`](INZHUR-PUBLIC-SURFACE.md), and the price files it publishes
are in [`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md).

## The one-line summary

**No Ukrainian investment company publishes a documented data API.** Of 47
companies surveyed, one serves an open working REST endpoint and it is
undocumented. Everything machine-readable sits one floor up — the regulator's
agency, the industry association, the exchange.
## The six sources, one file each pair

**Split 2026-08-26 (D95)** — the per-source detail moved **verbatim** into
[`market-data/`](market-data/); the summary above and the rules below, which are
what this file is consulted for, stayed. Numbering is unchanged.

| File | Holds |
|---|---|
| [`market-data/sources-1-3.md`](market-data/sources-1-3.md) | §1 SMIDA (incl. the D82 correction and **D86: we do not fetch it**) · §2 stockmarket.gov.ua · §3 UAIB |
| [`market-data/sources-4-6.md`](market-data/sources-4-6.md) | §4 ПФТС · §5 data.gov.ua · §6 Minfin |

## Closed, and why

| Source | State |
|---|---|
| **ЄДРІСІ** — register of collective investment institutions | Extract issued only on written application with proof of payment. **Zero datasets on data.gov.ua.** The fund register is not open data |
| **csd.ua** — Національний депозитарій | `robots.txt`: `User-agent: *` / `Disallow: /`, no exceptions. Its announced "API для емітентів" is a filing cabinet for issuers describing themselves, not a read channel |
| **ux.ua** — Українська біржа | Cloudflare bot protection: `403` from outside, and from Kyiv the challenge resolves into an error page. Unusable automatically, and the signal is unambiguous — **do not automate it** |
| **smida.gov.ua** HTML pages | `Disallow: /`; Googlebot permitted only `/db/prof/`. The API in §1 is a separate question, and CLOSED — D86: we do not fetch it |
| **api.firekit.space** | No docs, no open endpoint; `robots.txt` disallows `/api/` |
| **binaryx.com** | `robots.txt` allows GPTBot on content and disallows `/api/` — a deliberate split worth copying |

## What companies say about reuse, machine-readably

A minority answered in `robots.txt` directly, and the answers point opposite
ways. **Read it first: one request, and for some of them it is the only place
they state a position at all.**

| Signal | Who |
|---|---|
| `search=yes, ai-input=yes, ai-train=yes` | `deniz-estate.com` — full permission |
| `search=yes, ai-train=no, use=reference` **plus named `Disallow` for ClaudeBot, CCBot, Bytespider, Amazonbot, Applebot-Extended** | `toloka.vc`, `ribasinvest.com` — explicit refusal |
| Cloudflare boilerplate comment only, no active directive | `bond.ua`, `btc-broker.com` — neither granted nor restricted, per the policy's own wording |

## Rules this leaves us with

1. **Prefer the regulator's agency over company sites** — SMIDA's feed and the
   CC-BY datasets pair a stated licence with a stable schema, which no company
   site here does. UAIB and Minfin state terms too (rule 5); what they lack is
   the schema stability, being HTML pages rather than a published contract.
   **SMIDA is not polled, by ruling — D86.** Its being alive (D82) and our
   fetching it are two different facts, and the second is now settled: no.
2. **Monitor `time_max`, not the status code.** stockmarket.gov.ua answers `200`
   with data from 2019–2021. Freshness is a field in the payload; assert on it.
3. **Probe from the network the code runs on.** A `521` from `eu-north-1` was a
   working service from Kyiv — and stockmarket.gov.ua is therefore manual-only
   for us, while SMIDA is reachable from both.
4. **Never merge bases.** Fund NAV, a dealer's buy/sell quote and НБУ fair value
   are three different definitions of "price" (D26, D27, and D74 for why the
   conversion is refused). Same-day divergence around 0.9 % looks like noise and
   is not.
5. **Attribution is a licence condition, not a courtesy.** stockmarket.gov.ua and
   everything in the CKAN catalogue are **CC-BY**; SMIDA's footer and UAIB and
   Minfin all require a link. Every source in this file that permits reuse
   requires naming it — there is no exception to carve out.
6. **Read `robots.txt` before the first fetch.** A named `Disallow` or
   `ai-train=no` is final. **Silence is not consent** — under the Content Signals
   wording an operator who states nothing "neither grants nor restricts", which
   leaves the question open rather than settled in the collector's favour, and
   that applies to `pfts.org.ua` as much as to anyone.

## What this does NOT give

**A NAV or unit-price series for Ukrainian funds.** Structural, not accidental:
disclosure is retrievable as *documents* through SMIDA, the fund register is sold
per extract, UAIB's daily table covers two funds, and the exchange prices only
what is listed — which excludes every fund we hold. Any per-fund series still has
to be assembled provider by provider, which is why this project runs its own
archive (D72) and why
[`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md) had to derive what it derived.
