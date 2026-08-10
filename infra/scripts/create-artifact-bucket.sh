#!/usr/bin/env bash
# Create the S3 bucket that `sam deploy` uploads Lambda bundles to.
#
# One-time bootstrap. Run it in AWS CloudShell, which already has credentials —
# there are deliberately none on the development machine (see infra/README.md).
#
# Usage:  bash infra/scripts/create-artifact-bucket.sh
#         REGION=eu-west-1 bash infra/scripts/create-artifact-bucket.sh
#
# Idempotent: re-running against an existing bucket re-applies the settings and
# exits cleanly, so it is safe to run again if a later step failed.
set -euo pipefail

REGION="${REGION:-eu-north-1}"

# Derived, never hardcoded. This repo is PUBLIC, and docs/DEPLOYMENT.md keeps the
# account ID out of tracked files on purpose — which is also why the deploy role
# ARN lives in a GitHub secret rather than in the workflow.
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="kubushka-sam-artifacts-${ACCOUNT_ID}"

echo "bucket: ${BUCKET}"
echo "region: ${REGION}"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "-> already exists, re-applying settings"
else
  # eu-north-1 requires LocationConstraint; only us-east-1 omits it, and getting
  # this wrong silently creates the bucket in the wrong region — which then fails
  # at `sam deploy`, because the artifact bucket must match the stack's region.
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=${REGION}"
  echo "-> created"
fi

# Build artifacts are never public. Set explicitly rather than trusting the
# account default, which can be changed elsewhere.
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Without this, every bundle ever uploaded (~330 KB per deploy) is kept forever.
# It is the only line in the stack that grows on its own and never shrinks.
# The 7-day abort rule cleans up interrupted uploads, which are billable but
# invisible in the console object list.
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-artifacts",
      "Status": "Enabled",
      "Filter": {},
      "Expiration": { "Days": 30 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }]
  }'

# Deliberately NOT enabled: versioning (it would retain every old bundle and
# fight the rule above) and SSE-KMS with a customer-managed key ($1/month per
# key, against a ~$0.02/month baseline). The default SSE-S3 encryption is free.

echo
echo "verifying:"
aws s3api get-bucket-location --bucket "$BUCKET" --output text
aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --query 'Rules[0].[ID,Status,Expiration.Days]' --output text
echo
echo "done — ${BUCKET} ready in ${REGION}"
