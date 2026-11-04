#!/bin/bash
# Code-only redeploy of the gloop-learn Lambda: zips infra/learn/{index,handler}.mjs
# and updates the existing function. No IAM, table or URL changes, so it needs
# only lambda:UpdateFunctionCode + lambda:GetFunction (not setup.sh's IAM rights).
set -euo pipefail
cd "$(dirname "$0")/../.."

REGION="${AWS_REGION:-us-east-1}"
FN=gloop-learn

ZIP=$(mktemp -t gloop-learn.XXXXXX).zip
trap 'rm -f "$ZIP"' EXIT
zip -q -j "$ZIP" infra/learn/index.mjs infra/learn/handler.mjs

aws lambda update-function-code \
  --function-name "$FN" --region "$REGION" \
  --zip-file "fileb://${ZIP}" --query LastModified --output text
aws lambda wait function-updated --function-name "$FN" --region "$REGION"
echo "gloop-learn code updated."
