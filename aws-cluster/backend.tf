terraform {
  backend "s3" {
    # Backend configuration is dynamically injected during `terraform init`:
    # - bucket         = "..."
    # - key            = "eks/<cluster_name>.tfstate"
    # - region         = "..."
    # - dynamodb_table = "..."
    # - encrypt        = true
  }

  required_version = ">= 1.5.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
  }
}
