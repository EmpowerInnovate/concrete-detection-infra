variable "subscription_id" {
  description = "The Azure Subscription ID"
  type        = string
}

variable "location" {
  description = "The Azure region for the resource group and storage account"
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Name of the resource group to store Terraform state"
  type        = string
  default     = "crack-detection-tfstate-rg"
}

variable "storage_account_name" {
  description = "Name of the storage account for Terraform state (must be globally unique, 3-24 lowercase alphanumerics)"
  type        = string
  default     = "cracktfstatesa"
}

variable "container_name" {
  description = "Name of the blob storage container for Terraform state"
  type        = string
  default     = "tfstate"
}

variable "service_principal_name" {
  description = "Display name for the Azure AD Application & Service Principal"
  type        = string
  default     = "crack-detection-sp"
}
