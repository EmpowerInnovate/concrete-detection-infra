variable "cluster_name" {
  description = "The name of the AKS cluster"
  type        = string
}

variable "location" {
  description = "The Azure region to deploy resources into"
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "The name of the resource group. If create_resource_group is true and this is empty, '<cluster_name>-rg' is used."
  type        = string
  default     = ""
}

variable "create_resource_group" {
  description = "Whether to create a new resource group for the cluster or use an existing one"
  type        = bool
  default     = true
}

variable "node_size" {
  description = "Azure VM size for the Kubernetes node pool"
  type        = string
  default     = "Standard_B2s"
}

variable "min_nodes" {
  description = "Minimum number of nodes in the autoscaling node pool"
  type        = number
  default     = 1
}

variable "max_nodes" {
  description = "Maximum number of nodes in the autoscaling node pool"
  type        = number
  default     = 5
}

variable "os_disk_size_gb" {
  description = "OS disk size in GB for cluster nodes"
  type        = number
  default     = 30
}

variable "kubernetes_version" {
  description = "Specific Kubernetes version for AKS (leave empty for Azure default)"
  type        = string
  default     = null
}

variable "network_plugin" {
  description = "Network plugin to use for AKS (azure or kubenet)"
  type        = string
  default     = "azure"
}

variable "tags" {
  description = "Tags applied to all created Azure resources"
  type        = map(string)
  default = {
    Environment = "production"
    Project     = "crack-detection"
    ManagedBy   = "Terraform"
  }
}
