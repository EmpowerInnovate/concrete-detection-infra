output "aws_region" {
  description = "AWS region of the Terraform backend"
  value       = var.region
}

output "aws_iam_user_name" {
  description = "IAM user for the EKS deployment pipeline"
  value       = aws_iam_user.deployer.name
}

output "aws_iam_user_arn" {
  description = "ARN of the IAM user for the EKS deployment pipeline"
  value       = aws_iam_user.deployer.arn
}

output "aws_state_bucket" {
  description = "S3 bucket name for Terraform backend"
  value       = aws_s3_bucket.tfstate.bucket
}

output "aws_lock_table" {
  description = "DynamoDB table name for Terraform state locking"
  value       = aws_dynamodb_table.tflock.name
}
