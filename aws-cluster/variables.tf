variable "cluster_name" {
  description = "The name of the EKS cluster"
  type        = string
}

variable "region" {
  description = "The AWS region to deploy resources into"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the cluster VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "node_size" {
  description = "EC2 instance type for the Kubernetes node group"
  type        = string
  default     = "t3.medium"
}

variable "min_nodes" {
  description = "Minimum number of nodes in the managed node group"
  type        = number
  default     = 1
}

variable "max_nodes" {
  description = "Maximum number of nodes in the managed node group"
  type        = number
  default     = 3
}

variable "desired_nodes" {
  description = "Desired number of nodes in the managed node group"
  type        = number
  default     = 2
}

variable "os_disk_size_gb" {
  description = "Root disk size in GB for cluster nodes"
  type        = number
  default     = 30
}

variable "kubernetes_version" {
  description = "Specific Kubernetes version for EKS (leave empty for AWS default)"
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to all created AWS resources"
  type        = map(string)
  default = {
    Environment = "production"
    Project     = "crack-detection"
    ManagedBy   = "Terraform"
  }
}
