terraform {
  backend "gcs" {
    bucket = "crack-detection-terraform"  # Replace with your manually created bucket name
    prefix = "gcp-createServiceAccount-mahesh/terraform"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "required" {
  for_each = toset([
    "iam.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "containerregistry.googleapis.com"
  ])
  service = each.key

  disable_on_destroy = false
}

resource "google_service_account" "crack_detection_sa" {
  account_id   = var.sa_name
  display_name = "Crack Detection Service Account"
}

resource "google_project_iam_member" "sa_roles" {
  for_each = toset([
    "roles/compute.serviceAgent",
    "roles/container.serviceAgent",
    "roles/containerregistry.ServiceAgent",
    "roles/storage.admin"
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.crack_detection_sa.email}"
}

