import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { ociCommands } from "../cli/command-defs";
import { runOciCommand } from "../cli/run";
import type { OciResult } from "../oci/result";
import { resolveAnchor } from "./anchor";
import {
  fetchAvailabilityDomains,
  fetchBackendSetHealth,
  fetchCluster,
  fetchDnsZones,
  fetchFileSystem,
  fetchFssExport,
  fetchFssSnapshotPolicies,
  fetchFssSnapshotPolicyName,
  fetchGatewayStatus,
  fetchInstances,
  fetchLbs,
  fetchManagedCertificate,
  fetchNlbs,
  fetchNodePools,
  fetchNsgWithRules,
  fetchRouteTable,
  fetchSecurityList,
  fetchSubnet,
  fetchTaggedResources,
  fetchVcn,
  fetchVcnGateways,
  fetchVcnNsgs,
  fetchVcnRouteTables,
  fetchVcnSecurityLists,
  fetchVcnSubnets,
  fetchVolumeBackupPolicies,
  fetchVolumeBackupPolicyName,
  fetchVolumes,
  fetchWafPolicy,
  fetchWafs,
} from "./fetch";

vi.mock("../cli/run", () => ({ runOciCommand: vi.fn() }));

const INSTANCE_ID = "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0001";
const NODE_POOL_ID = "ocid1.nodepool.oc1.ap-tokyo-1.aaaaexample0001";
const CLUSTER_ID = "ocid1.cluster.oc1.ap-tokyo-1.aaaaexample0001";
const COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaexample0001";
const OTHER_COMPARTMENT_ID = "ocid1.compartment.oc1..aaaaexample0002";
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
const FSS_EXPORT_ID = "ocid1.export.oc1.ap_tokyo_1.aaaaexample0001";
const CERTIFICATE_ID = "ocid1.certificate.oc1.ap-tokyo-1.aaaaexample0001";
const NAT_GATEWAY_ID = "ocid1.natgateway.oc1.ap-tokyo-1.aaaaexample0001";
const INTERNET_GATEWAY_ID = "ocid1.internetgateway.oc1.ap-tokyo-1.aaaaexample0001";
const SERVICE_GATEWAY_ID = "ocid1.servicegateway.oc1.ap-tokyo-1.aaaaexample0001";
const LPG_ID = "ocid1.localpeeringgateway.oc1.ap-tokyo-1.aaaaexample0001";
const DRG_ID = "ocid1.drg.oc1.ap-tokyo-1.aaaaexample0001";
const LB_ID = "ocid1.loadbalancer.oc1.ap-tokyo-1.aaaaexample0001";
const NLB_ID = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaaexample0001";
const QUERY_TEXT = `query all resources where (definedTags.namespace = 'Oracle-Tags' && definedTags.key = 'CreatedBy' && definedTags.value = '${CLUSTER_ID}')`;
const OCI_COMMAND = "wsl oci";
const FORBIDDEN_OR_NOT_FOUND: OciResult<never> = {
  ok: false,
  kind: "forbidden_or_not_found",
  raw: { message: "Authorization failed or requested resource not found.", statusCode: 404 },
};

type CommandDef = (typeof ociCommands)[keyof typeof ociCommands];

interface Call {
  command: string;
  params: unknown;
}

const runMock = runOciCommand as unknown as Mock;

let calls: Call[] = [];
let replies: Map<CommandDef, OciResult<unknown>>;
let settingsSeen: unknown[] = [];

function commandName(def: CommandDef): string {
  return Object.entries(ociCommands).find(([, value]) => value === def)?.[0] ?? "(unknown)";
}

beforeEach(() => {
  calls = [];
  settingsSeen = [];
  replies = new Map();
  runMock.mockReset();
  runMock.mockImplementation((def: CommandDef, params: unknown, settings: unknown) => {
    calls.push({ command: commandName(def), params });
    settingsSeen.push(settings);
    const reply = replies.get(def) ?? { ok: true, data: def.output === "collection" ? [] : {} };
    return Promise.resolve(reply);
  });
});

/** 取得経路(fetch.ts / anchor.ts)がどのコマンド定義をどの引数で呼ぶか。 */
const MAPPINGS: { name: string; call: () => Promise<unknown>; expected: Call[] }[] = [
  {
    name: "resolveAnchor",
    call: () => {
      replies.set(ociCommands.instanceGet, {
        ok: true,
        data: { "defined-tags": { "Oracle-Tags": { CreatedBy: NODE_POOL_ID } } },
      });
      replies.set(ociCommands.nodePoolGet, {
        ok: true,
        data: { "cluster-id": CLUSTER_ID, "compartment-id": COMPARTMENT_ID },
      });
      return resolveAnchor(INSTANCE_ID, OCI_COMMAND);
    },
    expected: [
      { command: "instanceGet", params: { instanceId: INSTANCE_ID } },
      { command: "nodePoolGet", params: { nodePoolId: NODE_POOL_ID } },
    ],
  },
  {
    name: "fetchCluster",
    call: () => fetchCluster(CLUSTER_ID, OCI_COMMAND),
    expected: [{ command: "clusterGet", params: { clusterId: CLUSTER_ID } }],
  },
  {
    name: "fetchInstances",
    call: () => fetchInstances(COMPARTMENT_ID, OCI_COMMAND),
    expected: [{ command: "instanceList", params: { compartmentId: COMPARTMENT_ID } }],
  },
  {
    name: "fetchTaggedResources",
    call: () => fetchTaggedResources(CLUSTER_ID, OCI_COMMAND),
    expected: [{ command: "taggedResourceSearch", params: { queryText: QUERY_TEXT } }],
  },
  {
    name: "fetchNlbs",
    call: () => fetchNlbs([COMPARTMENT_ID, OTHER_COMPARTMENT_ID], OCI_COMMAND),
    expected: [
      { command: "nlbList", params: { compartmentId: COMPARTMENT_ID } },
      { command: "nlbList", params: { compartmentId: OTHER_COMPARTMENT_ID } },
    ],
  },
  {
    name: "fetchLbs",
    call: () => fetchLbs([COMPARTMENT_ID], OCI_COMMAND),
    expected: [{ command: "lbList", params: { compartmentId: COMPARTMENT_ID } }],
  },
  {
    name: "fetchVolumes",
    call: () => fetchVolumes([COMPARTMENT_ID], OCI_COMMAND),
    expected: [{ command: "volumeList", params: { compartmentId: COMPARTMENT_ID } }],
  },
  {
    name: "fetchFileSystem",
    call: () => fetchFileSystem(FILE_SYSTEM_ID, OCI_COMMAND),
    expected: [{ command: "fileSystemGet", params: { fileSystemId: FILE_SYSTEM_ID } }],
  },
  {
    name: "fetchFssExport",
    call: () => fetchFssExport(FSS_EXPORT_ID, OCI_COMMAND),
    expected: [{ command: "fssExportGet", params: { exportId: FSS_EXPORT_ID } }],
  },
  {
    name: "fetchNodePools",
    call: () => fetchNodePools(CLUSTER_ID, COMPARTMENT_ID, OCI_COMMAND),
    expected: [{ command: "nodePoolList", params: { compartmentId: COMPARTMENT_ID, clusterId: CLUSTER_ID } }],
  },
  {
    name: "fetchWafs",
    call: () => fetchWafs([COMPARTMENT_ID], OCI_COMMAND),
    expected: [{ command: "wafList", params: { compartmentId: COMPARTMENT_ID } }],
  },
  {
    name: "fetchDnsZones",
    call: () => fetchDnsZones([COMPARTMENT_ID], OCI_COMMAND),
    expected: [{ command: "dnsZoneList", params: { compartmentId: COMPARTMENT_ID } }],
  },
  {
    name: "fetchVcn",
    call: () => fetchVcn(VCN_ID, OCI_COMMAND),
    expected: [{ command: "vcnGet", params: { vcnId: VCN_ID } }],
  },
  {
    name: "fetchSubnet",
    call: () => fetchSubnet(SUBNET_ID, OCI_COMMAND),
    expected: [{ command: "subnetGet", params: { subnetId: SUBNET_ID } }],
  },
  {
    name: "fetchSecurityList",
    call: () => fetchSecurityList(SECURITY_LIST_ID, OCI_COMMAND),
    expected: [{ command: "securityListGet", params: { securityListId: SECURITY_LIST_ID } }],
  },
  {
    name: "fetchRouteTable",
    call: () => fetchRouteTable(ROUTE_TABLE_ID, OCI_COMMAND),
    expected: [{ command: "routeTableGet", params: { rtId: ROUTE_TABLE_ID } }],
  },
  {
    name: "fetchNsgWithRules",
    call: () => fetchNsgWithRules(NSG_ID, OCI_COMMAND),
    expected: [
      { command: "nsgGet", params: { nsgId: NSG_ID } },
      { command: "nsgRulesList", params: { nsgId: NSG_ID } },
    ],
  },
  {
    name: "fetchWafPolicy",
    call: () => fetchWafPolicy(WAF_POLICY_ID, OCI_COMMAND),
    expected: [{ command: "wafPolicyGet", params: { webAppFirewallPolicyId: WAF_POLICY_ID } }],
  },
  {
    name: "fetchVolumeBackupPolicyName",
    call: () => {
      replies.set(ociCommands.volumeBackupPolicyAssignmentGet, { ok: true, data: [{ "policy-id": BACKUP_POLICY_ID }] });
      return fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND);
    },
    expected: [
      { command: "volumeBackupPolicyAssignmentGet", params: { assetId: VOLUME_ID } },
      { command: "volumeBackupPolicyGet", params: { policyId: BACKUP_POLICY_ID } },
    ],
  },
  {
    name: "fetchVolumeBackupPolicyName(割当照会が権限・不在)",
    call: () => {
      replies.set(ociCommands.volumeBackupPolicyAssignmentGet, FORBIDDEN_OR_NOT_FOUND);
      return fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND);
    },
    expected: [
      { command: "volumeBackupPolicyAssignmentGet", params: { assetId: VOLUME_ID } },
      { command: "volumeGet", params: { volumeId: VOLUME_ID } },
    ],
  },
  {
    name: "fetchFssSnapshotPolicyName",
    call: () => fetchFssSnapshotPolicyName(FSS_POLICY_ID, OCI_COMMAND),
    expected: [{ command: "fssSnapshotPolicyGet", params: { filesystemSnapshotPolicyId: FSS_POLICY_ID } }],
  },
  {
    name: "fetchManagedCertificate",
    call: () => fetchManagedCertificate(CERTIFICATE_ID, OCI_COMMAND),
    expected: [{ command: "managedCertificateGet", params: { certificateId: CERTIFICATE_ID } }],
  },
  {
    name: "fetchGatewayStatus(nat)",
    call: () => fetchGatewayStatus(NAT_GATEWAY_ID, OCI_COMMAND),
    expected: [{ command: "natGatewayGet", params: { natGatewayId: NAT_GATEWAY_ID } }],
  },
  {
    name: "fetchGatewayStatus(internet)",
    call: () => fetchGatewayStatus(INTERNET_GATEWAY_ID, OCI_COMMAND),
    expected: [{ command: "internetGatewayGet", params: { igId: INTERNET_GATEWAY_ID } }],
  },
  {
    name: "fetchGatewayStatus(service)",
    call: () => fetchGatewayStatus(SERVICE_GATEWAY_ID, OCI_COMMAND),
    expected: [{ command: "serviceGatewayGet", params: { serviceGatewayId: SERVICE_GATEWAY_ID } }],
  },
  {
    name: "fetchGatewayStatus(lpg)",
    call: () => fetchGatewayStatus(LPG_ID, OCI_COMMAND),
    expected: [{ command: "localPeeringGatewayGet", params: { localPeeringGatewayId: LPG_ID } }],
  },
  {
    name: "fetchGatewayStatus(drg)",
    call: () => fetchGatewayStatus(DRG_ID, OCI_COMMAND),
    expected: [{ command: "drgGet", params: { drgId: DRG_ID } }],
  },
  {
    name: "fetchVcnSubnets",
    call: () => fetchVcnSubnets([COMPARTMENT_ID, OTHER_COMPARTMENT_ID], VCN_ID, OCI_COMMAND),
    expected: [
      { command: "subnetList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } },
      { command: "subnetList", params: { compartmentId: OTHER_COMPARTMENT_ID, vcnId: VCN_ID } },
    ],
  },
  {
    name: "fetchVcnRouteTables",
    call: () => fetchVcnRouteTables([COMPARTMENT_ID], VCN_ID, OCI_COMMAND),
    expected: [{ command: "routeTableList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } }],
  },
  {
    name: "fetchVcnSecurityLists",
    call: () => fetchVcnSecurityLists([COMPARTMENT_ID], VCN_ID, OCI_COMMAND),
    expected: [{ command: "securityListList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } }],
  },
  {
    name: "fetchVcnNsgs",
    call: () => fetchVcnNsgs([COMPARTMENT_ID], VCN_ID, OCI_COMMAND),
    expected: [{ command: "nsgList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } }],
  },
  {
    name: "fetchVcnGateways",
    call: () => fetchVcnGateways([COMPARTMENT_ID], VCN_ID, OCI_COMMAND),
    expected: [
      { command: "natGatewayList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } },
      { command: "internetGatewayList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } },
      { command: "serviceGatewayList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } },
      { command: "localPeeringGatewayList", params: { compartmentId: COMPARTMENT_ID, vcnId: VCN_ID } },
      { command: "drgList", params: { compartmentId: COMPARTMENT_ID } },
    ],
  },
  {
    name: "fetchAvailabilityDomains",
    call: () => fetchAvailabilityDomains(COMPARTMENT_ID, OCI_COMMAND),
    expected: [{ command: "availabilityDomainList", params: { compartmentId: COMPARTMENT_ID } }],
  },
  {
    name: "fetchFssSnapshotPolicies",
    call: () => fetchFssSnapshotPolicies([COMPARTMENT_ID], [AVAILABILITY_DOMAIN], OCI_COMMAND),
    expected: [
      {
        command: "fssSnapshotPolicyList",
        params: { compartmentId: COMPARTMENT_ID, availabilityDomain: AVAILABILITY_DOMAIN },
      },
    ],
  },
  {
    name: "fetchVolumeBackupPolicies",
    call: () => fetchVolumeBackupPolicies([COMPARTMENT_ID], OCI_COMMAND),
    expected: [
      { command: "volumeBackupPolicyList", params: { compartmentId: COMPARTMENT_ID } },
      // compartment無指定の1本がOracle定義ポリシーを拾う。
      { command: "volumeBackupPolicyList", params: {} },
    ],
  },
  {
    name: "fetchBackendSetHealth(lb)",
    call: () => fetchBackendSetHealth("lb", LB_ID, "TCP-443", OCI_COMMAND),
    expected: [{ command: "lbBackendSetHealthGet", params: { loadBalancerId: LB_ID, backendSetName: "TCP-443" } }],
  },
  {
    name: "fetchBackendSetHealth(nlb)",
    call: () => fetchBackendSetHealth("nlb", NLB_ID, "TCP-443", OCI_COMMAND),
    expected: [
      { command: "nlbBackendSetHealthGet", params: { networkLoadBalancerId: NLB_ID, backendSetName: "TCP-443" } },
    ],
  },
];

describe("取得経路のコマンド割り当て", () => {
  it.each(MAPPINGS)("$name", async ({ call, expected }) => {
    await call();
    expect(calls).toEqual(expected);
  });

  it("設定値はそのまま実行機へ渡る", async () => {
    await fetchSubnet(SUBNET_ID, OCI_COMMAND);
    expect(settingsSeen).toEqual([OCI_COMMAND]);
  });

  it("定義表の全44コマンドが取得経路から呼ばれる", async () => {
    const used = new Set<string>();
    for (const mapping of MAPPINGS) {
      calls = [];
      replies = new Map();
      await mapping.call();
      for (const call of calls) used.add(call.command);
    }
    expect(used).toEqual(new Set(Object.keys(ociCommands)));
    expect(used.size).toBe(44);
  });
});

describe("エラーの扱い", () => {
  it("認証エラーはそのまま返り、再試行しない", async () => {
    const failure: OciResult<unknown> = { ok: false, kind: "not_authenticated", raw: { message: "nope" } };
    replies.set(ociCommands.clusterGet, failure);
    expect(await fetchCluster(CLUSTER_ID, OCI_COMMAND)).toEqual(failure);
    expect(calls).toHaveLength(1);
  });

  it("compartmentが1つ失敗すればセクション全体が失敗する", async () => {
    replies.set(ociCommands.lbList, { ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } });
    const result = await fetchLbs([COMPARTMENT_ID, OTHER_COMPARTMENT_ID], OCI_COMMAND);
    expect(result).toEqual({ ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } });
    expect(calls).toHaveLength(2);
  });

  it("NSGはgetとrules listのどちらの失敗でもセクション失敗になる", async () => {
    replies.set(ociCommands.nsgRulesList, { ok: false, kind: "other", raw: { message: "boom" } });
    expect(await fetchNsgWithRules(NSG_ID, OCI_COMMAND)).toEqual({
      ok: false,
      kind: "other",
      raw: { message: "boom" },
    });
  });

  it("アンカーの1段目が失敗したら2段目を叩かない", async () => {
    replies.set(ociCommands.instanceGet, { ok: false, kind: "command_launch_failed", raw: { message: "no oci" } });
    const result = await resolveAnchor(INSTANCE_ID, OCI_COMMAND);
    expect(result).toEqual({
      kind: "auth_error",
      stage: "instance_get",
      errorKind: "command_launch_failed",
      raw: { message: "no oci" },
    });
    expect(calls).toEqual([{ command: "instanceGet", params: { instanceId: INSTANCE_ID } }]);
  });
});

describe("参照先の実体なし(孤立PV)の判別", () => {
  it("割当照会が権限・不在ならVolume getで追撃し、これも権限・不在ならresource_not_foundになる", async () => {
    replies.set(ociCommands.volumeBackupPolicyAssignmentGet, FORBIDDEN_OR_NOT_FOUND);
    replies.set(ociCommands.volumeGet, FORBIDDEN_OR_NOT_FOUND);
    expect(await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND)).toEqual({
      ok: false,
      kind: "resource_not_found",
      raw: FORBIDDEN_OR_NOT_FOUND.raw,
    });
  });

  it("Volume getが成功するなら割当照会の失敗をそのまま返す(実体はある)", async () => {
    replies.set(ociCommands.volumeBackupPolicyAssignmentGet, FORBIDDEN_OR_NOT_FOUND);
    replies.set(ociCommands.volumeGet, { ok: true, data: { id: VOLUME_ID } });
    expect(await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND)).toEqual(FORBIDDEN_OR_NOT_FOUND);
  });

  it("Volume getが別種のエラーなら割当照会の失敗をそのまま返す", async () => {
    replies.set(ociCommands.volumeBackupPolicyAssignmentGet, FORBIDDEN_OR_NOT_FOUND);
    replies.set(ociCommands.volumeGet, { ok: false, kind: "not_authenticated", raw: { message: "expired" } });
    expect(await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND)).toEqual(FORBIDDEN_OR_NOT_FOUND);
  });

  it("割当照会が権限・不在以外の失敗ならVolume getを叩かない", async () => {
    replies.set(ociCommands.volumeBackupPolicyAssignmentGet, {
      ok: false,
      kind: "not_authenticated",
      raw: { message: "expired" },
    });
    const result = await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: false, kind: "not_authenticated", raw: { message: "expired" } });
    expect(calls).toEqual([{ command: "volumeBackupPolicyAssignmentGet", params: { assetId: VOLUME_ID } }]);
  });

  it("割当照会が成功する正常系ではVolume getを叩かない", async () => {
    replies.set(ociCommands.volumeBackupPolicyAssignmentGet, { ok: true, data: [{ "policy-id": BACKUP_POLICY_ID }] });
    await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND);
    expect(calls.map((call) => call.command)).not.toContain("volumeGet");
  });

  // FSSはexport / FileSystem自身のgetが失敗経路であり、これ以上確からしい存在確認が無い。
  it("FSS export getの権限・不在はそのままresource_not_foundになる", async () => {
    replies.set(ociCommands.fssExportGet, FORBIDDEN_OR_NOT_FOUND);
    const result = await fetchFssExport(FSS_EXPORT_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: false, kind: "resource_not_found", raw: FORBIDDEN_OR_NOT_FOUND.raw });
    expect(calls).toEqual([{ command: "fssExportGet", params: { exportId: FSS_EXPORT_ID } }]);
  });

  it("FileSystem getの権限・不在はそのままresource_not_foundになる", async () => {
    replies.set(ociCommands.fileSystemGet, FORBIDDEN_OR_NOT_FOUND);
    expect(await fetchFileSystem(FILE_SYSTEM_ID, OCI_COMMAND)).toEqual({
      ok: false,
      kind: "resource_not_found",
      raw: FORBIDDEN_OR_NOT_FOUND.raw,
    });
  });

  it("権限・不在以外の失敗は実体なしに倒さない", async () => {
    replies.set(ociCommands.fileSystemGet, { ok: false, kind: "other", raw: { message: "boom" } });
    expect(await fetchFileSystem(FILE_SYSTEM_ID, OCI_COMMAND)).toEqual({
      ok: false,
      kind: "other",
      raw: { message: "boom" },
    });
  });
});

describe("多段取得の合成", () => {
  it("バックアップポリシー未割当は空の結果になる(2段目を叩かない)", async () => {
    const result = await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: true, data: { policyName: undefined } });
    expect(calls).toHaveLength(1);
  });

  it("複数compartmentの結果はidで重複排除される", async () => {
    let compartment = 0;
    runMock.mockImplementation((def: CommandDef, params: unknown) => {
      calls.push({ command: commandName(def), params });
      compartment++;
      return Promise.resolve({ ok: true, data: [{ id: "ocid1.loadbalancer.oc1..dup" }, { id: `lb-${compartment}` }] });
    });
    const result = await fetchLbs([COMPARTMENT_ID, OTHER_COMPARTMENT_ID], OCI_COMMAND);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.map((lb) => lb.id)).toEqual(["ocid1.loadbalancer.oc1..dup", "lb-1", "lb-2"]);
  });
});

describe("詰め替えロジックの戻り値", () => {
  it("fetchGatewayStatus(nat)はblockTrafficを詰め替える", async () => {
    replies.set(ociCommands.natGatewayGet, {
      ok: true,
      data: { "display-name": "nat1", "lifecycle-state": "AVAILABLE", "block-traffic": true },
    });
    const result = await fetchGatewayStatus(NAT_GATEWAY_ID, OCI_COMMAND);
    expect(result).toEqual({
      ok: true,
      data: { kind: "NAT Gateway", displayName: "nat1", lifecycleState: "AVAILABLE", blockTraffic: true },
    });
  });

  it("fetchGatewayStatus(internet)はisEnabledを詰め替える", async () => {
    replies.set(ociCommands.internetGatewayGet, {
      ok: true,
      data: { "display-name": "igw1", "lifecycle-state": "AVAILABLE", "is-enabled": false },
    });
    const result = await fetchGatewayStatus(INTERNET_GATEWAY_ID, OCI_COMMAND);
    expect(result).toEqual({
      ok: true,
      data: { kind: "Internet Gateway", displayName: "igw1", lifecycleState: "AVAILABLE", isEnabled: false },
    });
  });

  it("fetchGatewayStatus(service)はblockTrafficを詰め替える", async () => {
    replies.set(ociCommands.serviceGatewayGet, {
      ok: true,
      data: { "display-name": "sgw1", "lifecycle-state": "AVAILABLE", "block-traffic": false },
    });
    const result = await fetchGatewayStatus(SERVICE_GATEWAY_ID, OCI_COMMAND);
    expect(result).toEqual({
      ok: true,
      data: { kind: "Service Gateway", displayName: "sgw1", lifecycleState: "AVAILABLE", blockTraffic: false },
    });
  });

  it("fetchGatewayStatus(lpg)はpeeringStatusを詰め替える", async () => {
    replies.set(ociCommands.localPeeringGatewayGet, {
      ok: true,
      data: { "display-name": "lpg1", "lifecycle-state": "AVAILABLE", "peering-status": "PEERED" },
    });
    const result = await fetchGatewayStatus(LPG_ID, OCI_COMMAND);
    expect(result).toEqual({
      ok: true,
      data: {
        kind: "Local Peering Gateway",
        displayName: "lpg1",
        lifecycleState: "AVAILABLE",
        peeringStatus: "PEERED",
      },
    });
  });

  it("fetchGatewayStatus(drg)はdisplayName/lifecycleStateのみ詰め替える", async () => {
    replies.set(ociCommands.drgGet, {
      ok: true,
      data: { "display-name": "drg1", "lifecycle-state": "AVAILABLE" },
    });
    const result = await fetchGatewayStatus(DRG_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: true, data: { kind: "DRG", displayName: "drg1", lifecycleState: "AVAILABLE" } });
  });

  it("fetchFssSnapshotPolicyNameはdisplay-nameをpolicyNameへ詰め替える", async () => {
    replies.set(ociCommands.fssSnapshotPolicyGet, { ok: true, data: { "display-name": "daily" } });
    const result = await fetchFssSnapshotPolicyName(FSS_POLICY_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: true, data: { policyId: FSS_POLICY_ID, policyName: "daily" } });
  });

  it("fetchManagedCertificateはcurrent-version.validity.time-of-validity-not-afterをvalidToへISO文字列で詰め替える", async () => {
    replies.set(ociCommands.managedCertificateGet, {
      ok: true,
      data: {
        name: "cert1",
        "current-version": { validity: { "time-of-validity-not-after": "2024-06-15T23:59:59+00:00" } },
      },
    });
    const result = await fetchManagedCertificate(CERTIFICATE_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: true, data: { name: "cert1", validTo: "2024-06-15T23:59:59.000Z" } });
  });

  it("fetchManagedCertificateはcurrent-version欠落時にvalidToをundefinedにする", async () => {
    replies.set(ociCommands.managedCertificateGet, { ok: true, data: { name: "cert1" } });
    const result = await fetchManagedCertificate(CERTIFICATE_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: true, data: { name: "cert1", validTo: undefined } });
  });

  it("fetchBackendSetHealthはLB/NLB共通のView形へ詰め替える", async () => {
    replies.set(ociCommands.lbBackendSetHealthGet, {
      ok: true,
      data: {
        status: "CRITICAL",
        "total-backend-count": 2,
        "critical-state-backend-names": ["10.0.0.1:32704"],
        "warning-state-backend-names": [],
        "unknown-state-backend-names": [],
      },
    });
    const result = await fetchBackendSetHealth("lb", LB_ID, "TCP-443", OCI_COMMAND);
    expect(result).toEqual({
      ok: true,
      data: {
        status: "CRITICAL",
        totalBackendCount: 2,
        criticalStateBackendNames: ["10.0.0.1:32704"],
        warningStateBackendNames: [],
        unknownStateBackendNames: [],
      },
    });
  });

  it("fetchVolumeBackupPolicyNameはvolumeBackupPolicyGetのdisplay-nameをpolicyNameへ詰め替える", async () => {
    replies.set(ociCommands.volumeBackupPolicyAssignmentGet, {
      ok: true,
      data: [{ "policy-id": BACKUP_POLICY_ID }],
    });
    replies.set(ociCommands.volumeBackupPolicyGet, { ok: true, data: { "display-name": "gold" } });
    const result = await fetchVolumeBackupPolicyName(VOLUME_ID, OCI_COMMAND);
    expect(result).toEqual({ ok: true, data: { policyId: BACKUP_POLICY_ID, policyName: "gold" } });
  });
});
