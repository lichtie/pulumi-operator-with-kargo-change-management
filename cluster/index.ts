import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Create an IAM role for the EKS cluster
const role = new aws.iam.Role("eksClusterRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "eks.amazonaws.com",
  }),
});

new aws.iam.RolePolicyAttachment("eksClusterRolePolicyAttachment", {
  role: role.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
});

// Create an IAM role for EKS worker nodes
const workerRole = new aws.iam.Role("eksWorkerRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ec2.amazonaws.com",
  }),
});

const workerNodePolicy = new aws.iam.RolePolicyAttachment(
  "eksWorkerRolePolicyAttachment",
  {
    role: workerRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
  }
);

const workerCniPolicy = new aws.iam.RolePolicyAttachment(
  "eksWorkerRoleCniPolicyAttachment",
  {
    role: workerRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
  }
);

const workerRegistryPolicy = new aws.iam.RolePolicyAttachment(
  "eksWorkerRoleRegistryPolicyAttachment",
  {
    role: workerRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  }
);

// Create a VPC for the EKS cluster
const vpc = new aws.ec2.Vpc("eksVpc", {
  cidrBlock: "10.0.0.0/16",
  enableDnsSupport: true,
  enableDnsHostnames: true,
  tags: {
    Name: "eks-vpc",
  },
});

// Create an Internet Gateway for public internet access
const internetGateway = new aws.ec2.InternetGateway("eksInternetGateway", {
  vpcId: vpc.id,
  tags: {
    Name: "eks-igw",
  },
});

// Create a route table
const routeTable = new aws.ec2.RouteTable("eksRouteTable", {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: internetGateway.id,
    },
  ],
  tags: {
    Name: "eks-route-table",
  },
});

const subnet = new aws.ec2.Subnet("eksSubnet", {
  vpcId: vpc.id,
  cidrBlock: "10.0.1.0/24",
  availabilityZone: "us-east-1a",
  mapPublicIpOnLaunch: true,
  tags: {
    Name: "eks-subnet-1",
    "kubernetes.io/role/elb": "1",
  },
});

const subnet2 = new aws.ec2.Subnet("eksSubnet2", {
  vpcId: vpc.id,
  cidrBlock: "10.0.2.0/24",
  availabilityZone: "us-east-1b",
  mapPublicIpOnLaunch: true,
  tags: {
    Name: "eks-subnet-2",
    "kubernetes.io/role/elb": "1",
  },
});

// Associate route table with subnets
new aws.ec2.RouteTableAssociation("eksRouteTableAssociation1", {
  subnetId: subnet.id,
  routeTableId: routeTable.id,
});

new aws.ec2.RouteTableAssociation("eksRouteTableAssociation2", {
  subnetId: subnet2.id,
  routeTableId: routeTable.id,
});

const eksSecurityGroup = new aws.ec2.SecurityGroup("eksSecurityGroup", {
  vpcId: vpc.id,
  description: "EKS cluster security group",
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags: {
    Name: "eks-cluster-sg",
  },
});

// Node security group
const nodeSecurityGroup = new aws.ec2.SecurityGroup("eksNodeSecurityGroup", {
  vpcId: vpc.id,
  description: "Security group for EKS worker nodes",
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags: {
    Name: "eks-node-sg",
  },
});

// Allow nodes to communicate with cluster API
new aws.ec2.SecurityGroupRule("nodeToClusterIngress", {
  type: "ingress",
  fromPort: 443,
  toPort: 443,
  protocol: "tcp",
  securityGroupId: eksSecurityGroup.id,
  sourceSecurityGroupId: nodeSecurityGroup.id,
  description: "Allow nodes to communicate with cluster API",
});

// Allow cluster to communicate with nodes
new aws.ec2.SecurityGroupRule("clusterToNodeIngress", {
  type: "ingress",
  fromPort: 1025,
  toPort: 65535,
  protocol: "tcp",
  securityGroupId: nodeSecurityGroup.id,
  sourceSecurityGroupId: eksSecurityGroup.id,
  description: "Allow cluster to communicate with nodes",
});

// Allow nodes to communicate with each other
new aws.ec2.SecurityGroupRule("nodeToNodeIngress", {
  type: "ingress",
  fromPort: 0,
  toPort: 65535,
  protocol: "-1",
  securityGroupId: nodeSecurityGroup.id,
  sourceSecurityGroupId: nodeSecurityGroup.id,
  description: "Allow nodes to communicate with each other",
});

// Create the EKS cluster
const cluster = new aws.eks.Cluster("eksCluster", {
  roleArn: role.arn,
  vpcConfig: {
    subnetIds: [subnet.id, subnet2.id],
    securityGroupIds: [eksSecurityGroup.id],
  },
});

// Create an EKS Node Group
const nodeGroup = new aws.eks.NodeGroup(
  "eksNodeGroup",
  {
    clusterName: cluster.name,
    nodeRoleArn: workerRole.arn,
    subnetIds: [subnet.id, subnet2.id],
    scalingConfig: {
      desiredSize: 2,
      maxSize: 3,
      minSize: 1,
    },
    instanceTypes: ["t3.medium"],
  },
  {
    dependsOn: [workerNodePolicy, workerCniPolicy, workerRegistryPolicy],
  }
);

export const kubeconfig = pulumi
  .all([cluster.endpoint, cluster.certificateAuthority, cluster.name])
  .apply(([endpoint, certAuth, name]) => {
    return JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        {
          cluster: {
            server: endpoint,
            "certificate-authority-data": certAuth.data,
          },
          name: "kubernetes",
        },
      ],
      contexts: [
        {
          context: {
            cluster: "kubernetes",
            user: "aws",
          },
          name: "aws",
        },
      ],
      "current-context": "aws",
      users: [
        {
          name: "aws",
          user: {
            exec: {
              apiVersion: "client.authentication.k8s.io/v1beta1",
              command: "aws",
              args: ["eks", "get-token", "--cluster-name", name],
            },
          },
        },
      ],
    });
  });

export const clusterName = cluster.name;
export const clusterEndpoint = cluster.endpoint;
export const nodeGroupStatus = nodeGroup.status;
