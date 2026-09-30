#!/usr/bin/env bash
# ==============================================================================
# Bootstrap Azure Service Principal and Terraform State Storage Account
# ==============================================================================
# Usage:
#   chmod +x bootstrap-azure.sh
#   ./bootstrap-azure.sh [SUBSCRIPTION_ID] [LOCATION] [SP_NAME] [RG_NAME] [SA_NAME]
#
# Defaults:
#   LOCATION="eastus"
#   SP_NAME="crack-detection-sp"
#   RG_NAME="crack-detection-tfstate-rg"
#   SA_NAME="cracktfstate$RANDOM"
# ==============================================================================

set -euo pipefail

SUBSCRIPTION_ID="${1:-$(az account show --query id -o tsv 2>/dev/null || echo '')}"
LOCATION="${2:-eastus}"
SP_NAME="${3:-crack-detection-sp}"
RG_NAME="${4:-crack-detection-tfstate-rg}"
RANDOM_SUFFIX=$(od -vAn -N4 -tu4 < /dev/urandom | tr -d ' ' | cut -c1-6)
SA_NAME="${5:-cracktfstate${RANDOM_SUFFIX}}"
CONTAINER_NAME="tfstate"

if [ -z "$SUBSCRIPTION_ID" ]; then
  echo "Error: Azure Subscription ID is required. Either run 'az login' or pass subscription id as first argument."
  exit 1
fi

echo "Setting active Azure subscription: $SUBSCRIPTION_ID"
az account set --subscription "$SUBSCRIPTION_ID"
TENANT_ID=$(az account show --query tenantId -o tsv)

echo "===================================================="
echo " Bootstrapping Azure Terraform Prerequisites"
echo "===================================================="
echo " Subscription ID : $SUBSCRIPTION_ID"
echo " Tenant ID       : $TENANT_ID"
echo " Location        : $LOCATION"
echo " Resource Group  : $RG_NAME"
echo " Storage Account : $SA_NAME"
echo " Container Name  : $CONTAINER_NAME"
echo " SP Display Name : $SP_NAME"
echo "===================================================="

# 1. Create Resource Group
echo "Creating Resource Group '$RG_NAME'..."
az group create --name "$RG_NAME" --location "$LOCATION" --tags Environment=production Project=crack-detection

# 2. Create Storage Account
echo "Creating Storage Account '$SA_NAME'..."
az storage account create \
  --name "$SA_NAME" \
  --resource-group "$RG_NAME" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false

# 3. Create Blob Container
echo "Creating Blob Container '$CONTAINER_NAME'..."
az storage container create \
  --name "$CONTAINER_NAME" \
  --account-name "$SA_NAME" \
  --auth-mode login

# 4. Create Service Principal with Contributor role on Subscription
echo "Creating Service Principal '$SP_NAME' with Contributor role..."
SP_OUTPUT=$(az ad sp create-for-rbac \
  --name "$SP_NAME" \
  --role "Contributor" \
  --scopes "/subscriptions/$SUBSCRIPTION_ID" \
  --json-auth)

CLIENT_ID=$(echo "$SP_OUTPUT" | jq -r '.clientId')
CLIENT_SECRET=$(echo "$SP_OUTPUT" | jq -r '.clientSecret')

echo ""
echo "===================================================="
echo " ✅ Bootstrap Complete!"
echo "===================================================="
echo "Add these values into GitHub Secrets or Pipeline Inputs:"
echo ""
echo "AZURE_SUBSCRIPTION_ID : $SUBSCRIPTION_ID"
echo "AZURE_TENANT_ID       : $TENANT_ID"
echo "AZURE_CLIENT_ID       : $CLIENT_ID"
echo "AZURE_CLIENT_SECRET   : $CLIENT_SECRET"
echo "AZURE_STORAGE_ACCOUNT : $SA_NAME"
echo "AZURE_RESOURCE_GROUP  : $RG_NAME"
echo "AZURE_CONTAINER_NAME  : $CONTAINER_NAME"
echo ""
echo "Or export to your terminal:"
echo "export ARM_SUBSCRIPTION_ID=\"$SUBSCRIPTION_ID\""
echo "export ARM_TENANT_ID=\"$TENANT_ID\""
echo "export ARM_CLIENT_ID=\"$CLIENT_ID\""
echo "export ARM_CLIENT_SECRET=\"$CLIENT_SECRET\""
echo "===================================================="
