import type {
  OciAvailabilityDomain,
  OciBackendSetHealth,
  OciBlockingGateway,
  OciCluster,
  OciDrg,
  OciFileSystem,
  OciFilesystemSnapshotPolicy,
  OciInstance,
  OciInternetGateway,
  OciLoadBalancer,
  OciLocalPeeringGateway,
  OciManagedCertificate,
  OciNetworkLoadBalancerSummary,
  OciNodePool,
  OciNodePoolSummary,
  OciNsg,
  OciNsgRule,
  OciResourceSummary,
  OciRouteTable,
  OciSecurityList,
  OciSubnet,
  OciVolume,
  OciVolumeBackupPolicy,
  OciVolumeBackupPolicyAssignment,
  OciWafPolicy,
  OciWafSummary,
} from "../oci/types";

/** stdoutの`data`の形。collectionは配列直返しとコレクション包み(`{"items": […]}`)の両方を受ける。 */
export type OciCommandOutput = "single" | "collection";

export interface OciCommandDef<Params, Result> {
  /** サブコマンド列+オプション(共通の`--output json`は実行機が付ける) */
  readonly args: (params: Params) => string[];
  readonly output: OciCommandOutput;
  /** `--all`を持たないコマンドのみ: `opc-next-page`を辿って全ページ結合する */
  readonly manualPaging?: true;
  /** JSONは無型のため、対応する応答型の宣言をここに集約する */
  readonly decode: (parsed: unknown) => Result;
}

function define<Params, Result>(def: OciCommandDef<Params, Result>): OciCommandDef<Params, Result> {
  return def;
}

function getOne<Params, Result>(
  subcommand: readonly string[],
  options: (params: Params) => string[],
): OciCommandDef<Params, Result> {
  return {
    args: (params) => [...subcommand, ...options(params)],
    output: "single",
    decode: (parsed) => parsed as Result,
  };
}

function listAll<Params, Result>(
  subcommand: readonly string[],
  options: (params: Params) => string[],
): OciCommandDef<Params, Result[]> {
  return {
    args: (params) => [...subcommand, ...options(params), "--all"],
    output: "collection",
    decode: (parsed) => parsed as Result[],
  };
}

export interface VcnScope {
  compartmentId: string;
  vcnId: string;
}

/** VCN配下のリソースを型ごとに一括取得するnetwork系list(応答はgetと同一モデル)。 */
function listInVcn<Result>(subcommand: readonly string[]): OciCommandDef<VcnScope, Result[]> {
  return listAll<VcnScope, Result>(subcommand, ({ compartmentId, vcnId }) => [
    "--compartment-id",
    compartmentId,
    "--vcn-id",
    vcnId,
  ]);
}

/** 拡張が要求するoci互換コマンドの全件。取得経路とREADMEの互換コマンド契約はこの表を単一ソースとする。 */
export const ociCommands = {
  instanceGet: getOne<{ instanceId: string }, OciInstance>(["compute", "instance", "get"], ({ instanceId }) => [
    "--instance-id",
    instanceId,
  ]),

  nodePoolGet: getOne<{ nodePoolId: string }, OciNodePool>(["ce", "node-pool", "get"], ({ nodePoolId }) => [
    "--node-pool-id",
    nodePoolId,
  ]),

  clusterGet: getOne<{ clusterId: string }, OciCluster>(["ce", "cluster", "get"], ({ clusterId }) => [
    "--cluster-id",
    clusterId,
  ]),

  instanceList: listAll<{ compartmentId: string }, OciInstance>(
    ["compute", "instance", "list"],
    ({ compartmentId }) => ["--compartment-id", compartmentId],
  ),

  // `--all`が無いコマンドのため手動ページング(`--page`)が必要。
  taggedResourceSearch: define<{ queryText: string }, OciResourceSummary[]>({
    args: ({ queryText }) => ["search", "resource", "structured-search", "--query-text", queryText],
    output: "collection",
    manualPaging: true,
    decode: (parsed) => parsed as OciResourceSummary[],
  }),

  nlbList: listAll<{ compartmentId: string }, OciNetworkLoadBalancerSummary>(
    ["nlb", "network-load-balancer", "list"],
    ({ compartmentId }) => ["--compartment-id", compartmentId],
  ),

  lbList: listAll<{ compartmentId: string }, OciLoadBalancer>(["lb", "load-balancer", "list"], ({ compartmentId }) => [
    "--compartment-id",
    compartmentId,
  ]),

  volumeList: listAll<{ compartmentId: string }, OciVolume>(["bv", "volume", "list"], ({ compartmentId }) => [
    "--compartment-id",
    compartmentId,
  ]),

  fileSystemGet: getOne<{ fileSystemId: string }, OciFileSystem>(["fs", "file-system", "get"], ({ fileSystemId }) => [
    "--file-system-id",
    fileSystemId,
  ]),

  nodePoolList: listAll<{ compartmentId: string; clusterId: string }, OciNodePoolSummary>(
    ["ce", "node-pool", "list"],
    ({ compartmentId, clusterId }) => ["--compartment-id", compartmentId, "--cluster-id", clusterId],
  ),

  wafList: listAll<{ compartmentId: string }, OciWafSummary>(
    ["waf", "web-app-firewall", "list"],
    ({ compartmentId }) => ["--compartment-id", compartmentId],
  ),

  subnetGet: getOne<{ subnetId: string }, OciSubnet>(["network", "subnet", "get"], ({ subnetId }) => [
    "--subnet-id",
    subnetId,
  ]),

  securityListGet: getOne<{ securityListId: string }, OciSecurityList>(
    ["network", "security-list", "get"],
    ({ securityListId }) => ["--security-list-id", securityListId],
  ),

  routeTableGet: getOne<{ rtId: string }, OciRouteTable>(["network", "route-table", "get"], ({ rtId }) => [
    "--rt-id",
    rtId,
  ]),

  nsgGet: getOne<{ nsgId: string }, OciNsg>(["network", "nsg", "get"], ({ nsgId }) => ["--nsg-id", nsgId]),

  nsgRulesList: listAll<{ nsgId: string }, OciNsgRule>(["network", "nsg", "rules", "list"], ({ nsgId }) => [
    "--nsg-id",
    nsgId,
  ]),

  subnetList: listInVcn<OciSubnet>(["network", "subnet", "list"]),

  routeTableList: listInVcn<OciRouteTable>(["network", "route-table", "list"]),

  securityListList: listInVcn<OciSecurityList>(["network", "security-list", "list"]),

  nsgList: listInVcn<OciNsg>(["network", "nsg", "list"]),

  wafPolicyGet: getOne<{ webAppFirewallPolicyId: string }, OciWafPolicy>(
    ["waf", "web-app-firewall-policy", "get"],
    ({ webAppFirewallPolicyId }) => ["--web-app-firewall-policy-id", webAppFirewallPolicyId],
  ),

  // 割当が無いボリュームではstdoutが空(exit 0)になる。
  volumeBackupPolicyAssignmentGet: define<{ assetId: string }, OciVolumeBackupPolicyAssignment[]>({
    args: ({ assetId }) => [
      "bv",
      "volume-backup-policy-assignment",
      "get-volume-backup-policy-asset-assignment",
      "--asset-id",
      assetId,
    ],
    output: "collection",
    decode: (parsed) => parsed as OciVolumeBackupPolicyAssignment[],
  }),

  volumeBackupPolicyGet: getOne<{ policyId: string }, OciVolumeBackupPolicy>(
    ["bv", "volume-backup-policy", "get"],
    ({ policyId }) => ["--policy-id", policyId],
  ),

  // compartmentを省略するとOracle定義ポリシー(bronze/silver/gold)が返る。利用者定義分は指定側で返る。
  volumeBackupPolicyList: listAll<{ compartmentId?: string }, OciVolumeBackupPolicy>(
    ["bv", "volume-backup-policy", "list"],
    ({ compartmentId }) => (compartmentId ? ["--compartment-id", compartmentId] : []),
  ),

  fssSnapshotPolicyGet: getOne<{ filesystemSnapshotPolicyId: string }, OciFilesystemSnapshotPolicy>(
    ["fs", "filesystem-snapshot-policy", "get"],
    ({ filesystemSnapshotPolicyId }) => ["--filesystem-snapshot-policy-id", filesystemSnapshotPolicyId],
  ),

  fssSnapshotPolicyList: listAll<{ compartmentId: string; availabilityDomain: string }, OciFilesystemSnapshotPolicy>(
    ["fs", "filesystem-snapshot-policy", "list"],
    ({ compartmentId, availabilityDomain }) => [
      "--compartment-id",
      compartmentId,
      "--availability-domain",
      availabilityDomain,
    ],
  ),

  availabilityDomainList: listAll<{ compartmentId: string }, OciAvailabilityDomain>(
    ["iam", "availability-domain", "list"],
    ({ compartmentId }) => ["--compartment-id", compartmentId],
  ),

  managedCertificateGet: getOne<{ certificateId: string }, OciManagedCertificate>(
    ["certs-mgmt", "certificate", "get"],
    ({ certificateId }) => ["--certificate-id", certificateId],
  ),

  natGatewayGet: getOne<{ natGatewayId: string }, OciBlockingGateway>(
    ["network", "nat-gateway", "get"],
    ({ natGatewayId }) => ["--nat-gateway-id", natGatewayId],
  ),

  internetGatewayGet: getOne<{ igId: string }, OciInternetGateway>(
    ["network", "internet-gateway", "get"],
    ({ igId }) => ["--ig-id", igId],
  ),

  serviceGatewayGet: getOne<{ serviceGatewayId: string }, OciBlockingGateway>(
    ["network", "service-gateway", "get"],
    ({ serviceGatewayId }) => ["--service-gateway-id", serviceGatewayId],
  ),

  localPeeringGatewayGet: getOne<{ localPeeringGatewayId: string }, OciLocalPeeringGateway>(
    ["network", "local-peering-gateway", "get"],
    ({ localPeeringGatewayId }) => ["--local-peering-gateway-id", localPeeringGatewayId],
  ),

  drgGet: getOne<{ drgId: string }, OciDrg>(["network", "drg", "get"], ({ drgId }) => ["--drg-id", drgId]),

  natGatewayList: listInVcn<OciBlockingGateway>(["network", "nat-gateway", "list"]),

  internetGatewayList: listInVcn<OciInternetGateway>(["network", "internet-gateway", "list"]),

  serviceGatewayList: listInVcn<OciBlockingGateway>(["network", "service-gateway", "list"]),

  localPeeringGatewayList: listInVcn<OciLocalPeeringGateway>(["network", "local-peering-gateway", "list"]),

  // DRGはVCNではなくcompartmentに属する(`--vcn-id`が無い)。
  drgList: listAll<{ compartmentId: string }, OciDrg>(["network", "drg", "list"], ({ compartmentId }) => [
    "--compartment-id",
    compartmentId,
  ]),

  lbBackendSetHealthGet: getOne<{ loadBalancerId: string; backendSetName: string }, OciBackendSetHealth>(
    ["lb", "backend-set-health", "get"],
    ({ loadBalancerId, backendSetName }) => [
      "--load-balancer-id",
      loadBalancerId,
      "--backend-set-name",
      backendSetName,
    ],
  ),

  nlbBackendSetHealthGet: getOne<{ networkLoadBalancerId: string; backendSetName: string }, OciBackendSetHealth>(
    ["nlb", "backend-set-health", "get"],
    ({ networkLoadBalancerId, backendSetName }) => [
      "--network-load-balancer-id",
      networkLoadBalancerId,
      "--backend-set-name",
      backendSetName,
    ],
  ),
};

export type OciCommandName = keyof typeof ociCommands;
