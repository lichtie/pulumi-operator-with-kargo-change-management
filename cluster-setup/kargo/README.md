# Kargo Progressive Delivery Setup

This directory contains Kargo manifests to set up a progressive delivery pipeline for the `security-scanner` application across dev, qa, uat, and prod environments.

## Architecture

```
Warehouse (watches main)
    ↓
Dev Stage (auto-deploy)
    ↓ (manual promotion)
QA Stage
    ↓ (manual promotion)
UAT Stage
    ↓ (manual promotion)
Prod Stage
```

## Files

- `00-namespace.yaml` - Kargo project namespace
- `01-warehouse.yaml` - Warehouse that watches the main branch
- `02-stage-dev.yaml` - Dev stage (auto-deploys from warehouse)
- `03-stage-qa.yaml` - QA stage (manual promotion from dev)
- `04-stage-uat.yaml` - UAT stage (manual promotion from qa)
- `05-stage-prod.yaml` - Prod stage (manual promotion from uat)
- `06-pulumi-stacks.yaml` - Pulumi Stack CRs for each environment

## Prerequisites

1. **GitHub Repository Setup**: Your `security-scanner` repo needs:
   - Branch protection on `stages/*` branches (optional but recommended)
   - Kargo needs write access (PAT or GitHub App)

2. **Kargo Credentials**: Create a secret for GitHub access:
   ```bash
   kubectl create secret generic github-creds \
     -n kargo-demo \
     --from-literal=username=your-github-username \
     --from-literal=password=your-github-pat
   ```

3. **Pulumi Backend Stacks**: Create Pulumi stacks for each environment:
   ```bash
   pulumi stack init elisabeth-demo/security-scanner/dev
   pulumi stack init elisabeth-demo/security-scanner/qa
   pulumi stack init elisabeth-demo/security-scanner/uat
   pulumi stack init elisabeth-demo/security-scanner/prod
   ```

## Installation

Apply the manifests in order:

```bash
kubectl apply -f kargo/00-namespace.yaml
kubectl apply -f kargo/01-warehouse.yaml
kubectl apply -f kargo/02-stage-dev.yaml
kubectl apply -f kargo/03-stage-qa.yaml
kubectl apply -f kargo/04-stage-uat.yaml
kubectl apply -f kargo/05-stage-prod.yaml
kubectl apply -f kargo/06-pulumi-stacks.yaml
```

Or apply all at once:

```bash
kubectl apply -f kargo/
```

## Usage

### View Stages and Freight

```bash
# Get all stages
kubectl get stages -n kargo-demo

# Get freight (versions)
kubectl get freight -n kargo-demo

# View stage details
kubectl describe stage dev -n kargo-demo
```

### Promote Between Stages

**Via Kargo UI:**
1. Access the Kargo UI at the LoadBalancer address
2. Navigate to the `kargo-demo` project
3. Click on a stage to see available freight
4. Click "Promote" to move freight to the next stage

**Via CLI:**
```bash
# Promote from dev to qa
kubectl kargo promote \
  --stage=qa \
  --freight=<freight-name> \
  -n kargo-demo

# Promote from qa to uat
kubectl kargo promote \
  --stage=uat \
  --freight=<freight-name> \
  -n kargo-demo

# Promote from uat to prod
kubectl kargo promote \
  --stage=prod \
  --freight=<freight-name> \
  -n kargo-demo
```

## How It Works

1. **Developer pushes to main branch**
   - Warehouse detects the new commit
   - Creates new Freight with commit SHA

2. **Dev automatically deploys**
   - Kargo updates `stages/dev` branch with the new commit
   - Pulumi Operator detects branch change
   - Runs `pulumi up` for dev stack

3. **Manual promotion to QA**
   - Operator/DevOps promotes freight from dev to qa
   - Kargo updates `stages/qa` branch
   - Pulumi Operator deploys to qa stack

4. **Manual promotion to UAT**
   - After QA validation, promote to uat
   - Kargo updates `stages/uat` branch
   - Pulumi Operator deploys to uat stack

5. **Manual promotion to Prod**
   - After UAT validation, promote to prod
   - Kargo updates `stages/prod` branch
   - Pulumi Operator deploys to prod stack

## Monitoring

**Check Pulumi Stack status:**
```bash
kubectl get stacks -n default
kubectl describe stack security-scanner-dev
```

**View Pulumi Stack logs:**
```bash
kubectl logs -n default -l pulumi.com/stack-name=security-scanner-dev
```

## Troubleshooting

**Warehouse not detecting commits:**
- Check GitHub credentials: `kubectl get secret github-creds -n kargo-demo`
- View warehouse status: `kubectl describe warehouse security-scanner-warehouse -n kargo-demo`

**Stage not promoting:**
- Check stage status: `kubectl describe stage <stage-name> -n kargo-demo`
- Verify freight is available: `kubectl get freight -n kargo-demo`

**Pulumi Stack failing:**
- Check stack status: `kubectl describe stack security-scanner-<env>`
- View operator logs: `kubectl logs -n pulumi-kubernetes-operator -l app.kubernetes.io/name=pulumi-kubernetes-operator`

## Customization

### Add verification steps

Add to any stage manifest:

```yaml
spec:
  verification:
    analysisTemplates:
    - name: smoke-test
    - name: load-test
```

### Change promotion policy

For automatic promotions (e.g., dev → qa):

```yaml
spec:
  promotionMechanisms:
    autoPromotionEnabled: true
```

### Add approval requirements

```yaml
spec:
  promotionMechanisms:
    approvalRequired: true
```
