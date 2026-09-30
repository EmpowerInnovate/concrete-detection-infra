# Multi-Cloud Kubernetes Infrastructure & Deployment Guide (GCP / DigitalOcean / Azure AKS)

This repository contains the Infrastructure-as-Code (IaC) workflows and Terraform configurations to bootstrap Cloud Credentials and provision production Kubernetes Clusters (GKE, DOKS, AKS) for the Crack Detection Application.

For a detailed visual mapping of the IAM role hierarchy and architecture for GCP, refer to the [Service Account Architecture Diagram](service_account_architecture_diagram.md).

---

## Supported Cloud Providers

| Cloud Provider | Cluster Type | Terraform Directory | Phase 1 Setup | Backend State |
| :--- | :--- | :--- | :--- | :--- |
| **Google Cloud (GCP)** | GKE | [`gcp-cluster/`](gcp-cluster/) | [`setup-gcp-service-account.yaml`](.github/workflows/setup-gcp-service-account.yaml) | Google Cloud Storage (GCS) |
| **DigitalOcean** | DOKS | [`digitalocean-cluster/`](digitalocean-cluster/) | DO API Tokens & Spaces | DigitalOcean Spaces (S3 compatible) |
| **Microsoft Azure** | AKS | [`azure-cluster/`](azure-cluster/) | [`setup-azure-service-principal.yaml`](.github/workflows/setup-azure-service-principal.yaml) | Azure Blob Storage (`azurerm`) |

---

## Prerequisites

### For GCP:
1. A **GCP Project** created (e.g., `concrete-detection-8`).
2. A **Main Admin Service Account** key with required admin roles (`Owner`, `Project IAM Admin`, `Service Account Admin`, `Service Account Key Admin`, `Service Usage Admin`).
3. A **GCS Bucket** manually created to hold Terraform state files (default name: `crack-detection-terraform`).

### For DigitalOcean:
1. A **DigitalOcean Personal Access Token** with read/write access.
2. DigitalOcean **Spaces Access Key** and **Secret Key** for Terraform backend state.

### For Azure (AKS):
1. An active **Azure Subscription**.
2. An **Azure Service Principal** with `Contributor` and `User Access Administrator` permissions on the subscription (can be auto-generated in Phase 1).
3. An **Azure Storage Account** and Blob container (`tfstate`) for Terraform backend state (can be auto-generated in Phase 1).

---

## Deployment Process

Deploying the infrastructure is done in two phases using Gitea / GitHub Actions workflows.

---

### Phase 1: Service Account & Cloud Credentials Provisioning

#### Option A: Google Cloud (GCP)
1. Navigate to the **Actions** tab in the Gitea/GitHub interface.
2. Select the **`Setup GCP Service Account`** workflow.
3. Click **Run workflow** and fill in the parameters:
   * **Terraform action**: `apply`
   * **GCP Account Name**: Choose `maheshrajannan`, `empowerinnovate`, or select `custom`.
   * **GCP Project ID**: The ID of your target project (e.g., `concrete-detection-8`).
   * **GCS bucket name**: Select one of the defaults (`crack-detection-terraform`, `crack-detection-terraform-1`) or `custom`.
   * **GCP Service Account Name**: The name of the new deployment SA to be created (e.g., `crack-detection-1`).
   * **GCP Service Account JSON key (base64)**: (Optional) Paste the base64-encoded JSON key. If left blank, falls back to `MAHESH_GCP_SERVICE_ACCOUNT_KEY` secret.
4. Click **Run Workflow**.
5. Once complete, copy the generated service account JSON key from your GCP console and encode it to base64:
   ```bash
   # Linux
   base64 -w 0 key.json
   # macOS
   base64 -i key.json | tr -d '\n'
   ```

#### Option B: Microsoft Azure
1. Navigate to the **Actions** tab.
2. Select the **`Setup Azure Service Principal & Backend`** workflow.
3. Click **Run workflow** and fill in the parameters:
   * **Terraform action**: `apply`
   * **Azure Subscription ID**: Your Azure Subscription ID.
   * **Azure Tenant ID**: Your Azure Tenant / Directory ID.
   * **Target Storage Account**: Name for the Terraform backend storage (e.g., `cracktfstatesa`).
   * **Target Service Principal**: Name for the new AKS deployment SP (e.g., `crack-detection-aks-sp`).
4. Click **Run Workflow**.
5. Note the generated `azure_client_id`, `azure_client_secret`, and `azure_storage_account` from the workflow summary.

*(Alternative: You can also bootstrap Azure locally in 30 seconds using [`azure-service-principal/bootstrap-azure.sh`](azure-service-principal/bootstrap-azure.sh).)*

---

### Phase 2: Kubernetes Cluster Provisioning (GKE / DOKS / AKS)

This workflow provisions Kubernetes clusters across any of the supported cloud providers. Each cluster receives an isolated backend state file based on its `cluster_name`, allowing multiple clusters to run simultaneously.

1. Navigate to the **Actions** tab.
2. Select the **`Deploy Kubernetes Cluster (GCP / DigitalOcean / Azure AKS)`** workflow.
3. Click **Run workflow** and fill in the parameters:
   * **Provider**: `gcp`, `digitalocean`, or `azure`
   * **Action**: `apply` (to create/update) or `destroy` (to delete)
   * **Cluster name**: Name of your cluster (e.g., `crack-detection-cluster`). *Note: Specifying a unique cluster name provisions a new independent cluster without affecting existing clusters. Re-using an existing name updates that specific cluster.*

#### Provider-Specific Inputs:
* **For GCP**:
  * `gcp_project_id`: Target GCP Project ID
  * `gcp_backend_bucket`: GCS bucket for backend state
  * `gcp_sa_key_base64`: Base64 encoded JSON key from Phase 1
  * `gcp_cluster_zone`: e.g. `us-central1-a`
* **For DigitalOcean**:
  * `do_token`: DigitalOcean API Token
  * `do_access_key`: Spaces access key
  * `do_secret_key`: Spaces secret key
  * `do_cluster_region`: e.g. `nyc3`
* **For Azure**:
  * `azure_subscription_id`: Azure Subscription ID
  * `azure_tenant_id`: Azure Tenant ID
  * `azure_client_id`: Service Principal Application (Client) ID
  * `azure_client_secret`: Service Principal Secret / Password
  * `azure_storage_account`: Storage Account name for backend state
  * `azure_location`: Azure region (e.g. `eastus`)
  * `azure_node_size`: Node VM size (default: `Standard_D2s_v3`)

4. Click **Run Workflow**.

This will automatically:
* Provision the Kubernetes Cluster with autoscaling node pools using isolated backend state.
* Configure networking, identities, and cluster credentials.
* Output the cluster connect command for `kubectl`.

---

## Cluster Connect Commands

Once the pipeline successfully finishes:

### GKE (Google Cloud):
```bash
gcloud container clusters get-credentials <cluster_name> --zone <zone> --project <project_id>
```

### DOKS (DigitalOcean):
```bash
doctl auth init -t <YOUR_DO_TOKEN>
doctl kubernetes cluster kubeconfig save <cluster_name>
```

### AKS (Azure):
```bash
az login --service-principal -u <azure_client_id> -p <azure_client_secret> --tenant <azure_tenant_id>
az aks get-credentials --resource-group <cluster_name>-rg --name <cluster_name> --overwrite-existing
kubectl get nodes
```

---

## Troubleshooting & Verification

### 1. Verification of Input Token Preview
During workflow execution, the `Verify Input Token` / preview steps print a spaced preview of the provided base64 keys/secrets to the execution logs (e.g., `e w o g I C J 0 e X B l I j o`). Use this preview to confirm that your pasted token is intact without exposing full credentials.

### 2. Managed Certificate Status: `FailedNotVisible` (GCP)
If your managed SSL certificate shows `FailedNotVisible` and the app is not loading:
1. Get your ingress external IP address:
   ```bash
   kubectl describe ingress concrete-gallery-ingress
   ```
2. Note the IP address (e.g. `8.233.148.110`).
3. Log into your domain registrar (e.g., Namecheap, Hostinger) and point the DNS `A Record` for your domain (e.g., `maheshconcretegallery.online`) to that IP address.
4. Google will automatically verify ownership and activate the SSL certificate.
