variable "project_id" {
  description = "The GCP project ID where resources will be created"
  type        = string
  default     = "concrete-detection-1-491711"
}
variable "region" {
  default = "us-central1"
}
variable "sa_name" {
  default = "crack-detection-1"
}
