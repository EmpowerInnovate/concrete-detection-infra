terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Environment = "production"
      Project     = "crack-detection"
      ManagedBy   = "Terraform"
    }
  }
}

# 1. S3 Bucket for Terraform Backend State
resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name

  tags = {
    Purpose = "TerraformState"
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 2. DynamoDB Table for Terraform State Locking
resource "aws_dynamodb_table" "tflock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Purpose = "TerraformState"
  }
}

# 3. IAM User used by the EKS deployment pipeline
resource "aws_iam_user" "deployer" {
  name = var.iam_user_name
}

# 4. PowerUserAccess: manage EKS, EC2/VPC, S3, DynamoDB, KMS, CloudWatch Logs, etc.
resource "aws_iam_user_policy_attachment" "power_user" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# 5. IAMFullAccess: so the user can create the EKS cluster / node group IAM roles
resource "aws_iam_user_policy_attachment" "iam_full" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/IAMFullAccess"
}
