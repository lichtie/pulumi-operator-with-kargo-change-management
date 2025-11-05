import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// Get the kubeconfig from the cluster stack
const config = new pulumi.Config();
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
    version: "2.2.0",
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

// Install Kargo using Helm with admin credentials
const kargoNamespace = new k8s.core.v1.Namespace(
  "kargo-ns",
  {
    metadata: {
      name: "kargo",
    },
  },
  { provider: k8sProvider }
);

const kargo = new k8s.helm.v3.Release(
  "kargo",
  {
    chart: "oci://ghcr.io/akuity/kargo-charts/kargo",
    namespace: kargoNamespace.metadata.name,
    values: {
      api: {
        adminAccount: {
          passwordHash: config.requireSecret("kargoAdminPasswordHash"),
          tokenSigningKey: config.requireSecret("kargoTokenSigningKey"),
        },
        service: {
          type: "LoadBalancer",
        },
      },
    },
    waitForJobs: true,
  },
  { provider: k8sProvider, dependsOn: [kargoNamespace] }
);

// Create ArgoCD AppProject
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

// Export the service account details
export const serviceAccountName = serviceAccount.metadata.name;
export const serviceAccountNamespace = serviceAccount.metadata.namespace;
export const clusterRoleBindingName = clusterRoleBinding.metadata.name;
export const secretName = accessToken.metadata.name;

// Export installation status
export const pulumiOperatorStatus = pulumiOperator.status;
export const kargoStatus = kargo.status;
export const argoCDAppName = argoCDApp.metadata.name;

// Export Kargo API server address
export const kargoApiAddress = pulumi
  .all([kargoNamespace.metadata.name])
  .apply(([ns]) =>
    k8s.core.v1.Service.get(
      "kargo-api-svc",
      pulumi.interpolate`${ns}/kargo-api`,
      { provider: k8sProvider }
    ).status.apply((status) => {
      if (
        status?.loadBalancer?.ingress &&
        status.loadBalancer.ingress.length > 0
      ) {
        const ingress = status.loadBalancer.ingress[0];
        const address = ingress.hostname || ingress.ip;
        return `https://${address}`;
      }
      return "LoadBalancer address pending...";
    })
  );
