terraform {
  backend "gcs" {
    bucket = "crack-detection-terraform"  # Replace with your manually created bucket name
    prefix = "gke/terraform"
  }
}
