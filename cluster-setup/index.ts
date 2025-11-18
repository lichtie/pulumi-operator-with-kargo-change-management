import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as aws from "@pulumi/aws";

// ============================================================================
// STEP 2: PREREQUISITES
// ============================================================================
// Install core dependencies: Service accounts, Pulumi operator, cert-manager,
// ArgoCD, and Argo Rollouts - all required before Kargo installation

// Get the kubeconfig from the cluster stack
const config = new pulumi.Config();
const awsConfig = new pulumi.Config("aws");

const clusterStackRef = new pulumi.StackReference(
  config.require("clusterStack")
);
const kubeconfig = clusterStackRef.requireOutput("kubeconfig");

// Create a Kubernetes provider using the kubeconfig from the cluster stack
const k8sProvider = new k8s.Provider("k8s-provider", {
  kubeconfig: kubeconfig,
});

// Create a service account in the default namespace
const serviceAccount = new k8s.core.v1.ServiceAccount(
  "pulumi",
  {
    metadata: {
      name: "pulumi",
      namespace: "default",
    },
  },
  { provider: k8sProvider }
);

// Bind the service account to the system:auth-delegator ClusterRole
// This provides permissions for TokenReview and SubjectAccessReview
const clusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding(
  "default-pulumi-system-auth-delegator",
  {
    metadata: {
      name: "default:pulumi:system:auth-delegator",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "pulumi",
        namespace: "default",
      },
    ],
    roleRef: {
      kind: "ClusterRole",
      name: "system:auth-delegator",
      apiGroup: "rbac.authorization.k8s.io",
    },
  },
  { provider: k8sProvider }
);

// Install Pulumi Kubernetes Operator
const pulumiOperatorNamespace = new k8s.core.v1.Namespace(
  "pulumi-kubernetes-operator-ns",
  {
    metadata: {
      name: "pulumi-kubernetes-operator",
    },
  },
  { provider: k8sProvider }
);

const pulumiOperator = new k8s.helm.v3.Release(
  "pulumi-kubernetes-operator",
  {
    chart: "oci://ghcr.io/pulumi/helm-charts/pulumi-kubernetes-operator",
    version: "2.3.0",
    namespace: pulumiOperatorNamespace.metadata.name,
  },
  { provider: k8sProvider, dependsOn: [pulumiOperatorNamespace] }
);

// Create a secret for the Pulumi API
const accessToken = new k8s.core.v1.Secret(
  "accessToken",
  {
    metadata: { name: "pulumi-api-secret", namespace: "default" },
    stringData: { accessToken: config.requireSecret("pulumiApiToken") },
  },
  { provider: k8sProvider, dependsOn: [pulumiOperator] }
);

const awsCredentials = new k8s.core.v1.Secret(
  "awsAccessToken",
  {
    metadata: { name: "pulumi-aws-secret", namespace: "default" },
    stringData: {
      awsAccessKeyId: config.requireSecret("awsAccessKeyId"),
      secretAccessKey: config.requireSecret("awsSecretAccessKey"),
    },
  },
  { provider: k8sProvider, dependsOn: [pulumiOperator] }
);

// TODO: reimplement me through kargo with proper CI/CD
// const mystack = new k8s.apiextensions.CustomResource(
//   "my-stack",
//   {
//     apiVersion: "pulumi.com/v1",
//     kind: "Stack",
//     spec: {
//       serviceAccountName: "pulumi",
//       envRefs: {
//         PULUMI_ACCESS_TOKEN: {
//           type: "Secret",
//           secret: {
//             name: accessToken.metadata.name,
//             key: "accessToken",
//           },
//         },
//         AWS_REGION: { type: "Literal", literal: { value: "us-east-1" } },
//         AWS_ACCESS_KEY_ID: {
//           type: "Secret",
//           secret: { name: awsCredentials.metadata.name, key: "awsAccessKeyId" },
//         },
//         AWS_SECRET_ACCESS_KEY: {
//           type: "Secret",
//           secret: { name: awsCredentials.metadata.name, key: "secretAccessKey" },
//         },
//       },
//       stack: "elisabeth-demo/security-scanner/dev",
//       projectRepo: "https://github.com/lichtie/security-scanner",
//       repoDir: ".",
//       // commit: "03658b5514f08970f350618a6e6fdf1bd75f45d0",
//       branch: "main", // Alternatively, track master branch.
//       destroyOnFinalize: true,
//     },
//   },
//   { provider: k8sProvider, dependsOn: [pulumiOperator] }
// );

// Install cert-manager using raw manifest
const certManager = new k8s.yaml.ConfigFile(
  "cert-manager",
  {
    file: "https://github.com/cert-manager/cert-manager/releases/download/v1.19.0/cert-manager.yaml",
  },
  { provider: k8sProvider }
);

// Install ArgoCD using raw manifest
const argoCDNamespace = new k8s.core.v1.Namespace(
  "argocd-ns",
  {
    metadata: {
      name: "argocd",
    },
  },
  { provider: k8sProvider }
);

const argoCD = new k8s.yaml.ConfigFile(
  "argocd",
  {
    file: "https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml",
    transformations: [
      (obj: any) => {
        if (obj.metadata) {
          obj.metadata.namespace = "argocd";
        }
      },
    ],
  },
  { provider: k8sProvider, dependsOn: [argoCDNamespace] }
);

// Install Argo Rollouts using raw manifest
const argoRolloutsNamespace = new k8s.core.v1.Namespace(
  "argo-rollouts-ns",
  {
    metadata: {
      name: "argo-rollouts",
    },
  },
  { provider: k8sProvider }
);

const argoRollouts = new k8s.yaml.ConfigFile(
  "argo-rollouts",
  {
    file: "https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml",
    transformations: [
      (obj: any) => {
        if (obj.metadata) {
          obj.metadata.namespace = "argo-rollouts";
        }
      },
    ],
  },
  { provider: k8sProvider, dependsOn: [argoRolloutsNamespace] }
);

// Create ArgoCD AppProject for application management
const argoCDProject = new k8s.apiextensions.CustomResource(
  "default-project",
  {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "AppProject",
    metadata: {
      name: "default",
      namespace: "argocd",
    },
    spec: {
      sourceRepos: ["*"],
      destinations: [
        {
          namespace: "*",
          server: "*",
        },
      ],
      clusterResourceWhitelist: [
        {
          group: "*",
          kind: "*",
        },
      ],
    },
  },
  { provider: k8sProvider, dependsOn: [argoCD] }
);

// Create ArgoCD Application to manage Pulumi Stack CRs
const argoCDApp = new k8s.apiextensions.CustomResource(
  "security-scanner-dev-app",
  {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: {
      name: "security-scanner",
      namespace: "argocd",
    },
    spec: {
      project: "default",
      source: {
        repoURL: config.require("stackManifestsRepo"), // e.g., https://github.com/lichtie/kargo-manifests
        targetRevision: "main",
        path: "stacks",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "default",
      },
      syncPolicy: {
        automated: {
          prune: true,
          selfHeal: true,
        },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  },
  { provider: k8sProvider, dependsOn: [argoCDProject] }
);

// Create Cognito User Pool for Kargo OIDC authentication
const kargoUserPool = new aws.cognito.UserPool("kargoUserPool", {
  name: "kargo-users",
  autoVerifiedAttributes: ["email"],
  usernameAttributes: ["email"],
  usernameConfiguration: {
    caseSensitive: false,
  },
  schemas: [
    {
      attributeDataType: "String",
      name: "email",
      required: true,
      mutable: true,
    },
  ],
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    requireUppercase: true,
  },
});

// Create User Pool Domain for hosted UI
const kargoUserPoolDomain = new aws.cognito.UserPoolDomain(
  "kargoUserPoolDomain",
  {
    domain: pulumi.interpolate`kargo-${pulumi.getStack()}`,
    userPoolId: kargoUserPool.id,
  }
);

// Get the Kargo hostname configuration (you'll need to provide this)
const kargoHostname = config.get("kargoHostname") || "kargo.example.com";

// Create Cognito App Client for Kargo
const kargoAppClient = new aws.cognito.UserPoolClient("kargoAppClient", {
  name: "kargo",
  userPoolId: kargoUserPool.id,
  generateSecret: false,
  explicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"],
  allowedOauthFlows: ["code"],
  allowedOauthScopes: ["email", "openid", "profile"],
  allowedOauthFlowsUserPoolClient: true,
  callbackUrls: [
    pulumi.interpolate`${kargoHostname}/login`,
    pulumi.interpolate`${kargoHostname}/auth/callback`,
    "https://localhost/auth/callback",
  ],
  logoutUrls: [pulumi.interpolate`${kargoHostname}`],
  supportedIdentityProviders: ["COGNITO"],
});

// Export the k8sProvider and kubeconfig for use by other stacks
export { k8sProvider };
export { kubeconfig };

// Export the service account details
export const serviceAccountName = serviceAccount.metadata.name;
export const serviceAccountNamespace = serviceAccount.metadata.namespace;
export const clusterRoleBindingName = clusterRoleBinding.metadata.name;
export const secretName = accessToken.metadata.name;

// Export installation status
export const pulumiOperatorStatus = pulumiOperator.status;
export const certManagerReady = certManager.ready;
export const argoCDReady = argoCD.ready;
export const argoRolloutsReady = argoRollouts.ready;
export const argoCDAppName = argoCDApp.metadata.name;

// Export Cognito configuration for Kargo
export const cognitoUserPoolId = kargoUserPool.id;
export const cognitoUserPoolArn = kargoUserPool.arn;
export const cognitoClientId = kargoAppClient.id;
export const cognitoIssuerUrl = pulumi.interpolate`https://cognito-idp.${awsConfig.require(
  "region"
)}.amazonaws.com/${kargoUserPool.id}`;
export const cognitoUserPoolDomain = kargoUserPoolDomain.domain;
