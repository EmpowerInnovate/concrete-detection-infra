# Azure AKS Infrastructure for Crack Detection

This Terraform configuration sets up an Azure Kubernetes Service (AKS) cluster with an autoscaling node pool and a dedicated Resource Group for the Crack Detection application.

## Architecture

- **Azure Kubernetes Service (AKS)**: Managed Kubernetes control plane.
- **Autoscaling Node Pool**: Automatically scales between `min_nodes` (default 1) and `max_nodes` (default 5).
- **Resource Group**: Automatically creates a dedicated Resource Group `${cluster_name}-rg` or attaches to an existing one.
- **Networking**: Azure CNI or Kubenet with standard Azure Load Balancer.
- **Identity**: System-assigned managed identity.
- **Remote State**: Stored in an Azure Blob Storage container (`tfstate`) with per-cluster isolation (`aks/<cluster_name>.tfstate`).

## Prerequisites

1. An **Azure Subscription**.
2. An **Azure Service Principal** with `Contributor` and `User Access Administrator` (or `Owner`) role.
3. An **Azure Storage Account** and Blob container for Terraform backend state.

> **Tip:** You can provision the Service Principal and Storage Account automatically using the `Setup Azure Service Principal & Backend` workflow, or manually via Azure CLI.

## Manual Usage

### 1. Set Azure Environment Variables

```bash
export ARM_SUBSCRIPTION_ID="<your-subscription-id>"
export ARM_TENANT_ID="<your-tenant-id>"
export ARM_CLIENT_ID="<your-service-principal-app-id>"
export ARM_CLIENT_SECRET="<your-service-principal-password>"
```

### 2. Initialize Terraform

```bash
terraform init \
  -backend-config="resource_group_name=<tfstate-rg>" \
  -backend-config="storage_account_name=<tfstate-storage-account>" \
  -backend-config="container_name=tfstate" \
  -backend-config="key=aks/crack-detection-cluster.tfstate"
```

### 3. Plan & Apply

```bash
terraform plan \
  -var="cluster_name=crack-detection-cluster" \
  -var="location=eastus" \
  -out=tfplan

terraform apply tfplan
```

### 4. Connect to AKS

```bash
az aks get-credentials --resource-group crack-detection-cluster-rg --name crack-detection-cluster --overwrite-existing
kubectl get nodes
```

### 5. Destroy

```bash
# Clean up Kubernetes load balancers and ingresses first
kubectl delete ingress --all --all-namespaces || true
kubectl delete svc --all --all-namespaces --field-selector metadata.name!=kubernetes || true

terraform plan -destroy -var="cluster_name=crack-detection-cluster" -out=tfplan
terraform apply tfplan
```
