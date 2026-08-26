# Deployment — the custom domain `quirenote.com`

> Moved **verbatim** from [`../DEPLOYMENT.md`](../DEPLOYMENT.md) on 2026-08-26 (D95). Done once, in 2026-08. Read it when DNS, the certificate or the prod/dev host split is in question.

## 0a. The custom domain — `quirenote.com`

Attached 2026-08-14 and verified the same day: `domainStatus AVAILABLE`, the apex
and `www` both answer HTTP 200 with the app, `/settings` and `/seasonality` return
the SPA shell rather than a 404 (so the §1.2 rewrite covers the new host too),
`http://` answers 301, and the certificate is `CN=*.quirenote.com` issued by
Amazon — the free ACM one Amplify manages. The Amplify URL keeps working; it is
now the second address, not the only one.

| Record | Name | Value |
|---|---|---|
| CNAME | `_f2385149c1ffac22fed755635002cfd6` | `_0dee0158e98c51da584fa5373ae2938c.jkddzztszm.acm-validations.aws` |
| CNAME | `@` (apex) | `d2jaridkoub072.cloudfront.net` |
| CNAME | `www` | `d2jaridkoub072.cloudfront.net` |

**Three things about this setup are decisions, not defaults.**

**DNS is Cloudflare's, not Route 53's (D40).** A hosted zone is $0.50/mo and on
the standing "no" list. Amplify supports third-party DNS and issues its own ACM
certificate for free, so the domain adds **no standing AWS charge** — attaching it
cost nothing and changes no line on the bill.

**Every HTTP record is PROXIED; everything else is DNS-only** (2026-08-14, D61).
The distinction is not a preference — it is what each record is for:

| Record | Mode | Why |
|---|---|---|
| `@`, `www`, `dev` | **proxied** | Cloudflare caches the immutable assets and absorbs floods before they become Amplify egress — and hides the origin. All three point at the same CloudFront distribution, so ONE grey record would publish the origin for all of them |
| `_f2385149…` (ACM validation) | dns-only | a proxied CNAME answers with Cloudflare's own addresses, so ACM never sees what it asked for and the certificate stops renewing — the trap the SES DKIM records already hit once |
| DKIM / MX / SPF / DMARC | dns-only | mail is not HTTP; Cloudflare cannot proxy it at all |

The apex is legal as a CNAME only because Cloudflare flattens it, and the zone's MX
records for Email Routing keep working beside it.

**Production is closed to crawlers until sign-up ships.** `public/robots.txt`
carries `User-agent: * / Disallow: /` — deliberately temporary, and the file says
so: until W7 gives the app a registration flow, anything indexed is a page a
visitor cannot act on. Delete the file when sign-up ships.

Before that file existed, proxying the zone made Cloudflare **synthesise** a
content-signals robots.txt — reservations about AI training and search input, with
no `User-agent` and no `Disallow`. It does that only when the origin has none:
shipping ours replaced it outright, verified after the deploy. The consequence is
worth carrying to W7 — **deleting `public/robots.txt` hands `/robots.txt` back to
Cloudflare's version**, so if those AI-training reservations are wanted once
crawling is allowed, they must be written into the shipped file instead.

The SPA rewrite (§1.2) excludes `txt`, so `/robots.txt` is served as a file rather
than swallowed into `index.html` — worth knowing, because the naive rewrite this
project rejected would have returned the app's HTML for it.

**Do not pair `Disallow` with `noindex`.** They cancel: a crawler forbidden to
fetch never sees the header or the meta tag telling it not to list. `Disallow` is
right here because nothing is indexed yet; if a URL ever does appear in a search
result, the fix is the opposite of a stricter rule — allow crawling and serve
`X-Robots-Tag: noindex`, which is the only instrument that removes an entry.

**Two TLS legs, both verified.** The visitor gets Cloudflare's Universal SSL
certificate (`CN=quirenote.com`, Google Trust Services, auto-renewed); Cloudflare
reaches CloudFront over the ACM `*.quirenote.com` certificate. The zone's SSL mode is
**Full (strict)** — it was plain `full` when the proxy went on, which is TLS to the
origin *without checking its certificate*. On `flexible` the proxy would have spoken
HTTP to a CloudFront that answers 301-to-HTTPS, and the apex would have served an
infinite redirect: **check the mode before proxying anything.**

**Two branches, two hosts.** The apex and `www` map to the Amplify branch `main`; `dev`
maps to the branch `dev`. All three DNS records point at the SAME CloudFront
distribution — Amplify routes by Host header, so a new subdomain never means a new
target, only a new record and one more entry in the association.

| Host | Amplify branch | Git branch |
|---|---|---|
| `quirenote.com`, `www.quirenote.com` | `main` (stage PRODUCTION) | `main` |
| `dev.quirenote.com` | `dev` (stage DEVELOPMENT) | `dev` |

**The split is the FRONTEND's only.** There is one AWS backend stack, and
`deploy-backend.yml` triggers on `dev` alone — so the backend a production visitor
would reach is whatever `dev` last deployed. That is harmless today because the app
does not talk to the backend at all (it is a standalone daily archiver), and it stops
being harmless at **W7**, when the migration wires the app to it. Whoever does W7 owns
the choice then: a second stack, a stage parameter, or a promotion step of its own.

`dev.quirenote.com` needs no separate certificate: Amplify issues `*.quirenote.com`
alongside the apex, so every subdomain added later is already covered.

**The dev branch is behind HTTP basic auth** (Amplify → branch `dev` → Access control),
enabled 2026-08-14. It covers the branch, not the host, so **both** `dev.quirenote.com` and
`dev.d17m4jf400my6.amplifyapp.com` answer 401 — verified. Crawlers get 401 too, which is the
indexing answer as well. The credentials live in the Amplify console; they are deliberately
not written down here, because this file is public. Production carries no auth and must not:
it is the published app.

**What protects production is not a gate but a pipeline.** `pnpm lint`, `pnpm format:check`
(added by A37), `pnpm test` and `pnpm build` all run *before* the job assumes any AWS credential, so a failing check cannot
deploy; the `prod` environment accepts only `main`; the role can touch nothing but two
Amplify branches; and the repo ruleset blocks force-pushes and deletions on `main` even for
the owner. The remaining exposure is egress cost, and that is watched by an existing $5
monthly budget with alerts at $1 / $3 actual and $5 forecast, plus a daily cost-anomaly
subscription — all confirmed to have a live email subscriber, not merely to exist.

