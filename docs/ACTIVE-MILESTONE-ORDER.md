# v2.0.0 — pick order

| # | Issue | Type | Title | Status |
|---|---|---|---|---|
| 1 | #347 | bug | The asset form's dates check the shape, not the calendar | **ready** |
| 2 | #349 | bug | An unlinked semiannual coupon steps six calendar months, where an OVDP pays every 182 days, and drifts past the 28th | **ready** |
| 3 | #351 | bug | The older-format refusal says the data model changed when only the reader narrowed | **ready** |
| 4 | #352 | bug | The import report codes an issue by its last field name, so a quote keyed date reads as a bad date | **ready** |
| 5 | #289 | enhancement | W7: core rebuilds the snapshot series from per-unit prices, reproducing today's figures | **ready** |
| 6 | #290 | enhancement | W7: the valuation joins the archive — prices carry forward, one point per observed day | after #289 |
| 7 | #333 | bug | /yield's curve ends before a sale dated after the last snapshot, so its last point is not the table's Δ | after #290 |
| 8 | #291 | enhancement | W7: the user stacks read the archive through a read-only role | **ready** |
| 9 | #292 | enhancement | W7: the archive reads a portfolio needs — sell observations in a window, and the capture digest | **ready** |
| 10 | #293 | enhancement | W7: the day's NBU rate is stored ahead, fetched on a miss, and read by /view | **ready** |
| 11 | #294 | enhancement | W7: one derivation identifier both builds carry | **ready** |
| 12 | #188 | enhancement | W7: GET /view and its validator | after #290, #291, #292, #293, #294 |
| 13 | #343 | enhancement | W7: /view hands core each linked bond's payment dates from bond_terms | after #188, #292 |
| 14 | #340 | bug | The coupon walk steps the calendar grid, not a linked bond's 182-day schedule, so a trade beside a coupon is judged on the wrong record date | after #343 |
| 15 | #58 | question | W7: which settings are account-scoped | **ready** |
| 16 | #190 | enhancement | W7: POST /mutations and GET /state | **ready** |
| 17 | #189 | enhancement | W7: /view/series and /view/balances, the two reads that do not collapse | after #188 |
| 18 | #191 | enhancement | W7: repository.ts is an HTTP client | after #188, #189, #190 |
| 19 | #344 | bug | The pending-change block and the row delta on / measure a draft against a position value, so a trade since the last quote reads as a move | after #290, #191 |
| 20 | #48 | epic | W7: the API cutover — derived reads, the mutation surface, and repository.ts over HTTP | after #289–#294, #188–#191, #343, #58 |
| 21 | #302 | enhancement | Security hardening: Cloudflare Web Analytics off | **ready** |
| 22 | #301 | enhancement | Security hardening: security headers fitted to the app, checked after every deploy | **ready** |
| 23 | #306 | enhancement | Security hardening: workflow actions pinned to commit SHAs, esbuild from the lockfile | **ready** |
| 24 | #313 | enhancement | Security hardening: install and test in a job that cannot mint the OIDC token | **ready** |
| 25 | #314 | enhancement | Security hardening: an execution role and boundary per environment, or an account per environment | **ready** |
| 26 | #307 | enhancement | Security hardening: Lambda logs name no address | **ready** |
| 27 | #310 | enhancement | Security hardening: CORS without the Amplify hosts, no default execute-api endpoint | **ready** |
| 28 | #300 | enhancement | Security hardening: a self-XSS warning in the console on the auth pages | **ready** |
| 29 | #303 | enhancement | Security hardening: a strict hash-based Content-Security-Policy, Report-Only then enforced | after #301, #302 |
| 30 | #297 | enhancement | Security hardening: Turnstile on /apply and /sign-in — brief and drawing [BRIEF] | **ready** |
| 31 | #298 | enhancement | Security hardening: /apply verified by Turnstile | after #297, #303 |
| 32 | #299 | enhancement | Security hardening: every /auth/start verified by Turnstile | after #297, #298 |
| 33 | #209 | enhancement | Backfill the sell series to 2026-04-23 from the owner's position values, by a stated divisor | **ready** |
| 34 | #131 | enhancement | W7: Archive operations on the API — diagnose, observe and importFundHistory for the super-admin | after #48 |
| 35 | #132 | enhancement | W7: Archive admin panel — coverage strips, repairs and the run list | after #131 |
| 36 | #238 | question | A statement that overruns alone is still a kill: the runner sets no statement_timeout, and none is recorded as rejected | **ready** |
| 37 | #236 | enhancement | The two provider publication times are restated across the tree, and one is a figure nothing pins | **ready** |
| 38 | #247 | enhancement | The archive schema is written twice and nothing holds the copies together | **ready** |
| 39 | #250 | question | An internal newline in a stack Description passes the guard, and nothing measures what CloudFormation does with it | **ready** |
| 40 | #318 | enhancement | Замінити "ви вийшли з системи" | **ready** |
| 41 | #321 | enhancement | cognito-free-tier warns at 80% of the allowance, before the bill | **ready** |
| 42 | #319 | epic | The Cognito usage budget alerts only with the bill, and nothing confirms its mail arrives | after #321 |
| 43 | #285 | enhancement | Auth surface: a signed-out visitor finds «Увійти» in the account slot, and sees only the demo | **ready** |
| 44 | #52 | enhancement | Resubmit SES production access once sign-up is reachable [A11] | after #285, and `main` promoted |
| 45 | #311 | enhancement | Security hardening: HSTS raised from a week to a year | after #301 has run a week on prod |
| 46 | #44 | enhancement | W7: Passkey-first onboarding and SES email delivery | after #52 |
| 47 | #296 | epic | Security hardening: bot checks, headers and CSP, and the leaks the audit found | after #297–#303, #306, #307, #310, #311, #313, #314 |
| 48 | #41 | epic | B3 migration: auth, user schema, repository over HTTP [W7] | after #44, #48, #52, #131, #132, #137, #285 |
