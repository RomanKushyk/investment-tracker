# Amplify plan — the verification commands

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) on 2026-08-26 (D95). **This plan is CLOSED — executed 2026-07-29, do not run it.** **One link was re-pointed on the move** — the `DEPLOYMENT.md` reference gained a `../` for the extra folder level; nothing else changed. Much of it is the text that was written INTO `docs/reference/DEPLOYMENT.md` and D15; those are maintained, this is the record of what was drafted. A fence the split had cut was closed on 2026-08-27: the commands below regained the `bash` opener the split had left in the previous file. Nothing else was touched.

```bash
# 1. Root loads
curl -sS -o /dev/null -w 'root=%{http_code}\n' "$BASE/"

# 2. Deep link loads the app rather than 404 — proves the SPA 200 rewrite
curl -sS -o /dev/null -w 'deep=%{http_code}\n' "$BASE/overview"
curl -sS "$BASE/overview" | grep -c 'id="root"'

# 3. Cache headers
curl -sSI "$BASE/index.html" | grep -i '^cache-control'
```

Expected: `root=200`; `deep=200` and the grep count is `1` (the deep link returns the SPA shell, not a 404 page); `Cache-Control: no-cache` on `index.html`.

Then find a hashed asset and check its header:
```bash
ASSET=$(curl -sS "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
curl -sSI "$BASE$ASSET" | grep -i '^cache-control'
```
Expected: `public, max-age=31536000, immutable`.

If the asset header is missing, the `/assets/**` custom-header pattern did not save — re-check `docs/reference/DEPLOYMENT.md` §1.3.

---

### Task 5: Badge, live URL, and the manual verification sweep

**Files:**
- Modify: `README.md` (root, under the H1)
- Modify: `navigation-map.md`

**Interfaces:**
- Consumes: the `Deploy` workflow at `.github/workflows/deploy.yml` (Task 4); the live URL from `docs/reference/DEPLOYMENT.md` §0 (Task 2).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the badge and live link to root `README.md`**

Insert directly after the H1 line `# Handoff: Kubushka — Investment Portfolio Tracker`, as its own paragraph before the existing "Implementation package…" line:

```markdown
[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml)

**Live:** https://dev.<appId>.amplifyapp.com · deploy runbook: [`docs/reference/DEPLOYMENT.md`](../../../reference/DEPLOYMENT.md)
```

Replace `<appId>` with the real ID. GitHub's native workflow badge is used rather than shields.io — no third party, and it works because the repo is public.

- [ ] **Step 2: Verify the badge resolves and is green**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev'
curl -sS 'https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev' | grep -o 'passing\|failing\|no status'
```
Expected: `200`, and `passing`. `no status` means the workflow file name or branch in the URL does not match reality.

- [ ] **Step 3: Note the deployed target in `navigation-map.md`**

Add to the intro/preamble section, before the per-route table:

```markdown
Checkpoints can be run against the deployed site as well as `localhost` — see
`docs/reference/DEPLOYMENT.md` §0 for the URL. Run them in a **fresh browser profile** when
verifying a deploy: the seed only loads into an empty IndexedDB, so an existing profile
will show your own data instead of the pinned values.
```

- [ ] **Step 4: Run the manual verification sweep against the deployed URL**

In a **fresh browser profile** (no existing IndexedDB for the host), open the live URL and confirm the spec's §8 criteria that automation cannot check:

1. The dashboard (Daily quotes) renders as the landing view.
2. Sidebar version badge reads **`v1.1.0`** — matches `package.json`.
3. Walk the `navigation-map.md` per-route checkpoints; the seed-pinned expected values match on each of `/`, `/overview`, `/balances`, `/payouts`, `/yield`, `/attributes`, `/seasonality`, `/portfolio`, `/allocation`. This proves derivation-from-seed works off a cold IndexedDB in production.
4. Reload while on a non-root route — it must stay on that route, not 404.

Report any mismatch as a finding; do not silently adjust `navigation-map.md` expected values to match production.

- [ ] **Step 5: Verify the repo still lints and typechecks**

```bash
pnpm lint && pnpm typecheck
```
Expected: both pass.

- [ ] **Step 6: Commit and push**

```bash
git add README.md navigation-map.md
git commit -m "docs: add deploy badge and live URL

- native GitHub Actions workflow badge for deploy.yml on dev
- link the live site and the deploy runbook from the root README
- navigation-map: checkpoints can run against the deployed URL (fresh profile)"
git push origin dev
```

- [ ] **Step 7: Clean up the feature branch**

Only after the badge is confirmed green and the sweep passed:

```bash
git branch -d infra/amplify-hybrid-deploy
git push origin --delete infra/amplify-hybrid-deploy
```

---
