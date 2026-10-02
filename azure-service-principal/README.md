# Azure Service Principal & Terraform Backend Setup

This directory contains Terraform and automation scripts to provision the foundational Azure resources required for AKS deployments:
1. **Azure Resource Group**: Holds the Terraform remote state storage account.
2. **Azure Storage Account & Blob Container**: Secure remote state backend with encryption and versioning.
3. **Azure AD Service Principal & Secret**: Dedicated identity with `Contributor` and `User Access Administrator` permissions on your subscription.

---

## Provisioning Options

### Option 1: GitHub Actions Workflow (Recommended)
1. Go to **Actions** → **Setup Azure Service Principal & Backend**.
2. Provide your `azure_subscription_id` and initial login credentials (or configure repository secrets `AZURE_SUBSCRIPTION_ID`, `AZURE_CLIENT_ID`, etc.).
3. Run the workflow with action `apply`.
4. Copy the generated Service Principal credentials and Storage Account name from the pipeline output.

---

### Option 2: Azure CLI Bootstrap Script (Fastest Local Setup)
If you have `az` CLI installed and authenticated (`az login`):

```bash
cd azure-service-principal
./bootstrap-azure.sh "<YOUR_AZURE_SUBSCRIPTION_ID>" "eastus"
```

This will automatically create:
- Resource Group: `crack-detection-tfstate-rg`
- Storage Account: `cracktfstate<random>`
- Blob Container: `tfstate`
- Service Principal: `crack-detection-sp` with `Contributor` role

---

### Option 3: Manual Terraform Run

1. Log in with Azure CLI:
   ```bash
   az login
   az account set --subscription "<YOUR_SUBSCRIPTION_ID>"
   ```

2. Initialize and apply Terraform:
   ```bash
   cd azure-service-principal
   terraform init
   terraform apply \
     -var="subscription_id=<YOUR_SUBSCRIPTION_ID>" \
     -var="location=eastus" \
     -var="resource_group_name=crack-detection-tfstate-rg" \
     -var="storage_account_name=cracktfstate$(openssl rand -hex 3)"
   ```

3. View sensitive outputs:
   ```bash
   terraform output quick_env_exports
   ```
