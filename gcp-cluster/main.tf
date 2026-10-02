provider "google" {
  project = var.project_id
  region  = "us-central1"
}

# GKE Cluster (NO default node pool)
resource "google_container_cluster" "crack_detection" {
  name     = var.cluster_name
  location = var.zone

  # Important: remove default node pool
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = "default"
  subnetwork = "default"

  deletion_protection = var.deletion_protection

  release_channel {
    channel = "REGULAR"
  }
}

# Variables
variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "zone" {
  description = "The GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "cluster_name" {
  description = "The name of the GKE cluster"
  type        = string
}

variable "deletion_protection" {
  description = "Enable or disable deletion protection for the cluster"
  type        = bool
  default     = false
}

# Outputs
output "cluster_name" {
  value = google_container_cluster.crack_detection.name
}

output "kubectl_config" {
  value = <<EOT
gcloud container clusters get-credentials ${google_container_cluster.crack_detection.name} \
  --zone ${var.zone} \
  --project ${var.project_id}
EOT
  sensitive = true
}
