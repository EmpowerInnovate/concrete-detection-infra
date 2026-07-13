terraform {
  backend "gcs" {
    bucket = "crack-detection-terraform"  # Replace with your manually created bucket name
    prefix = "gcp-bootstrap-mahesh/terraform"
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
    "dns.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "containerregistry.googleapis.com"
  ])
  service = each.key

  lifecycle {
    prevent_destroy = true
  }
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
    "roles/dns.admin",
    "roles/storage.admin"
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.crack_detection_sa.email}"
}

resource "google_dns_managed_zone" "crack_dns" {
  name        = var.dns_zone_name
  dns_name    = var.dns_domain
  description = "DNS zone for crack detection app"
}

resource "google_dns_record_set" "root_a_record" {
  name         = var.dns_domain
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.crack_dns.name
  rrdatas      = [var.ip_address]
}

resource "google_dns_record_set" "www_a_record" {
  name         = "www.${var.dns_domain}"
  type         = "A"
  ttl          = 300
  managed_zone = google_dns_managed_zone.crack_dns.name
  rrdatas      = [var.ip_address]
}
