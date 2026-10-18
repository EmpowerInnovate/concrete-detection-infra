terraform {
  backend "azurerm" {
    # Backend configuration is dynamically injected during `terraform init`:
    # - resource_group_name  = "..."
    # - storage_account_name = "..."
    # - container_name       = "..."
    # - key                  = "aks/<cluster_name>.tfstate"
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.14.0"
    }
  }
}
