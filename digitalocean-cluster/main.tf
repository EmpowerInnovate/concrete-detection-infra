terraform {
  backend "s3" {
    endpoints = {
      s3 = "https://nyc3.digitaloceanspaces.com"
    }
    bucket                      = "terraform-crack-detection-1"
    key                         = "DO-cluster/terraform.tfstate"
    region                      = "us-east-1"
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.34.0"
    }
  }
}

provider "digitalocean" {
  token = var.digitalocean_token
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "digitalocean_token" {
  description = "DigitalOcean API Token"
  type        = string
  sensitive   = true
}

variable "cluster_name" {
  description = "Name of the Kubernetes cluster"
  type        = string
}

variable "region" {
  description = "DigitalOcean region"
  default     = "nyc3"
}

variable "node_size" {
  description = "Node size for the Kubernetes cluster"
  default     = "s-1vcpu-2gb"
}

# Autoscaling: minimum number of nodes
variable "min_nodes" {
  description = "Minimum number of nodes in the autoscaling node pool"
  type        = number
  default     = 1
}

# Autoscaling: maximum number of nodes
variable "max_nodes" {
  description = "Maximum number of nodes in the autoscaling node pool"
  type        = number
  default     = 5
}

# ─── Data Sources ─────────────────────────────────────────────────────────────

# Fetch the latest available Kubernetes version in the selected region
data "digitalocean_kubernetes_versions" "latest" {}

# ─── Kubernetes Cluster ───────────────────────────────────────────────────────

resource "digitalocean_kubernetes_cluster" "crack-detection-cluster" {
  name    = var.cluster_name
  region  = var.region
  version = data.digitalocean_kubernetes_versions.latest.valid_versions[0]

  node_pool {
    name = "default-pool"
    size = var.node_size

    # When auto_scale is enabled, node_count sets the *initial* node count.
    # DigitalOcean will then manage the count between min_nodes and max_nodes.
    auto_scale = true
    min_nodes  = var.min_nodes
    max_nodes  = var.max_nodes
  }
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "kubeconfig" {
  value     = digitalocean_kubernetes_cluster.crack-detection-cluster.kube_config[0].raw_config
  sensitive = true
}

output "cluster_endpoint" {
  value = digitalocean_kubernetes_cluster.crack-detection-cluster.endpoint
}

output "cluster_id" {
  value = digitalocean_kubernetes_cluster.crack-detection-cluster.id
}

output "node_pool_id" {
  description = "ID of the default autoscaling node pool"
  value       = digitalocean_kubernetes_cluster.crack-detection-cluster.node_pool[0].id
}
