resource "google_container_node_pool" "primary" {
  name     = "primary-node-pool"
  cluster  = google_container_cluster.crack_detection.name
  location = var.zone # same zone as the cluster (main.tf)

  autoscaling {
    min_node_count = 3
    max_node_count = 7
  }

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 20
    disk_type    = "pd-standard"

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}
