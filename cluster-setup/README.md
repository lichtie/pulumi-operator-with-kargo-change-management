# Cluster Setup

This Pulumi project sets up foundational components for a Kubernetes cluster:
- Pulumi Kubernetes Operator (v2.3.0)
- cert-manager (v1.19.0)
- ArgoCD (stable)
- Argo Rollouts (latest)

**Note**: Kargo is deployed separately via the `kargo/` directory, not by this cluster-setup project.

## Prerequisites

- Pulumi CLI installed
- kubectl configured
- Existing Kubernetes cluster (referenced via stack output)

## Setup

1. **Configure the cluster stack reference:**
   ```bash
   pulumi config set clusterStack <your-cluster-stack>
   ```

   This should reference a Pulumi stack that exports a `kubeconfig` output.

2. **Set Pulumi API token (if not already configured):**
   ```bash
   pulumi config set --secret pulumiApiToken <your-token>
   ```

3. **Set AWS credentials (if needed for your cluster):**
   ```bash
   pulumi config set --secret awsAccessKeyId <your-access-key-id>
   pulumi config set --secret awsSecretAccessKey <your-secret-access-key>
   ```

   Check `Pulumi.dev.yaml` to see what's already configured.

## Deployment

Deploy all foundational components:
```bash
pulumi up
```

This will install:
- **Pulumi Kubernetes Operator**: Creates the pulumi-kubernetes-operator namespace and installs the operator (v2.3.0)
- **cert-manager**: Creates the cert-manager namespace and installs cert-manager with CRDs (v1.19.0)
- **ArgoCD**: Creates the argocd namespace and installs ArgoCD (stable version)
- **Argo Rollouts**: Creates the argo-rollouts namespace and installs Argo Rollouts (latest)

## Next Steps

After deploying the cluster setup, proceed to deploy Kargo:
```bash
cd ../kargo
# Follow instructions in ../kargo/README.md
```

## Accessing Services

### ArgoCD

Get the initial admin password:
```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
```

**For AWS-hosted clusters:**

Get the LoadBalancer URL:
```bash
kubectl get svc argocd-server -n argocd -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Access the ArgoCD UI at: `https://<loadbalancer-url>`

**For local/development clusters:**

Port-forward to access the UI:
```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```
Then access at: https://localhost:8080

## Cleanup

Remove all cluster-setup resources:
```bash
pulumi destroy
```

**Note**: If you deployed Kargo separately, clean it up first before destroying cluster-setup.

## Installation Equivalents

This Pulumi setup is equivalent to running:

```bash
# Pulumi Kubernetes Operator
helm install --create-namespace -n pulumi-kubernetes-operator pulumi-kubernetes-operator \
  oci://ghcr.io/pulumi/helm-charts/pulumi-kubernetes-operator --version 2.3.0

# cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.19.0/cert-manager.yaml

# ArgoCD
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Argo Rollouts
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
```

For Kargo installation, see `../kargo/README.md`.
