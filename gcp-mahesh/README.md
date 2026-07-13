# GCP Infrastructure for Crack Detection

This Terraform configuration sets up the GKE cluster and related resources for the Crack Detection application.

## Prerequisites

1. The GCP bootstrap configuration must be applied first to create the required resources, including the Terraform state bucket.
2. You need the name of the Terraform state bucket created by the bootstrap configuration.

## Usage

1. Initialize Terraform with the backend configuration:
   ```bash
   terraform init -backend-config="bucket=YOUR_TERRAFORM_STATE_BUCKET"
   ```
   Replace `YOUR_TERRAFORM_STATE_BUCKET` with the bucket name from the bootstrap outputs.

2. Apply the configuration:
   ```bash
   terraform apply
   ```

## Outputs

- `cluster_name`: The name of the created GKE cluster
- `kubectl_config`: The command to configure kubectl to connect to the cluster
