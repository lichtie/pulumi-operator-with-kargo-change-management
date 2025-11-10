import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

// ============================================================================
// STEP 3: KARGO SETUP
// ============================================================================
// Install Kargo and configure ArgoCD integration for GitOps workflows

// Get configuration and reference the prerequisites stack
const config = new pulumi.Config();
const prereqsStackRef = new pulumi.StackReference(
  config.require("prereqsStack")
);
const kubeconfig = prereqsStackRef.requireOutput("kubeconfig");

// Create a Kubernetes provider using the kubeconfig from the prerequisites stack
const k8sProvider = new k8s.Provider("k8s-provider", {
  kubeconfig: kubeconfig,
});

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
        rollouts: { integrationEnabled: true },
        adminAccount: {
          passwordHash: config.requireSecret("kargoAdminPasswordHash"),
          tokenSigningKey: config.requireSecret("kargoTokenSigningKey"),
        },
        service: {
          type: "LoadBalancer",
        },
      },
      controller: { rollouts: { integrationEnabled: true } },
    },
    waitForJobs: true,
  },
  { provider: k8sProvider, dependsOn: [kargoNamespace] }
);

// Export Kargo installation status
export const kargoStatus = kargo.status;

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
