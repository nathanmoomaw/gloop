#!/bin/bash
# Idempotent setup/deploy for gloop's learn-entry store:
#   1. DynamoDB table gloop-learn (day HASH, id RANGE, on-demand)
#   2. IAM role gloop-learn-lambda-role with least-privilege table write policy
#   3. Lambda function gloop-learn (nodejs22.x) from infra/learn/{index,handler}.mjs
#   4. Reserved concurrency = 10 to bound worst-case spend
#   5. Public Function URL + both invoke permissions
#   6. Save Function URL to GitHub Actions secret LEARN_URL on nathanmoomaw/gloop
#   7. Re-run latest dev/v0 workflow so the bundle picks up VITE_LEARN_URL
#   8. Print URL and pull command
set -euo pipefail
cd "$(dirname "$0")/../.."

REGION="${AWS_REGION:-us-east-1}"
TABLE=gloop-learn
FN=gloop-learn
ROLE=gloop-learn-lambda-role
GLOOP_REPO=nathanmoomaw/gloop

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE}"
TABLE_ARN="arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE}"

# --- 1. DynamoDB table ---
if ! aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "Creating DynamoDB table $TABLE..."
  aws dynamodb create-table \
    --table-name "$TABLE" \
    --region "$REGION" \
    --attribute-definitions AttributeName=day,AttributeType=S AttributeName=id,AttributeType=S \
    --key-schema AttributeName=day,KeyType=HASH AttributeName=id,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi

# --- 2. IAM role ---
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "Creating IAM role $ROLE..."
  aws iam create-role \
    --role-name "$ROLE" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]
    }' >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
  echo "Waiting for IAM role to propagate..."
  sleep 10
fi

aws iam put-role-policy \
  --role-name "$ROLE" \
  --policy-name gloop-learn-write \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"dynamodb:BatchWriteItem\", \"dynamodb:PutItem\"],
      \"Resource\": \"${TABLE_ARN}\"
    }]
  }" >/dev/null

# --- 3. Zip & create/update Lambda ---
ZIP=$(mktemp -t gloop-learn.XXXXXX).zip
trap 'rm -f "$ZIP"' EXIT
zip -q -j "$ZIP" infra/learn/index.mjs infra/learn/handler.mjs

ENV_JSON='{"Variables":{"TABLE_NAME":"gloop-learn","ALLOWED_ORIGINS":"https://gloop.obfusco.us,https://gloop-dev.obfusco.us"}}'

if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  echo "Updating existing function $FN..."
  aws lambda update-function-code \
    --function-name "$FN" --region "$REGION" \
    --zip-file "fileb://${ZIP}" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration \
    --function-name "$FN" --region "$REGION" \
    --runtime nodejs22.x \
    --handler index.handler \
    --timeout 10 \
    --memory-size 256 \
    --environment "$ENV_JSON" >/dev/null
else
  echo "Creating function $FN..."
  aws lambda create-function \
    --function-name "$FN" --region "$REGION" \
    --runtime nodejs22.x \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --timeout 10 \
    --memory-size 256 \
    --environment "$ENV_JSON" \
    --zip-file "fileb://${ZIP}" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FN" --region "$REGION"
fi

# --- 4. Reserved concurrency (bounds worst-case cost on a public URL) ---
aws lambda put-function-concurrency \
  --function-name "$FN" --region "$REGION" \
  --reserved-concurrent-executions 10 >/dev/null

# --- 5. Function URL (public, origin-checked in the handler) ---
if ! aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  echo "Creating function URL..."
  aws lambda create-function-url-config \
    --function-name "$FN" --region "$REGION" \
    --auth-type NONE >/dev/null
fi

POLICY=$(aws lambda get-policy --function-name "$FN" --region "$REGION" --query Policy --output text 2>/dev/null || true)

if ! printf '%s' "$POLICY" | grep -q FunctionURLAllowPublicAccess; then
  aws lambda add-permission \
    --function-name "$FN" --region "$REGION" \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE >/dev/null
fi

if ! printf '%s' "$POLICY" | grep -q FunctionURLAllowPublicInvoke; then
  aws lambda add-permission \
    --function-name "$FN" --region "$REGION" \
    --statement-id FunctionURLAllowPublicInvoke \
    --action lambda:InvokeFunction \
    --principal "*" \
    --invoked-via-function-url >/dev/null
fi

# --- 6. Set GitHub secret LEARN_URL ---
URL=$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)
printf '%s' "$URL" | gh secret set LEARN_URL --repo "$GLOOP_REPO"

# --- 7. Re-run latest dev/v0 deploy ---
RUN=$(gh run list --repo "$GLOOP_REPO" --branch dev/v0 --limit 1 --json databaseId --jq '.[0].databaseId')
if [ -n "$RUN" ] && [ "$RUN" != "null" ]; then
  gh run rerun "$RUN" --repo "$GLOOP_REPO" || echo "WARNING: couldn't re-run gloop's dev deploy; push to dev/v0 so the build picks up LEARN_URL." >&2
fi

# --- 8. Summary ---
echo ""
echo "Function URL: $URL"
echo "Pull entries with: npm run learn:pull"
