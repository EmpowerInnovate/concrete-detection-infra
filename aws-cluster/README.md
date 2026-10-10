# AWS EKS Infrastructure for Crack Detection

This Terraform configuration sets up an Amazon Elastic Kubernetes Service (EKS) cluster with a managed node group and a dedicated VPC for the Crack Detection application.

## Architecture

- **Amazon EKS**: Managed Kubernetes control plane with a public API endpoint.
- **Managed Node Group**: `t3.medium` nodes, scaling between `min_nodes` (default 1) and `max_nodes` (default 3), starting at `desired_nodes` (default 2).
- **VPC**: Dedicated VPC `${cluster_name}-vpc` across 2 AZs — public subnets for load balancers, private subnets for nodes, single NAT gateway.
- **Add-ons**: CoreDNS, kube-proxy, VPC CNI, Pod Identity Agent and the **EBS CSI driver** (for PersistentVolumeClaims).
- **Access**: The IAM identity running Terraform gets cluster-admin via EKS access entries.
- **Remote State**: Stored in an S3 bucket with DynamoDB locking and per-cluster isolation (`eks/<cluster_name>.tfstate`).

> **Note:** The node group's min/max are bounds only. EKS does not autoscale nodes by itself — install
> [Cluster Autoscaler](https://github.com/kubernetes/autoscaler/tree/master/cluster-autoscaler) or Karpenter if you need automatic scaling.

## Prerequisites

1. An **AWS Account**.
2. An **IAM user** with `PowerUserAccess` and `IAMFullAccess` (or `AdministratorAccess`) and an access key.
3. An **S3 bucket** and **DynamoDB table** (`LockID` string hash key) for Terraform backend state.

> **Tip:** You can provision the IAM user, bucket and lock table using the `Setup AWS IAM User & Backend` workflow, or locally with [`../aws-iam-user/bootstrap-aws.sh`](../aws-iam-user/bootstrap-aws.sh).

## Manual Usage

### 1. Set AWS Environment Variables

```bash
export AWS_ACCESS_KEY_ID="<your-access-key-id>"
export AWS_SECRET_ACCESS_KEY="<your-secret-access-key>"
export AWS_REGION="us-east-1"
```

### 2. Initialize Terraform

```bash
terraform init \
  -backend-config="bucket=<tfstate-bucket>" \
  -backend-config="region=us-east-1" \
  -backend-config="dynamodb_table=crack-detection-tflock" \
  -backend-config="encrypt=true" \
  -backend-config="key=eks/crack-detection-cluster.tfstate"
```

### 3. Plan & Apply

```bash
terraform plan \
  -var="cluster_name=crack-detection-cluster" \
  -var="region=us-east-1" \
  -out=tfplan

terraform apply tfplan
```

Cluster creation takes roughly 15–20 minutes.

### 4. Connect to EKS

```bash
aws eks update-kubeconfig --region us-east-1 --name crack-detection-cluster
kubectl get nodes
```

### 5. Destroy

Delete all `LoadBalancer` Services, Ingresses and PVCs first — otherwise the ELBs/EBS volumes created by Kubernetes block VPC deletion:

```bash
kubectl delete svc --all --all-namespaces --field-selector metadata.name!=kubernetes
kubectl delete ingress,pvc --all --all-namespaces
terraform destroy -var="cluster_name=crack-detection-cluster" -var="region=us-east-1"
```

## Cost Note

Approximate running cost in `us-east-1`: EKS control plane (~$73/month) + NAT gateway (~$32/month + data) + 2× `t3.medium` (~$60/month). Destroy the cluster when not in use.
