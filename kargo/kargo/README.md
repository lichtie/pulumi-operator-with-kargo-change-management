# Kargo Progressive Delivery Setup

This directory contains Kargo manifests for a progressive delivery pipeline integrating with Pulumi Kubernetes Operator (PKO). The pipeline demonstrates automated deployments with approval gates, preview stages, and verification steps for the `security-scanner` application.

## Quick Start Checklist

Before applying these manifests:
- [ ] Kargo is deployed and accessible via UI
- [ ] Created project `kargo-managed-stack` in Kargo UI (this creates the namespace)
- [ ] Created `pulumisecret` with PULUMI_ACCESS_TOKEN via Kargo UI (Project Settings → Secrets)
- [ ] Have your GitHub PAT ready to add to `01-github-credentials.yaml`

## Architecture

```
Warehouse (security-scan-repo)
    ↓
Approval Gate Dev (approvalgatedev) - manual approval checkpoint
    ↓
Dev Preview Stages (devpreview, dev2preview) - auto-promote, run Pulumi preview
    ↓
Dev Stages (dev, dev2) - auto-promote, run Pulumi update
    ↓
QA Preview Stage (qapreview) - auto-promote, run Pulumi preview
    ↓
QA Stage (qa) - run Pulumi update
```

**Key Features:**
- **Approval Gates**: Manual checkpoints to control progression from warehouse to downstream stages
- **Preview Stages**: Run Pulumi previews before actual deployments to validate infrastructure changes
- **Verification**: Analysis templates check Pulumi API to verify successful previews/updates
- **Multi-Environment**: Parallel dev and dev2 environments for testing different configurations

## Files

**Credentials & Secrets:**
- `01-github-credentials.yaml` - GitHub credentials for repository access
- `01-secrets.yaml` - Additional secrets configuration

**Approval Gates:**
- `02-approval-gate-dev.yaml` - Manual approval gate before dev preview stages
- `02-approval-gate-qa.yaml` - Manual approval gate before QA stages

**Stage Definitions:**
- `02-stage-dev-preview.yaml` - Dev preview stage (runs Pulumi preview)
- `02-stage-dev-preview2.yaml` - Dev2 preview stage (runs Pulumi preview)
- `02-stage-dev.yaml` - Dev stage (runs Pulumi update)
- `02-stage-dev2.yaml` - Dev2 stage (runs Pulumi update)
- `02-stage-qa-preview.yaml` - QA preview stage (runs Pulumi preview)
- `02-stage-qa.yaml` - QA stage (runs Pulumi update)

**Verification & Configuration:**
- `03-analysis-template-preview.yaml` - Analysis template to verify Pulumi preview success
- `03-analysis-template-update.yaml` - Analysis template to verify Pulumi update success
- `04-project-config.yaml` - Project-wide configuration including auto-promotion policies

## Prerequisites

1. **Kargo Deployed**: Ensure Kargo is deployed to your cluster (see `../README.md`)

2. **Kargo Project Setup** (via Kargo UI):
   - Access the Kargo UI (see parent README for access instructions)
   - Create a new project named `kargo-managed-stack`
   - The project will automatically create the namespace

3. **Pulumi Secret** (MUST be created via Kargo UI):
   - In Kargo UI, navigate to your project → Settings → Secrets
   - Create a new secret named `pulumisecret`
   - Add key: `PULUMI_ACCESS_TOKEN`
   - Add value: your Pulumi API token

4. **GitHub Personal Access Token**:
   - You'll need a GitHub PAT with repo access
   - Edit `01-github-credentials.yaml` and replace the placeholder values with:
     - Your GitHub username
     - Your GitHub PAT
     - Your repository URL (if different)

5. **GitHub Repositories**:
   - **Application repo** (`security-scanner`): Source code repository that Kargo watches
   - **Manifests repo** (`kargo-manifests`): Contains Pulumi stack YAML files that stages update
   - Your PAT needs write access to both repositories

6. **Pulumi Stacks**:
   - Pulumi stacks for environments: dev, dev2, qa (with preview variants)
   - Stack files in kargo-manifests repo: `stacks/dev.yaml`, `stacks/dev2.yaml`, `stacks/qa.yaml`, etc.

## Installation

**Note**: Before applying manifests, ensure you've completed all prerequisites above, especially creating the Kargo project and `pulumisecret` via the UI.

1. **Edit GitHub credentials**: Open `01-github-credentials.yaml` and replace with your values:
   - `username`: Your GitHub username
   - `password`: Your GitHub PAT
   - `repoURL`: Your kargo-manifests repository URL

2. **Apply credentials and secrets**:
   ```bash
   kubectl apply -f 01-github-credentials.yaml
   kubectl apply -f 01-secrets.yaml
   ```

3. **Apply approval gates**:
   ```bash
   kubectl apply -f 02-approval-gate-dev.yaml
   kubectl apply -f 02-approval-gate-qa.yaml
   ```

4. **Apply stage definitions**:
   ```bash
   kubectl apply -f 02-stage-*.yaml
   ```

5. **Apply analysis templates and configuration**:
   ```bash
   kubectl apply -f 03-analysis-template-*.yaml
   kubectl apply -f 04-project-config.yaml
   ```

Or apply all at once:
```bash
kubectl apply -f .
```

**Important**: The `kargo-managed-stack` namespace is automatically created when you create the project in the Kargo UI, so you don't need to create it manually.

## Usage

### View Stages and Freight

```bash
# Get all stages
kubectl get stages -n kargo-managed-stack

# Get freight (versions)
kubectl get freight -n kargo-managed-stack

# View stage details
kubectl describe stage dev -n kargo-managed-stack

# Check approval gate status
kubectl describe stage approvalgatedev -n kargo-managed-stack
```

### Approval and Promotion Workflow

**1. Approve at Approval Gate** (Manual):
```bash
# Approve freight at the dev approval gate
kubectl kargo approve \
  --stage=approvalgatedev \
  --freight=<freight-name> \
  -n kargo-managed-stack
```

**2. Preview Stages** (Auto-promote):
- `devpreview` and `dev2preview` automatically promote from the approval gate
- Run Pulumi preview operations
- Verification checks preview success via analysis templates

**3. Dev Stages** (Auto-promote):
- `dev` and `dev2` automatically promote from their preview stages
- Run Pulumi update operations
- Verification checks update success

**4. QA Stages** (Auto-promote for preview, manual for qa):
- `qapreview` automatically promotes
- `qa` requires manual promotion

**Via Kargo UI:**
1. Access the Kargo UI (see parent README for LoadBalancer URL or port-forward instructions)
2. Navigate to the `kargo-managed-stack` project
3. Approve freight at approval gates
4. Monitor automatic promotions through preview and dev stages
5. Manually promote to QA when ready

## How It Works

1. **Developer pushes to security-scanner repo**
   - Warehouse (`security-scan-repo`) detects the new commit
   - Creates new Freight with commit SHA
   - Freight arrives at approval gate (`approvalgatedev`)

2. **Manual approval at gate**
   - DevOps/Team Lead reviews and approves freight at `approvalgatedev`
   - Approved freight becomes available to downstream stages

3. **Preview stages run automatically** (devpreview, dev2preview)
   - Stages auto-promote from approval gate
   - Update respective stack files in kargo-manifests repo (e.g., `stacks/dev2preview.yaml`)
   - Pulumi Operator runs `pulumi preview` for the stack
   - Analysis template verifies preview success via Pulumi API
   - Wait 5 minutes for Pulumi operation to complete

4. **Dev stages deploy automatically** (dev, dev2)
   - Auto-promote from their respective preview stages
   - Update stack files in kargo-manifests repo (e.g., `stacks/dev2.yaml`)
   - Pulumi Operator runs `pulumi up` for the stack
   - Analysis template verifies update success via Pulumi API

5. **QA preview runs automatically** (qapreview)
   - Auto-promotes when dev/dev2 are stable
   - Runs Pulumi preview for QA environment
   - Verifies preview success

6. **QA deployment** (qa)
   - Requires manual promotion from qapreview
   - Runs full Pulumi update
   - Verifies deployment success

**Key Integration Points:**
- Stages update YAML files in the `kargo-manifests` repository
- Pulumi Kubernetes Operator watches these files and triggers Pulumi operations
- Analysis templates query Pulumi API to verify operations succeeded with correct commit ID

## Monitoring

**Check Kargo stages and freight:**
```bash
# View all stages
kubectl get stages -n kargo-managed-stack

# View freight status
kubectl get freight -n kargo-managed-stack

# Check specific stage details
kubectl describe stage dev2 -n kargo-managed-stack

# View verification status
kubectl get analysisruns -n kargo-managed-stack
```

**Monitor Pulumi operations:**
```bash
# Check Pulumi Stack resources (in namespace where PKO is deployed)
kubectl get stacks -A

# View stack details
kubectl describe stack security-scanner-dev2

# Check Pulumi Operator logs
kubectl logs -n pulumi-kubernetes-operator -l app.kubernetes.io/name=pulumi-kubernetes-operator
```

**View analysis template results:**
```bash
# Get analysis runs
kubectl get analysisruns -n kargo-managed-stack

# Describe specific analysis run
kubectl describe analysisrun <run-name> -n kargo-managed-stack
```

## Troubleshooting

**Freight stuck at approval gate:**
- Check approval gate status: `kubectl describe stage approvalgatedev -n kargo-managed-stack`
- Manually approve if needed: `kubectl kargo approve --stage=approvalgatedev --freight=<name> -n kargo-managed-stack`

**Stage not auto-promoting:**
- Verify auto-promotion is enabled: Check `04-project-config.yaml`
- Check stage status: `kubectl describe stage <stage-name> -n kargo-managed-stack`
- Verify freight is available from upstream stage
- Check for failed verifications: `kubectl get analysisruns -n kargo-managed-stack`

**Verification failing:**
- Check analysis run details: `kubectl describe analysisrun <run-name> -n kargo-managed-stack`
- Verify Pulumi secret exists: `kubectl get secret pulumisecret -n kargo-managed-stack`
  - If missing, create it via Kargo UI: Project Settings → Secrets (see Prerequisites section)
  - Ensure the secret contains key `PULUMI_ACCESS_TOKEN` with a valid token
- Check Pulumi API token is valid and has access to the elisabeth-demo/security-scanner stacks
- Ensure commit ID in Pulumi update matches freight commit
- Verify the analysis template is querying the correct Pulumi organization and stack names

**Pulumi operations not triggering:**
- Verify kargo-manifests repo was updated with correct commit
- Check PKO is watching the manifests repo
- View PKO logs for errors
- Confirm stack YAML files exist in manifests repo

## Customization

### Add more environments

To add UAT or Prod stages:
1. Create preview stage (e.g., `02-stage-uat-preview.yaml`)
2. Create deployment stage (e.g., `02-stage-uat.yaml`)
3. Add corresponding stack files in kargo-manifests repo
4. Update `04-project-config.yaml` with promotion policies
5. Consider adding approval gates before critical environments

### Adjust verification timing

Modify the `initialDelay` in analysis templates:
```yaml
spec:
  metrics:
    - name: check-pulumi-update
      initialDelay: 5m  # Adjust based on your Pulumi operation duration
```

### Change auto-promotion behavior

Edit `04-project-config.yaml`:
```yaml
spec:
  promotionPolicies:
    - stageSelector:
        name: qa  # Stage name
      autoPromotionEnabled: false  # Set to false for manual promotion
```

### Add additional approval gates

Create new approval gate stages between environments:
```yaml
apiVersion: kargo.akuity.io/v1alpha1
kind: Stage
metadata:
  name: approvalgateqa
  namespace: kargo-managed-stack
spec:
  requestedFreight:
    - origin:
        kind: Warehouse
        name: security-scan-repo
      sources:
        direct: false
        stages:
          - qa
```

### Customize Pulumi verification

Modify analysis templates to check for specific Pulumi update properties:
- Change success conditions
- Add additional metrics
- Adjust API endpoints for different Pulumi organizations
