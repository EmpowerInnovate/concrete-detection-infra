terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.48.0"
    }
  }
}

provider "azurerm" {
  subscription_id = var.subscription_id
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

provider "azuread" {}

data "azurerm_subscription" "current" {
  subscription_id = var.subscription_id
}

data "azuread_client_config" "current" {}

# 1. Resource Group for Terraform Backend State
resource "azurerm_resource_group" "tfstate" {
  name     = var.resource_group_name
  location = var.location

  tags = {
    Environment = "production"
    Purpose     = "TerraformState"
    Project     = "crack-detection"
    ManagedBy   = "Terraform"
  }
}

# 2. Azure Storage Account for Terraform State
resource "azurerm_storage_account" "tfstate" {
  name                     = var.storage_account_name
  resource_group_name      = azurerm_resource_group.tfstate.name
  location                 = azurerm_resource_group.tfstate.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true
  }

  tags = {
    Environment = "production"
    Purpose     = "TerraformState"
    Project     = "crack-detection"
    ManagedBy   = "Terraform"
  }
}

# 3. Blob Container for State Files
resource "azurerm_storage_container" "tfstate" {
  name                  = var.container_name
  storage_account_name  = azurerm_storage_account.tfstate.name
  container_access_type = "private"
}

# 4. Azure AD Application
resource "azuread_application" "sp_app" {
  display_name = var.service_principal_name
  owners       = [data.azuread_client_config.current.object_id]
}

# 5. Azure AD Service Principal
resource "azuread_service_principal" "sp" {
  client_id                    = azuread_application.sp_app.client_id
  app_role_assignment_required = false
  owners                       = [data.azuread_client_config.current.object_id]
}

# 6. Service Principal Password / Secret
resource "azuread_service_principal_password" "sp_password" {
  service_principal_id = azuread_service_principal.sp.id
}

# 7. Role Assignment: Contributor on Azure Subscription
resource "azurerm_role_assignment" "sp_contributor" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.sp.object_id
}

# 8. Role Assignment: User Access Administrator (so SP can assign AKS managed identity roles)
resource "azurerm_role_assignment" "sp_user_access_admin" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "User Access Administrator"
  principal_id         = azuread_service_principal.sp.object_id
}
