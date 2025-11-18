# Kargo Setup with Pulumi

This directory contains:
1. **Pulumi program** (`index.ts`) - Deploys Kargo and its dependencies to a Kubernetes cluster
2. **Kargo manifests** (`kargo/` subdirectory) - Stage definitions, approval gates, and analysis templates

## Components Deployed

The Pulumi program deploys:
- **Kargo** (via Helm) - Progressive delivery orchestration platform with OIDC authentication
- Dependencies (installed separately via cluster-setup):
  - Pulumi Kubernetes Operator (PKO)
  - cert-manager
  - ArgoCD
  - Argo Rollouts
  - AWS Cognito User Pool (for OIDC)

## Prerequisites

- Kubernetes cluster (set up via `cluster-setup/` directory first)
- Pulumi CLI installed
- kubectl configured
- htpasswd utility (for generating Kargo password hash)
- openssl (for generating secrets)

## Part 1: Deploy Kargo via Pulumi

1. **Configure the cluster stack reference:**
   ```bash
   pulumi config set clusterStack <your-cluster-stack>
   ```

   This stack should have AWS Cognito configured (see `cluster-setup/README.md` for Cognito setup).

2. **Configure Cognito user IDs for OIDC:**

   After creating users in Cognito (see cluster-setup README), get their `sub` values and update `index.ts`:
   ```typescript
   users: {
     claims: {
       sub: ["<cognito-user-sub-1>", "<cognito-user-sub-2>"],
     },
   },
   ```

3. **Generate and configure Kargo admin credentials:**
   ```bash
   ./generate-kargo-secrets.sh
   ```

   This script will:
   - Generate a random 32-character password
   - Hash the password using bcrypt
   - Generate a random 32-character token signing key
   - Configure both secrets in Pulumi
   - Display the plaintext password (save it securely!)

   The generated password will be saved to `.env` file.

4. **Deploy Kargo:**
   ```bash
   pulumi up
   ```

   This installs Kargo via Helm into the `kargo` namespace with:
   - Admin credentials configured
   - OIDC authentication enabled via AWS Cognito
   - Dex (built-in auth) disabled

## Part 2: Apply Kargo Manifests

After Kargo is deployed, configure the progressive delivery pipeline:

1. **Create Kargo Project via UI:**
   - Access the Kargo UI (see "Accessing Kargo" section below for LoadBalancer URL)
   - Create a new project named `kargo-managed-stack`
   - This automatically creates the namespace

2. **Create Pulumi Secret via UI:**
   - In the Kargo UI, navigate to Project Settings → Secrets
   - Create a new secret named `pulumisecret`
   - Add key: `PULUMI_ACCESS_TOKEN` with your Pulumi API token as the value


3. **Edit GitHub credentials:**
   - Open `kargo/01-github-credentials.yaml`
   - Replace the placeholder values with your GitHub username, PAT, and repository URL

4. **Apply all Kargo manifests:**
   ```bash
   kubectl apply -f kargo/
   ```

   This creates:
   - Approval gates for controlled progression
   - Preview stages (devpreview, dev2preview, qapreview)
   - Deployment stages (dev, dev2, qa)
   - Analysis templates for Pulumi verification
   - Project configuration with auto-promotion policies

See the detailed documentation in `kargo/README.md` for the complete pipeline architecture and usage.

## Accessing Kargo

Kargo is configured with OIDC authentication via AWS Cognito. You can authenticate using:

**Option 1: OIDC (AWS Cognito)** - Recommended
- Users configured in the Cognito User Pool can sign in
- Uses OAuth 2.0 authorization code flow
- First-time users will need to change their temporary password

**Option 2: Admin credentials** - For initial setup/emergencies
- **Username**: admin
- **Password**: (from `.env` file or `generate-kargo-secrets.sh` output)

**For AWS-hosted clusters:**

Get the LoadBalancer URL:
```bash
kubectl get svc kargo-api -n kargo -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Access the Kargo UI at: `http://<loadbalancer-url>`
- Click "Login with OIDC" to authenticate via Cognito
- Or use admin credentials for direct login

**For local/development clusters:**

Port-forward to access the UI:
```bash
kubectl port-forward svc/kargo-api -n kargo 8081:80
```
Then access at: http://localhost:8081

**Note**: For OIDC to work properly, you need to:
1. Access Kargo via the configured hostname (not localhost or IP)
2. Ensure the hostname is configured in `cluster-setup` Pulumi config
3. The hostname must match the callback URLs in Cognito App Client

## Setting Up Custom Roles for Approvers

For users authenticated via OIDC who should only have permission to approve freight at specific gates (e.g., security team members who only approve at the security gate), you can create custom roles in Kargo:

![Kargo Approver Role Setup](kargo/kargo_approver_role_setup.png)

**Example: Security Approver Role**

Create a custom role that grants:
- **Stage-specific approval permissions** - Limited to specific approval gates (e.g., `approvalgateqasec`)
- **Read-only access** to other stages - Can view but not modify other parts of the pipeline
- **Project-level scope** - Applies to the `kargo-managed-stack` project

This follows the principle of least privilege, ensuring users only have the permissions they need for their specific responsibilities.

**To set up custom roles:**
1. Log in to Kargo UI as admin
2. Navigate to Project Settings → Roles
3. Create a new role with stage-specific permissions
4. Assign the role to OIDC users based on their responsibilities

See the screenshot in `kargo/kargo_approver_role_setup.png` for a visual guide on configuring these roles.

## Using the Pipeline

Once Kargo is deployed and manifests are applied:

1. **View the pipeline** in Kargo UI
2. **Approve freight** at approval gates
3. **Monitor** automatic promotions through preview and dev stages
4. **Manually promote** to QA when ready

See `kargo/README.md` for detailed usage instructions.

## Cleanup

Remove Kargo and manifests:
```bash
# Remove Kargo manifests
kubectl delete -f kargo/

# Delete the project (via Kargo UI or kubectl)
kubectl delete project kargo-managed-stack -n kargo-managed-stack

# Remove Kargo namespace (if not automatically removed with project deletion)
kubectl delete namespace kargo-managed-stack

# Destroy Pulumi stack (removes Kargo installation)
pulumi destroy
```

## Related

- **Cluster Setup**: See `../cluster-setup/README.md` for setting up the base cluster with PKO, ArgoCD, etc.
- **Kargo Manifests**: See `kargo/README.md` for detailed pipeline configuration and usage
