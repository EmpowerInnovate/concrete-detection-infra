output "azure_subscription_id" {
  description = "Azure Subscription ID"
  value       = var.subscription_id
}

output "azure_tenant_id" {
  description = "Azure Tenant ID"
  value       = data.azurerm_subscription.current.tenant_id
}

output "azure_client_id" {
  description = "Azure Service Principal Application (Client) ID"
  value       = azuread_application.sp_app.client_id
}

output "azure_client_secret" {
  description = "Azure Service Principal Client Secret / Password"
  value       = azuread_service_principal_password.sp_password.value
  sensitive   = true
}

output "azure_resource_group_name" {
  description = "Resource Group where Terraform state storage is located"
  value       = azurerm_resource_group.tfstate.name
}

output "azure_storage_account_name" {
  description = "Storage Account name for Terraform backend"
  value       = azurerm_storage_account.tfstate.name
}

output "azure_storage_container_name" {
  description = "Blob Storage container name for Terraform state files"
  value       = azurerm_storage_container.tfstate.name
}

output "azure_credentials_json" {
  description = "JSON credentials payload formatted for GitHub Actions AZURE_CREDENTIALS"
  value = jsonencode({
    clientId       = azuread_application.sp_app.client_id
    clientSecret   = azuread_service_principal_password.sp_password.value
    subscriptionId = var.subscription_id
    tenantId       = data.azurerm_subscription.current.tenant_id
  })
  sensitive = true
}

output "quick_env_exports" {
  description = "Shell export commands for running Terraform locally or in scripts"
  value = <<EOT
export ARM_SUBSCRIPTION_ID="${var.subscription_id}"
export ARM_TENANT_ID="${data.azurerm_subscription.current.tenant_id}"
export ARM_CLIENT_ID="${azuread_application.sp_app.client_id}"
export ARM_CLIENT_SECRET="${azuread_service_principal_password.sp_password.value}"
EOT
  sensitive = true
}
