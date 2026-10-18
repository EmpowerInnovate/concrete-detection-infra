output "cluster_name" {
  description = "The name of the EKS cluster"
  value       = module.eks.cluster_name
}

output "region" {
  description = "The AWS region the EKS cluster runs in"
  value       = var.region
}

output "cluster_arn" {
  description = "The ARN of the EKS cluster"
  value       = module.eks.cluster_arn
}

output "cluster_endpoint" {
  description = "The Kubernetes API server endpoint"
  value       = module.eks.cluster_endpoint
  sensitive   = true
}

output "vpc_id" {
  description = "The ID of the VPC hosting the cluster"
  value       = module.vpc.vpc_id
}

output "kubectl_config" {
  description = "Command to configure local kubectl to connect to the EKS cluster"
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}"
}
