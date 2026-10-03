variable "subscription_id" {
  description = "Azure Subscription ID (passed via ARM_SUBSCRIPTION_ID env var)"
  type        = string
  default     = null
}

provider "azurerm" {
  subscription_id = var.subscription_id
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

locals {
  target_rg_name = var.resource_group_name != "" ? var.resource_group_name : "${var.cluster_name}-rg"
  rg_name        = var.create_resource_group ? azurerm_resource_group.cluster[0].name : data.azurerm_resource_group.cluster[0].name
  rg_location    = var.create_resource_group ? azurerm_resource_group.cluster[0].location : data.azurerm_resource_group.cluster[0].location
}

# Create a dedicated Resource Group for the AKS cluster (optional if using existing)
resource "azurerm_resource_group" "cluster" {
  count    = var.create_resource_group ? 1 : 0
  name     = local.target_rg_name
  location = var.location
  tags     = var.tags
}

# Reference existing Resource Group if create_resource_group is false
data "azurerm_resource_group" "cluster" {
  count = var.create_resource_group ? 0 : 1
  name  = var.resource_group_name
}

# Azure Kubernetes Service (AKS) Cluster
resource "azurerm_kubernetes_cluster" "crack_detection" {
  name                = var.cluster_name
  location            = local.rg_location
  resource_group_name = local.rg_name
  dns_prefix          = replace(var.cluster_name, "_", "-")
  kubernetes_version  = var.kubernetes_version

  default_node_pool {
    name                 = "default"
    node_count           = var.min_nodes
    vm_size              = var.node_size
    auto_scaling_enabled = true
    min_count            = var.min_nodes
    max_count            = var.max_nodes
    os_disk_size_gb      = var.os_disk_size_gb
    tags                 = var.tags
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = var.network_plugin
    load_balancer_sku = "standard"
  }

  tags = var.tags
}
