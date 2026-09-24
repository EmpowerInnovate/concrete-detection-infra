# GCP Infrastructure & Deployment Guide

This repository contains the Infrastructure-as-Code (IaC) workflows and Terraform configurations to bootstrap GCP Service Accounts and provision GKE Kubernetes Clusters for the Crack Detection Application.

For a detailed visual mapping of the IAM role hierarchy and architecture, refer to the [Service Account Architecture Diagram](service_account_architecture_diagram.md).

---

## Prerequisites

Before running any pipeline, ensure you have:
1. A **GCP Project** created (e.g., `concrete-detection-8`).
2. A **Main Admin Service Account** key with the following admin roles on your target GCP project:
   * **Owner**
   * **Project IAM Admin**
   * **Service Account Admin**
   * **Service Account Key Admin**
   * **Service Usage Admin**
3. A **GCS Bucket** manually created to hold the Terraform state files (default name: `crack-detection-terraform`).

---

## Deployment Process

Deploying the infrastructure is done in two phases using Gitea / GitHub Actions workflows.

### Phase 1: Service Account & Roles Provisioning
This workflow sets up the required GCP APIs and creates a scoped Service Account to handle cluster deployments.

1. Navigate to the **Actions** tab in the Gitea/GitHub interface.
2. Select the **`Setup GCP Service Account`** workflow.
3. Click **Run workflow** and fill in the parameters:
   * **Terraform action**: `apply`
   * **GCP Account Name**: Choose `maheshrajannan`, `empowerinnovate`, or select `custom` to type a different account label.
   * **GCP Project ID**: The ID of your target project (e.g., `concrete-detection-8`).
   * **GCS bucket name**: Select one of the defaults (`crack-detection-terraform`, `crack-detection-terraform-1`) or select `custom` and type your bucket name in the custom field.
   * **GCP Service Account Name**: The name of the new deployment SA to be created (e.g., `crack-detection-1`).
   * **GCP Service Account JSON key (base64)**: (Optional) If you want to use a specific admin key at runtime, paste the base64-encoded JSON key. If left blank, the pipeline will fall back to the default `MAHESH_GCP_SERVICE_ACCOUNT_KEY` secret.
4. Click **Run Workflow**.
5. Once complete, copy the generated service account JSON key from your GCP console and encode it to base64:
   ```bash
   # Linux
   base64 -w 0 key.json
   # macOS
   base64 -i key.json | tr -d '\n'
   ```

---

### Phase 2: GKE / DigitalOcean Kubernetes Cluster Provisioning
This workflow uses Terraform to provision Kubernetes clusters. Each cluster receives an isolated state file based on its `cluster_name`, allowing you to maintain multiple clusters simultaneously.

1. Navigate to the **Actions** tab.
2. Select the **`Deploy Kubernetes Cluster (GCP / DigitalOcean)`** workflow.
3. Click **Run workflow** and fill in the parameters:
   * **Provider**: `gcp` or `digitalocean`
   * **Terraform action**: `apply` (or `destroy` to delete)
   * **Cluster name**: Name of your cluster (e.g., `crack-detection-cluster`). *Note: Specifying a unique cluster name provisions a new independent cluster without affecting existing clusters. Re-using an existing name updates that specific cluster.*
   * **GCP Project ID**: The ID of your project (if GCP).
   * **GCS bucket name**: Select/type the bucket name used for Terraform backend state.
   * **GCP Service Account JSON key (base64)**: Paste the base64-encoded JSON key of the **Target Service Account** created in Phase 1.
4. Click **Run Workflow**.

This will automatically:
* Provision the Kubernetes Cluster with autoscaling node pools using isolated backend state.
* Register cluster authentication credentials.
* Deploy application components.

---

## Troubleshooting & Verification

### 1. Verification of Input Token Preview
During both workflow runs, the `Verify Input Token` step prints a preview of the provided base64 key token to the execution logs:
* It displays the first 15 characters spaced out (e.g., `e w o g I C J 0 e X B l I j o`).
* Use this spaced output to verify that your pasted token is correct and matches the intended key.

### 2. Managed Certificate Status: `FailedNotVisible`
If your managed SSL certificate shows `FailedNotVisible` and the app is not loading:
1. Get your ingress external IP address:
   ```bash
   kubectl describe ingress concrete-gallery-ingress
   ```
2. Note the IP address (e.g. `8.233.148.110`).
3. Log into your domain registrar (e.g., Namecheap, Hostinger) and point the DNS `A Record` for your domain (e.g., `maheshconcretegallery.online`) to that IP address.
4. Google will automatically verify ownership and activate the SSL certificate.
