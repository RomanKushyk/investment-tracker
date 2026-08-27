# Amplify plan — §0 live app, the deploy script and its tests

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) on 2026-08-26 (D95). **This plan is CLOSED — executed 2026-07-29, do not run it.** Much of it is the text that was written INTO `docs/reference/DEPLOYMENT.md` and D15; those are maintained, this is the record of what was drafted. A fence the split had cut was closed on 2026-08-27: the closer at line 12 and the opener at the end were removed, and Step 6's instruction gained a pointer. Nothing else was touched.

## 0. Live app

- URL: `https://dev.<appId>.amplifyapp.com`
- App ID: `<appId>` (public — it is part of the URL)
- Region: `eu-central-1`
- IAM role: `kubushka-github-deploy` (ARN held in the `AWS_ROLE_ARN` repo secret; the
  account ID stays out of this file deliberately)

Replace `<appId>` with the real ID in both lines. Leave the account ID out.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/DEPLOYMENT.md
git commit -m "docs: record the live Amplify app id and URL"
```

---

### Task 3: Deploy script

The create → upload → start → poll sequence, in one file so it reads as a unit and can be run by hand for recovery. Its error paths are testable locally without AWS — those are the tests.

**Files:**
- Create: `scripts/deploy-amplify.sh`
- Create: `scripts/README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scripts/deploy-amplify.sh [zip-path]`, default zip path `dist.zip`. Required env: `AMPLIFY_APP_ID`, `AMPLIFY_BRANCH`. Optional env: `POLL_TIMEOUT_SECONDS` (default `600`), `POLL_INTERVAL_SECONDS` (default `5`). Exit `0` only on job status `SUCCEED`. Task 4's workflow calls it exactly as `./scripts/deploy-amplify.sh dist.zip`.

- [ ] **Step 1: Write the failing tests**

These are the two error paths reachable without AWS credentials. Run them now, before the file exists:

```bash
# Test 1 — missing required env must fail loudly
env -u AMPLIFY_APP_ID -u AMPLIFY_BRANCH bash scripts/deploy-amplify.sh; echo "exit=$?"

# Test 2 — missing artifact must fail before any AWS call
AMPLIFY_APP_ID=dtest AMPLIFY_BRANCH=dev bash scripts/deploy-amplify.sh /nonexistent.zip; echo "exit=$?"
```

Expected now: both print `No such file or directory` and `exit=127`.
Expected after Step 3: Test 1 prints a message containing `AMPLIFY_APP_ID` and `exit=1`; Test 2 prints a message containing `artifact not found` and `exit=1`.

- [ ] **Step 2: Run the tests to confirm they fail**

Run both commands from Step 1.
Expected: `exit=127` for both — the script does not exist yet.

- [ ] **Step 3: Write `scripts/deploy-amplify.sh`**

```bash
#!/usr/bin/env bash
# Deploy a built artifact to an AWS Amplify Hosting manual-deploy branch.
# Amplify never builds this app; see docs/reference/DEPLOYMENT.md.
#
# Usage: AMPLIFY_APP_ID=d... AMPLIFY_BRANCH=dev ./scripts/deploy-amplify.sh [dist.zip]
set -euo pipefail

: "${AMPLIFY_APP_ID:?AMPLIFY_APP_ID is required}"
: "${AMPLIFY_BRANCH:?AMPLIFY_BRANCH is required}"

ZIP="${1:-dist.zip}"
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"

if [[ ! -f "$ZIP" ]]; then
  echo "artifact not found: $ZIP" >&2
  exit 1
fi

# The zip must hold the CONTENTS of the build output, not the output folder itself —
# otherwise Amplify serves "Access Denied" because the site root is never initialized.
echo "Creating deployment for $AMPLIFY_APP_ID/$AMPLIFY_BRANCH"
read -r JOB_ID UPLOAD_URL < <(
  aws amplify create-deployment \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$AMPLIFY_BRANCH" \
    --query '[jobId, zipUploadUrl]' \
    --output text
)
echo "Job $JOB_ID created; uploading $ZIP"

curl --fail --silent --show-error --upload-file "$ZIP" "$UPLOAD_URL"

aws amplify start-deployment \
  --app-id "$AMPLIFY_APP_ID" \
  --branch-name "$AMPLIFY_BRANCH" \
  --job-id "$JOB_ID" >/dev/null
echo "Job $JOB_ID started; waiting for it to finish"

# A green badge must mean "live", not "upload accepted" — so wait for the terminal status.
deadline=$(( SECONDS + POLL_TIMEOUT_SECONDS ))
while (( SECONDS < deadline )); do
  status=$(
    aws amplify get-job \
      --app-id "$AMPLIFY_APP_ID" \
      --branch-name "$AMPLIFY_BRANCH" \
      --job-id "$JOB_ID" \
      --query 'job.summary.status' \
      --output text
  )
  case "$status" in
    SUCCEED)
      echo "Deployment $JOB_ID succeeded"
      exit 0
      ;;
    FAILED | CANCELLED | CANCELLING)
      echo "Deployment $JOB_ID ended with status $status" >&2
      exit 1
      ;;
    *)
      echo "  status=$status"
      sleep "$POLL_INTERVAL_SECONDS"
      ;;
  esac
done

echo "Timed out after ${POLL_TIMEOUT_SECONDS}s waiting for job $JOB_ID" >&2
exit 1
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run both commands from Step 1.
Expected: Test 1 → stderr contains `AMPLIFY_APP_ID is required`, `exit=1`. Test 2 → stderr contains `artifact not found: /nonexistent.zip`, `exit=1`.

Also check syntax (no `shellcheck` on this machine):
```bash
bash -n scripts/deploy-amplify.sh; echo "syntax=$?"
```
Expected: `syntax=0`.

- [ ] **Step 5: Mark the script executable in git**

Windows checkouts do not carry the exec bit, so set it in the index explicitly or the runner cannot execute it:

```bash
git update-index --add --chmod=+x scripts/deploy-amplify.sh
git ls-files -s scripts/deploy-amplify.sh
```
Expected: mode `100755`.

- [ ] **Step 6: Create `scripts/README.md`**

The file as written opens [`05-scripts-readme-and-workflow.md`](05-scripts-readme-and-workflow.md), and ends where its next `- [ ] **Step` begins.
