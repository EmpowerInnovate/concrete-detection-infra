variable "region" {
  description = "The AWS region for the state bucket and lock table"
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Name of the S3 bucket for Terraform state (must be globally unique)"
  type        = string
  default     = "crack-detection-tfstate"
}

variable "lock_table_name" {
  description = "Name of the DynamoDB table for Terraform state locking"
  type        = string
  default     = "crack-detection-tflock"
}

variable "iam_user_name" {
  description = "Name of the IAM user used to deploy EKS clusters"
  type        = string
  default     = "crack-detection-eks-deployer"
}
