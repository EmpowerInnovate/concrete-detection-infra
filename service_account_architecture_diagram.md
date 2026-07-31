# GCP Service Account Architecture & Provisioning Hierarchy

This document provides a clear, full-name architectural layout and sequence flow for GCP Service Account role delegation and infrastructure provisioning.

---

## 1. Service Account Hierarchy & Role Delegation Diagram

```mermaid
graph TD
    subgraph Level1["Level 1: Administrative Control Plane"]
        MainSA["Main Admin Service Account<br/>(secrets.MAHESH_GCP_SERVICE_ACCOUNT_KEY)"]
        
        subgraph MainRoles["Admin IAM Roles (Full Project Control)"]
            OwnerRole["Owner"]
            IAMAdminRole["Project IAM Admin"]
            SAAdminRole["Service Account Admin"]
            SAKeyAdminRole["Service Account Key Admin"]
            UsageAdminRole["Service Usage Admin"]
        end

        MainSA --> OwnerRole
        MainSA --> IAMAdminRole
        MainSA --> SAAdminRole
        MainSA --> SAKeyAdminRole
        MainSA --> UsageAdminRole
    end

    subgraph Level2["Level 2: Target Deployment Service Account"]
        TargetSA["Target Deployment Service Account<br/>(e.g., crack-detection-1@project.iam.gserviceaccount.com)"]
        
        subgraph TargetRoles["Assigned Target IAM Roles"]
            CompRole["Compute Engine Service Agent"]
            CRRole["Container Registry Service Agent"]
            GKERole["Kubernetes Engine Service Agent"]
            StoreRole["Storage Admin"]
        end

        TargetSA --> CompRole
        TargetSA --> CRRole
        TargetSA --> GKERole
        TargetSA --> StoreRole
    end

    subgraph Level3["Level 3: Infrastructure & Application Workloads"]
        GKECluster["GKE Kubernetes Cluster<br/>(crack-detection-cluster)"]
        Containers["Google Container Registry<br/>(Docker Images)"]
        TFState["GCS Storage Buckets<br/>(Terraform State Files)"]
        HelmApps["Kubernetes Application Workloads<br/>(masterChart & nfsServerChart)"]
    end

    %% Hierarchy Relationships
    MainSA ==>|1. Provisions Service Account & Assigns Roles| TargetSA
    
    TargetSA ==>|2. Provisions Compute & Nodes| GKECluster
    TargetSA ==>|3. Stores & Retrieves State| TFState
    TargetSA ==>|4. Manages Container Images| Containers
    TargetSA ==>|5. Deploys Helm Applications| HelmApps
```

---

## 2. End-to-End Workflow Execution Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Developer as DevOps Engineer
    participant CreationWF as Workflow: Setup GCP Service Account
    participant MainSA as Main Admin Service Account
    participant TargetSA as Target Deployment Service Account
    participant ClusterWF as Workflow: Deploy Kubernetes Cluster
    participant GCPProject as GCP Target Project

    Note over Developer, GCPProject: STEP 1: Service Account & Role Provisioning
    Developer->>CreationWF: Trigger workflow with Project ID, Account Name & SA Name
    CreationWF->>MainSA: Authenticate using Main SA Key
    Note over MainSA: Main SA uses Admin Roles:<br/>• Owner<br/>• Project IAM Admin<br/>• Service Account Admin<br/>• Service Account Key Admin<br/>• Service Usage Admin
    MainSA->>GCPProject: Enable APIs (compute, container, iam, cloudresourcemanager, etc.)
    MainSA->>GCPProject: Create Target Service Account (e.g. crack-detection-1)
    MainSA->>GCPProject: Bind Roles to Target SA:<br/>• Compute Engine Service Agent<br/>• Container Registry Service Agent<br/>• Kubernetes Engine Service Agent<br/>• Storage Admin
    GCPProject-->>CreationWF: Target Service Account Provisioned & Roles Assigned

    Note over Developer, GCPProject: STEP 2: Cluster Provisioning & Application Deployment
    Developer->>ClusterWF: Trigger cluster workflow with Target SA Key
    ClusterWF->>TargetSA: Authenticate using Target SA Key
    Note over TargetSA: Target SA uses Assigned Roles:<br/>• Compute Engine Service Agent<br/>• Container Registry Service Agent<br/>• Kubernetes Engine Service Agent<br/>• Storage Admin
    TargetSA->>GCPProject: Provision GKE Cluster & Node Pools
    TargetSA->>GCPProject: Manage GCS Backend State Buckets
    TargetSA->>GCPProject: Pull Docker Images & Deploy Helm Charts
    GCPProject-->>ClusterWF: Cluster & Workloads Successfully Deployed
```

---

## 3. Role Breakdown & Purpose Matrix

### **Level 1: Main Admin Service Account**
Used by **`setup-gcp-service-account.yaml`** to perform administrative bootstrap operations.

| Full Role Display Name | GCP Technical Identifier | Purpose & Access Scope |
| :--- | :--- | :--- |
| **Owner** | `roles/owner` | Provides full access to all project resources. |
| **Project IAM Admin** | `roles/resourcemanager.projectIamAdmin` | Allows assigning and managing IAM role bindings for created service accounts. |
| **Service Account Admin** | `roles/iam.serviceAccountAdmin` | Allows creating, deleting, and managing custom Service Accounts. |
| **Service Account Key Admin** | `roles/iam.serviceAccountKeyAdmin` | Allows creating and managing Service Account JSON credential keys. |
| **Service Usage Admin** | `roles/serviceusage.serviceUsageAdmin` | Allows enabling required Google Cloud APIs (`compute`, `container`, `iam`, etc.). |

---

### **Level 2: Target Deployment Service Account**
Created dynamically (e.g., `crack-detection-1`, `crack-detection-3`) and used by **`deploy-kubernetes-cluster.yaml`** for routine infrastructure provisioning and app deployment.

| Full Role Display Name | GCP Technical Identifier | Purpose & Access Scope |
| :--- | :--- | :--- |
| **Compute Engine Service Agent** | `roles/compute.serviceAgent` | Allows managing Virtual Machines, VPC networks, firewalls, and load balancers for GKE nodes. |
| **Container Registry Service Agent** | `roles/containerregistry.ServiceAgent` | Allows storing, pulling, and pushing Docker container images. |
| **Kubernetes Engine Service Agent** | `roles/container.serviceAgent` | Allows GKE control plane operations to manage Kubernetes cluster nodes and workloads. |
| **Storage Admin** | `roles/storage.admin` | Full control over Google Cloud Storage (GCS) buckets used for Terraform backend state files. |
