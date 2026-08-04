import { describe, expect, it } from "vitest";
import { type OciCommandName, ociCommands } from "./command-defs";

const INSTANCE_ID = "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0001";
const NODE_POOL_ID = "ocid1.nodepool.oc1.ap-tokyo-1.aaaaexample0001";
const CLUSTER_ID = "ocid1.cluster.oc1.ap-tokyo-1.aaaaexample0001";
const COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaexample0001";
const VCN_ID = "ocid1.vcn.oc1.ap-tokyo-1.aaaaexample0001";
const AVAILABILITY_DOMAIN = "Abcd:AP-TOKYO-1-AD-1";
const SUBNET_ID = "ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0001";
const SECURITY_LIST_ID = "ocid1.securitylist.oc1.ap-tokyo-1.aaaaexample0001";
const ROUTE_TABLE_ID = "ocid1.routetable.oc1.ap-tokyo-1.aaaaexample0001";
const NSG_ID = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.aaaaexample0001";
const WAF_POLICY_ID = "ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.aaaaexample0001";
const VOLUME_ID = "ocid1.volume.oc1.ap-tokyo-1.aaaaexample0001";
const BACKUP_POLICY_ID = "ocid1.volumebackuppolicy.oc1..aaaaexample0001";
const FSS_POLICY_ID = "ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.aaaaexample0001";
const FILE_SYSTEM_ID = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaexample0001";
const CERTIFICATE_ID = "ocid1.certificate.oc1.ap-tokyo-1.aaaaexample0001";
const NAT_GATEWAY_ID = "ocid1.natgateway.oc1.ap-tokyo-1.aaaaexample0001";
const INTERNET_GATEWAY_ID = "ocid1.internetgateway.oc1.ap-tokyo-1.aaaaexample0001";
const SERVICE_GATEWAY_ID = "ocid1.servicegateway.oc1.ap-tokyo-1.aaaaexample0001";
const LPG_ID = "ocid1.localpeeringgateway.oc1.ap-tokyo-1.aaaaexample0001";
const DRG_ID = "ocid1.drg.oc1.ap-tokyo-1.aaaaexample0001";
const LB_ID = "ocid1.loadbalancer.oc1.ap-tokyo-1.aaaaexample0001";
const NLB_ID = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaaexample0001";
const QUERY_TEXT = `query all resources where (definedTags.namespace = 'Oracle-Tags' && definedTags.key = 'CreatedBy' && definedTags.value = '${CLUSTER_ID}')`;

/** フィクスチャREADMEの対応表(全40コマンド)。`id`はfetch.ts / anchor.tsのコメント番号。 */
const CASES: { id: string; key: OciCommandName; actual: string[]; expected: string[] }[] = [
  {
    id: "1a",
    key: "instanceGet",
    actual: ociCommands.instanceGet.args({ instanceId: INSTANCE_ID }),
    expected: ["compute", "instance", "get", "--instance-id", INSTANCE_ID],
  },
  {
    id: "1b",
    key: "nodePoolGet",
    actual: ociCommands.nodePoolGet.args({ nodePoolId: NODE_POOL_ID }),
    expected: ["ce", "node-pool", "get", "--node-pool-id", NODE_POOL_ID],
  },
  {
    id: "2",
    key: "clusterGet",
    actual: ociCommands.clusterGet.args({ clusterId: CLUSTER_ID }),
    expected: ["ce", "cluster", "get", "--cluster-id", CLUSTER_ID],
  },
  {
    id: "3",
    key: "instanceList",
    actual: ociCommands.instanceList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["compute", "instance", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "4",
    key: "taggedResourceSearch",
    actual: ociCommands.taggedResourceSearch.args({ queryText: QUERY_TEXT }),
    expected: ["search", "resource", "structured-search", "--query-text", QUERY_TEXT],
  },
  {
    id: "5",
    key: "nlbList",
    actual: ociCommands.nlbList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["nlb", "network-load-balancer", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "6",
    key: "lbList",
    actual: ociCommands.lbList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["lb", "load-balancer", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "7",
    key: "volumeList",
    actual: ociCommands.volumeList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["bv", "volume", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "8",
    key: "fileSystemGet",
    actual: ociCommands.fileSystemGet.args({ fileSystemId: FILE_SYSTEM_ID }),
    expected: ["fs", "file-system", "get", "--file-system-id", FILE_SYSTEM_ID],
  },
  {
    id: "9",
    key: "nodePoolList",
    actual: ociCommands.nodePoolList.args({ compartmentId: COMPARTMENT_ID, clusterId: CLUSTER_ID }),
    expected: ["ce", "node-pool", "list", "--compartment-id", COMPARTMENT_ID, "--cluster-id", CLUSTER_ID, "--all"],
  },
  {
    id: "10",
    key: "wafList",
    actual: ociCommands.wafList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["waf", "web-app-firewall", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "11",
    key: "subnetGet",
    actual: ociCommands.subnetGet.args({ subnetId: SUBNET_ID }),
    expected: ["network", "subnet", "get", "--subnet-id", SUBNET_ID],
  },
  {
    id: "12",
    key: "securityListGet",
    actual: ociCommands.securityListGet.args({ securityListId: SECURITY_LIST_ID }),
    expected: ["network", "security-list", "get", "--security-list-id", SECURITY_LIST_ID],
  },
  {
    id: "13",
    key: "routeTableGet",
    actual: ociCommands.routeTableGet.args({ rtId: ROUTE_TABLE_ID }),
    expected: ["network", "route-table", "get", "--rt-id", ROUTE_TABLE_ID],
  },
  {
    id: "14a",
    key: "nsgGet",
    actual: ociCommands.nsgGet.args({ nsgId: NSG_ID }),
    expected: ["network", "nsg", "get", "--nsg-id", NSG_ID],
  },
  {
    id: "14b",
    key: "nsgRulesList",
    actual: ociCommands.nsgRulesList.args({ nsgId: NSG_ID }),
    expected: ["network", "nsg", "rules", "list", "--nsg-id", NSG_ID, "--all"],
  },
  {
    id: "15",
    key: "wafPolicyGet",
    actual: ociCommands.wafPolicyGet.args({ webAppFirewallPolicyId: WAF_POLICY_ID }),
    expected: ["waf", "web-app-firewall-policy", "get", "--web-app-firewall-policy-id", WAF_POLICY_ID],
  },
  {
    id: "16a",
    key: "volumeBackupPolicyAssignmentGet",
    actual: ociCommands.volumeBackupPolicyAssignmentGet.args({ assetId: VOLUME_ID }),
    expected: [
      "bv",
      "volume-backup-policy-assignment",
      "get-volume-backup-policy-asset-assignment",
      "--asset-id",
      VOLUME_ID,
    ],
  },
  {
    id: "16b",
    key: "volumeBackupPolicyGet",
    actual: ociCommands.volumeBackupPolicyGet.args({ policyId: BACKUP_POLICY_ID }),
    expected: ["bv", "volume-backup-policy", "get", "--policy-id", BACKUP_POLICY_ID],
  },
  {
    id: "17",
    key: "fssSnapshotPolicyGet",
    actual: ociCommands.fssSnapshotPolicyGet.args({ filesystemSnapshotPolicyId: FSS_POLICY_ID }),
    expected: ["fs", "filesystem-snapshot-policy", "get", "--filesystem-snapshot-policy-id", FSS_POLICY_ID],
  },
  {
    id: "18",
    key: "managedCertificateGet",
    actual: ociCommands.managedCertificateGet.args({ certificateId: CERTIFICATE_ID }),
    expected: ["certs-mgmt", "certificate", "get", "--certificate-id", CERTIFICATE_ID],
  },
  {
    id: "19a",
    key: "natGatewayGet",
    actual: ociCommands.natGatewayGet.args({ natGatewayId: NAT_GATEWAY_ID }),
    expected: ["network", "nat-gateway", "get", "--nat-gateway-id", NAT_GATEWAY_ID],
  },
  {
    id: "19b",
    key: "internetGatewayGet",
    actual: ociCommands.internetGatewayGet.args({ igId: INTERNET_GATEWAY_ID }),
    expected: ["network", "internet-gateway", "get", "--ig-id", INTERNET_GATEWAY_ID],
  },
  {
    id: "19c",
    key: "serviceGatewayGet",
    actual: ociCommands.serviceGatewayGet.args({ serviceGatewayId: SERVICE_GATEWAY_ID }),
    expected: ["network", "service-gateway", "get", "--service-gateway-id", SERVICE_GATEWAY_ID],
  },
  {
    id: "19d",
    key: "localPeeringGatewayGet",
    actual: ociCommands.localPeeringGatewayGet.args({ localPeeringGatewayId: LPG_ID }),
    expected: ["network", "local-peering-gateway", "get", "--local-peering-gateway-id", LPG_ID],
  },
  {
    id: "19e",
    key: "drgGet",
    actual: ociCommands.drgGet.args({ drgId: DRG_ID }),
    expected: ["network", "drg", "get", "--drg-id", DRG_ID],
  },
  {
    id: "20a",
    key: "lbBackendSetHealthGet",
    actual: ociCommands.lbBackendSetHealthGet.args({ loadBalancerId: LB_ID, backendSetName: "TCP-443" }),
    expected: ["lb", "backend-set-health", "get", "--load-balancer-id", LB_ID, "--backend-set-name", "TCP-443"],
  },
  {
    id: "20b",
    key: "nlbBackendSetHealthGet",
    actual: ociCommands.nlbBackendSetHealthGet.args({ networkLoadBalancerId: NLB_ID, backendSetName: "TCP-443" }),
    expected: [
      "nlb",
      "backend-set-health",
      "get",
      "--network-load-balancer-id",
      NLB_ID,
      "--backend-set-name",
      "TCP-443",
    ],
  },
  {
    id: "21",
    key: "subnetList",
    actual: ociCommands.subnetList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "subnet", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "22",
    key: "routeTableList",
    actual: ociCommands.routeTableList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "route-table", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "23",
    key: "securityListList",
    actual: ociCommands.securityListList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "security-list", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "24",
    key: "nsgList",
    actual: ociCommands.nsgList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "nsg", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "25a",
    key: "natGatewayList",
    actual: ociCommands.natGatewayList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "nat-gateway", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "25b",
    key: "internetGatewayList",
    actual: ociCommands.internetGatewayList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "internet-gateway", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "25c",
    key: "serviceGatewayList",
    actual: ociCommands.serviceGatewayList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: ["network", "service-gateway", "list", "--compartment-id", COMPARTMENT_ID, "--vcn-id", VCN_ID, "--all"],
  },
  {
    id: "25d",
    key: "localPeeringGatewayList",
    actual: ociCommands.localPeeringGatewayList.args({ compartmentId: COMPARTMENT_ID, vcnId: VCN_ID }),
    expected: [
      "network",
      "local-peering-gateway",
      "list",
      "--compartment-id",
      COMPARTMENT_ID,
      "--vcn-id",
      VCN_ID,
      "--all",
    ],
  },
  {
    id: "25e",
    key: "drgList",
    actual: ociCommands.drgList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["network", "drg", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "26",
    key: "availabilityDomainList",
    actual: ociCommands.availabilityDomainList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["iam", "availability-domain", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
  {
    id: "27",
    key: "fssSnapshotPolicyList",
    actual: ociCommands.fssSnapshotPolicyList.args({
      compartmentId: COMPARTMENT_ID,
      availabilityDomain: AVAILABILITY_DOMAIN,
    }),
    expected: [
      "fs",
      "filesystem-snapshot-policy",
      "list",
      "--compartment-id",
      COMPARTMENT_ID,
      "--availability-domain",
      AVAILABILITY_DOMAIN,
      "--all",
    ],
  },
  {
    id: "28",
    key: "volumeBackupPolicyList",
    actual: ociCommands.volumeBackupPolicyList.args({ compartmentId: COMPARTMENT_ID }),
    expected: ["bv", "volume-backup-policy", "list", "--compartment-id", COMPARTMENT_ID, "--all"],
  },
];

describe("ociCommands", () => {
  it.each(CASES)("#$id $key の引数列", ({ actual, expected }) => {
    expect(actual).toEqual(expected);
  });

  it("定義表はSDK呼び出し全40件を網羅し、余分な定義を持たない", () => {
    expect(CASES).toHaveLength(40);
    expect(new Set(CASES.map((testCase) => testCase.key))).toEqual(new Set(Object.keys(ociCommands)));
    expect(Object.keys(ociCommands)).toHaveLength(40);
  });

  it("手動ページングはsearchのみ(他はCLI側の--allで全件取得)", () => {
    const manual = Object.entries(ociCommands)
      .filter(([, def]) => def.manualPaging)
      .map(([key]) => key);
    expect(manual).toEqual(["taggedResourceSearch"]);
    expect(ociCommands.taggedResourceSearch.args({ queryText: QUERY_TEXT })).not.toContain("--all");
  });

  it("複数件を返すコマンドはcollection、単体getはsingle", () => {
    const collections = Object.entries(ociCommands)
      .filter(([, def]) => def.output === "collection")
      .map(([key]) => key);
    expect(new Set(collections)).toEqual(
      new Set([
        "instanceList",
        "taggedResourceSearch",
        "nlbList",
        "lbList",
        "volumeList",
        "nodePoolList",
        "wafList",
        "nsgRulesList",
        "volumeBackupPolicyAssignmentGet",
        "subnetList",
        "routeTableList",
        "securityListList",
        "nsgList",
        "natGatewayList",
        "internetGatewayList",
        "serviceGatewayList",
        "localPeeringGatewayList",
        "drgList",
        "availabilityDomainList",
        "fssSnapshotPolicyList",
        "volumeBackupPolicyList",
      ]),
    );
  });
});
