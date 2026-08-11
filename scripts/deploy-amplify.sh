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
deadline=$((SECONDS + POLL_TIMEOUT_SECONDS))
while ((SECONDS < deadline)); do
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
