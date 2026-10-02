output "cluster_name" {
  description = "The name of the AKS cluster"
  value       = azurerm_kubernetes_cluster.crack_detection.name
}

output "resource_group_name" {
  description = "The resource group containing the AKS cluster"
  value       = local.rg_name
}

output "cluster_id" {
  description = "The ID of the AKS cluster"
  value       = azurerm_kubernetes_cluster.crack_detection.id
}

output "cluster_endpoint" {
  description = "The Kubernetes API server endpoint"
  value       = azurerm_kubernetes_cluster.crack_detection.kube_config[0].host
}

output "kubeconfig" {
  description = "Raw kubeconfig content for connecting to the AKS cluster"
  value       = azurerm_kubernetes_cluster.crack_detection.kube_config_raw
  sensitive   = true
}

output "kubectl_config" {
  description = "Command to configure local kubectl to connect to the AKS cluster"
  value       = "az aks get-credentials --resource-group ${local.rg_name} --name ${azurerm_kubernetes_cluster.crack_detection.name} --overwrite-existing"
}
