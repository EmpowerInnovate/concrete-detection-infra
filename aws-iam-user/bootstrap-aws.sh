#!/usr/bin/env bash
# ==============================================================================
# Bootstrap AWS IAM User and Terraform State Bucket / Lock Table
# ==============================================================================
# Usage:
#   chmod +x bootstrap-aws.sh
#   ./bootstrap-aws.sh [REGION] [IAM_USER_NAME] [BUCKET_NAME] [LOCK_TABLE_NAME]
#
# Defaults:
#   REGION="us-east-1"
#   IAM_USER_NAME="crack-detection-eks-deployer"
#   BUCKET_NAME="crack-detection-tfstate-<account_id>"
#   LOCK_TABLE_NAME="crack-detection-tflock"
# ==============================================================================

set -euo pipefail

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo '')
if [ -z "$ACCOUNT_ID" ]; then
  echo "Error: AWS credentials not found. Run 'aws configure' (or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) as an admin user first."
  exit 1
fi

REGION="${1:-us-east-1}"
IAM_USER_NAME="${2:-crack-detection-eks-deployer}"
BUCKET_NAME="${3:-crack-detection-tfstate-${ACCOUNT_ID}}"
LOCK_TABLE_NAME="${4:-crack-detection-tflock}"

echo "===================================================="
echo " Bootstrapping AWS Terraform Prerequisites"
echo "===================================================="
echo " Account ID      : $ACCOUNT_ID"
echo " Region          : $REGION"
echo " State Bucket    : $BUCKET_NAME"
echo " Lock Table      : $LOCK_TABLE_NAME"
echo " IAM User        : $IAM_USER_NAME"
echo "===================================================="

# 1. Create S3 State Bucket
echo "Creating S3 bucket '$BUCKET_NAME'..."
if [ "$REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION"
else
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi
aws s3api put-bucket-versioning --bucket "$BUCKET_NAME" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET_NAME" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$BUCKET_NAME" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 2. Create DynamoDB Lock Table
echo "Creating DynamoDB table '$LOCK_TABLE_NAME'..."
aws dynamodb create-table \
  --table-name "$LOCK_TABLE_NAME" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" >/dev/null

# 3. Create IAM User with PowerUserAccess + IAMFullAccess
echo "Creating IAM user '$IAM_USER_NAME'..."
aws iam create-user --user-name "$IAM_USER_NAME" --tags Key=Project,Value=crack-detection >/dev/null
aws iam attach-user-policy --user-name "$IAM_USER_NAME" --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
aws iam attach-user-policy --user-name "$IAM_USER_NAME" --policy-arn arn:aws:iam::aws:policy/IAMFullAccess

# 4. Create Access Key
echo "Creating access key for '$IAM_USER_NAME'..."
KEY_OUTPUT=$(aws iam create-access-key --user-name "$IAM_USER_NAME")
ACCESS_KEY_ID=$(echo "$KEY_OUTPUT" | jq -r '.AccessKey.AccessKeyId')
SECRET_ACCESS_KEY=$(echo "$KEY_OUTPUT" | jq -r '.AccessKey.SecretAccessKey')

echo ""
echo "===================================================="
echo " ✅ Bootstrap Complete!"
echo "===================================================="
echo "Add these values into GitHub Secrets or Pipeline Inputs:"
echo ""
echo "AWS_ACCESS_KEY_ID     : $ACCESS_KEY_ID"
echo "AWS_SECRET_ACCESS_KEY : $SECRET_ACCESS_KEY"
echo "aws_region            : $REGION"
echo "aws_state_bucket      : $BUCKET_NAME"
echo "aws_lock_table        : $LOCK_TABLE_NAME"
echo ""
echo "Or export to your terminal:"
echo "export AWS_ACCESS_KEY_ID=\"$ACCESS_KEY_ID\""
echo "export AWS_SECRET_ACCESS_KEY=\"$SECRET_ACCESS_KEY\""
echo "export AWS_REGION=\"$REGION\""
echo "===================================================="
