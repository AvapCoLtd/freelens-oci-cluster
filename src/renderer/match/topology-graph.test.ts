import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClusterOciData } from "../fetch/fetch";
import type { OciResult } from "../oci/result";
import type { OciBackendSetHealthView } from "../oci/types";
import { backendHealthKey } from "./backend-health";
import type { OciGatewayStatusView } from "./gateway-status";
import { toTopologyFlow } from "./topology-flow";
import {
  buildTopologyGraph,
  SUBNET_SUMMARY_ID,
  type TopologyEdge,
  type TopologyEdgeKind,
  type TopologyGraphInput,
  type TopologyK8sEndpointSlice,
  type TopologyK8sNode,
  type TopologyK8sPv,
  type TopologyK8sService,
  type TopologyNode,
} from "./topology-graph";
import { layoutTopology } from "./topology-layout";
import { matchTopologyNodes } from "./topology-search";

const STDOUT_DIR = join(import.meta.dirname, "..", "cli", "__fixtures__", "stdout");

function fixture<T>(file: string): T {
  return (JSON.parse(readFileSync(join(STDOUT_DIR, file), "utf8")) as { data: T }).data;
}

const NOT_REQUESTED = { ok: false as const, kind: "not_requested" as const, raw: { message: "not requested" } };
const FAILED = { ok: false as const, kind: "forbidden_or_not_found" as const, raw: { message: "denied" } };

function ok<T>(data: T): OciResult<T> {
  return { ok: true, data };
}

// biome-ignore lint/suspicious/noExplicitAny: 応答型はフィールド任意のためテストデータは部分形で組む
function anyOk(data: unknown): any {
  return ok(data);
}

function baseData(overrides: Partial<ClusterOciData>): ClusterOciData {
  return {
    cluster: NOT_REQUESTED,
    instances: NOT_REQUESTED,
    vnicAttachments: NOT_REQUESTED,
    vnics: {},
    taggedResources: NOT_REQUESTED,
    nlbs: NOT_REQUESTED,
    lbs: NOT_REQUESTED,
    volumes: NOT_REQUESTED,
    volumeAttachments: NOT_REQUESTED,
    fileSystems: {},
    fssExports: {},
    fssMountEntries: { ok: true, data: { entries: [], mountTargetIps: [] } },
    vcns: {},
    nodePools: NOT_REQUESTED,
    nodePoolDetails: {},
    wafs: NOT_REQUESTED,
    subnets: {},
    securityLists: {},
    routeTables: {},
    nsgs: {},
    wafPolicies: {},
    gateways: {},
    dnsChecks: {},
    dnsZones: NOT_REQUESTED,
    managedCerts: {},
    volumeBackupPolicies: {},
    fssSnapshotPolicies: {},
    resourceSearches: {},
    backendHealths: {},
    ...overrides,
  };
}

const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vcn1";
const SUBNET_A = "ocid1.subnet.oc1.ap-tokyo-1.a";
const SUBNET_B = "ocid1.subnet.oc1.ap-tokyo-1.b";
const RT_A = "ocid1.routetable.oc1.ap-tokyo-1.rt1";
const NAT = "ocid1.natgateway.oc1.ap-tokyo-1.nat1";
const DRG = "ocid1.drg.oc1.ap-tokyo-1.drg1";
const INSTANCE_1 = "ocid1.instance.oc1.ap-tokyo-1.i1";
const VNIC_1 = "ocid1.vnic.oc1.ap-tokyo-1.vnic1";
const VNIC_ATTACHMENT_1 = "ocid1.vnicattachment.oc1.ap-tokyo-1.att1";
const NLB_1 = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1";
const LB_1 = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const WAF_1 = "ocid1.webappfirewall.oc1.ap-tokyo-1.waf1";
const WAF_POLICY = "ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.wafp1";
const VOLUME_1 = "ocid1.volume.oc1.ap-tokyo-1.v1";
const VOLUME_2 = "ocid1.volume.oc1.ap-tokyo-1.v2";
const VOLUME_ATTACHMENT_1 = "ocid1.volumeattachment.oc1.ap-tokyo-1.va1";
const BACKUP_POLICY = "ocid1.volumebackuppolicy.oc1.ap-tokyo-1.bp1";
const FILE_SYSTEM_1 = "ocid1.filesystem.oc1.ap_tokyo_1.fs1";
const FSS_EXPORT_1 = "ocid1.export.oc1.ap_tokyo_1.ex1";
const SNAPSHOT_POLICY = "ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.sp1";

const BLOCK_VOLUME_DRIVER = "blockvolume.csi.oraclecloud.com";
const FSS_DRIVER = "fss.csi.oraclecloud.com";

function gatewayView(kind: string, displayName: string): OciResult<OciGatewayStatusView> {
  return ok({ kind, displayName, lifecycleState: "AVAILABLE" });
}

function k8sNode(name: string, instanceId: string | undefined, ips: string[]): TopologyK8sNode {
  return {
    metadata: { name },
    spec: { providerID: instanceId ? `oci://${instanceId}` : undefined },
    status: { addresses: ips.map((address) => ({ type: "InternalIP", address })) },
  };
}

function service(
  namespace: string,
  name: string,
  ingressIp: string,
  externalTrafficPolicy = "Cluster",
): TopologyK8sService {
  return {
    metadata: { name, namespace },
    spec: { type: "LoadBalancer", externalTrafficPolicy },
    status: { loadBalancer: { ingress: [{ ip: ingressIp }] } },
  };
}

function endpointSlice(
  namespace: string,
  serviceName: string,
  endpoints: { nodeName?: string; ready?: boolean }[],
): TopologyK8sEndpointSlice {
  return {
    metadata: { namespace, labels: { "kubernetes.io/service-name": serviceName } },
    endpoints: endpoints.map((endpoint) => ({
      nodeName: endpoint.nodeName,
      conditions: { ready: endpoint.ready },
    })),
  };
}

function pv(name: string, driver: string, volumeHandle: string): TopologyK8sPv {
  return { metadata: { name }, spec: { csi: { driver, volumeHandle }, capacity: { storage: "50Gi" } } };
}

/** 8種のエッジ・包含・Unplacedを一通り含む合成データ。 */
function fullInput(overrides: Partial<TopologyGraphInput> = {}): TopologyGraphInput {
  const data = baseData({
    cluster: anyOk({ id: "ocid1.cluster.oc1.ap-tokyo-1.c1", name: "demo", "vcn-id": VCN }),
    vcns: { [VCN]: anyOk({ id: VCN, "display-name": "demo-vcn", "cidr-block": "10.0.0.0/16" }) },
    subnets: {
      [SUBNET_A]: anyOk({
        id: SUBNET_A,
        "display-name": "node-subnet",
        "vcn-id": VCN,
        "cidr-block": "10.0.1.0/24",
        "route-table-id": RT_A,
        "security-list-ids": ["ocid1.securitylist.oc1.ap-tokyo-1.sl1"],
      }),
      [SUBNET_B]: anyOk({ id: SUBNET_B, "display-name": "lb-subnet", "vcn-id": VCN, "cidr-block": "10.0.2.0/24" }),
    },
    routeTables: {
      [RT_A]: anyOk({
        id: RT_A,
        "vcn-id": VCN,
        "route-rules": [{ "network-entity-id": NAT }, { "network-entity-id": DRG }],
      }),
    },
    gateways: { [NAT]: gatewayView("NAT Gateway", "nat"), [DRG]: gatewayView("DRG", "drg") },
    instances: anyOk([
      { id: INSTANCE_1, "display-name": "node-1", "lifecycle-state": "RUNNING", shape: "VM.Standard.E4.Flex" },
    ]),
    vnicAttachments: anyOk([]),
    nodePools: anyOk([]),
    taggedResources: anyOk([]),
    nlbs: anyOk([
      {
        id: NLB_1,
        "display-name": "ingress-nlb",
        "lifecycle-state": "ACTIVE",
        "subnet-id": SUBNET_A,
        "ip-addresses": [{ "ip-address": "10.0.1.5" }, { "ip-address": "203.0.113.1" }],
        "backend-sets": { "TCP-80": { backends: [{ "ip-address": "10.0.1.10" }] } },
      },
    ]),
    lbs: anyOk([
      {
        id: LB_1,
        "display-name": "waf-lb",
        "lifecycle-state": "ACTIVE",
        "subnet-ids": [SUBNET_B],
        "ip-addresses": [{ "ip-address": "203.0.113.9" }],
        "backend-sets": { "TCP-443": { backends: [{ "ip-address": "203.0.113.1" }] } },
      },
    ]),
    wafs: anyOk([
      {
        id: WAF_1,
        "display-name": "waf",
        "lifecycle-state": "ACTIVE",
        "load-balancer-id": LB_1,
        "web-app-firewall-policy-id": WAF_POLICY,
      },
    ]),
    volumes: anyOk([{ id: VOLUME_1, "display-name": "pvc-vol", "lifecycle-state": "AVAILABLE", "size-in-gbs": 50 }]),
    volumeAttachments: anyOk([
      {
        id: VOLUME_ATTACHMENT_1,
        "instance-id": INSTANCE_1,
        "volume-id": VOLUME_1,
        "lifecycle-state": "ATTACHED",
        "attachment-type": "paravirtualized",
        device: "/dev/oracleoci/oraclevdb",
      },
    ]),
    volumeBackupPolicies: { [VOLUME_1]: ok({ policyId: BACKUP_POLICY, policyName: "gold" }) },
    fileSystems: {
      [FILE_SYSTEM_1]: anyOk({
        "display-name": "shared-fss",
        "lifecycle-state": "ACTIVE",
        "filesystem-snapshot-policy-id": SNAPSHOT_POLICY,
      }),
    },
    fssSnapshotPolicies: { [SNAPSHOT_POLICY]: ok({ policyId: SNAPSHOT_POLICY, policyName: "daily" }) },
  });
  return {
    data,
    nodes: [k8sNode("node-1", INSTANCE_1, ["10.0.1.10"])],
    services: [service("app", "web", "203.0.113.1")],
    persistentVolumes: [
      pv("pv-block", BLOCK_VOLUME_DRIVER, VOLUME_1),
      pv("pv-fss", FSS_DRIVER, `${FILE_SYSTEM_1}:10.0.1.20:/export`),
    ],
    ...overrides,
  };
}

function nodeOf(nodes: TopologyNode[], id: string): TopologyNode {
  const found = nodes.find((node) => node.id === id);
  if (!found) throw new Error(`node not found: ${id}`);
  return found;
}

function detailValue(node: TopologyNode, label: string): string | undefined {
  return node.detail.find((row) => row.label === label)?.value;
}

/** INSTANCE_1にprimary VNICを1枚付けた入力。 */
function withVnic(
  input: TopologyGraphInput,
  vnic: Record<string, unknown>,
  attachment: Record<string, unknown> = {},
): TopologyGraphInput {
  return {
    ...input,
    data: {
      ...input.data,
      vnicAttachments: anyOk([
        {
          id: VNIC_ATTACHMENT_1,
          "instance-id": INSTANCE_1,
          "vnic-id": VNIC_1,
          "lifecycle-state": "ATTACHED",
          ...attachment,
        },
      ]),
      vnics: { [VNIC_1]: anyOk({ id: VNIC_1, "is-primary": true, ...vnic }) },
    },
  };
}

function edgeKinds(edges: { kind: TopologyEdgeKind }[]): Set<TopologyEdgeKind> {
  return new Set(edges.map((edge) => edge.kind));
}

describe("buildTopologyGraph 包含", () => {
  it("VCN⊃Subnet⊃Instance/LB、ゲートウェイはVCN直下に置く", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    expect(nodeOf(nodes, VCN)).toMatchObject({ kind: "vcn", label: "demo-vcn" });
    expect(nodeOf(nodes, VCN).parentId).toBeUndefined();
    expect(nodeOf(nodes, SUBNET_A)).toMatchObject({ kind: "subnet", parentId: VCN });
    expect(nodeOf(nodes, INSTANCE_1)).toMatchObject({ kind: "instance", parentId: SUBNET_A });
    expect(nodeOf(nodes, NLB_1)).toMatchObject({ kind: "nlb", parentId: SUBNET_A });
    expect(nodeOf(nodes, LB_1)).toMatchObject({ kind: "lb", parentId: SUBNET_B });
    expect(nodeOf(nodes, NAT)).toMatchObject({ kind: "gateway", parentId: VCN });
    expect(nodeOf(nodes, DRG)).toMatchObject({ kind: "gateway", parentId: VCN });
  });

  it("VCN外の種別(WAF/Volume/FSS/ポリシー/K8s軽ノード)は親を持たない", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    for (const id of [
      WAF_1,
      VOLUME_1,
      FILE_SYSTEM_1,
      BACKUP_POLICY,
      SNAPSHOT_POLICY,
      "k8s-service:app/web",
      "k8s-pv:pv-block",
    ]) {
      expect(nodeOf(nodes, id).parentId).toBeUndefined();
    }
  });

  it("VCN本体の取得失敗時もvcn-idラベルでVCNノードが成立する", () => {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, vcns: { [VCN]: FAILED } } });
    expect(nodeOf(nodes, VCN)).toMatchObject({ kind: "vcn", label: VCN, status: "unknown" });
  });

  it("lifecycle-stateの異常値はwarning、値を持たない種別はunknown", () => {
    const input = fullInput();
    const data = {
      ...input.data,
      instances: anyOk([{ id: INSTANCE_1, "display-name": "node-1", "lifecycle-state": "TERMINATING" }]),
    };
    const { nodes } = buildTopologyGraph({ ...input, data });
    expect(nodeOf(nodes, INSTANCE_1).status).toBe("warning");
    expect(nodeOf(nodes, NLB_1).status).toBe("ok");
    expect(nodeOf(nodes, BACKUP_POLICY).status).toBe("unknown");
    expect(nodeOf(nodes, "k8s-pv:pv-block").status).toBe("unknown");
  });

  it("コンソールリンクは対応種別のみ設定する", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    expect(nodeOf(nodes, INSTANCE_1).consoleUrl).toBe(
      `https://cloud.oracle.com/compute/instances/${INSTANCE_1}?region=ap-tokyo-1`,
    );
    expect(nodeOf(nodes, SUBNET_A).consoleUrl).toBe(
      `https://cloud.oracle.com/networking/vcns/${VCN}/subnets/${SUBNET_A}?region=ap-tokyo-1`,
    );
    expect(nodeOf(nodes, WAF_1).consoleUrl).toContain(`/waf/policies/${WAF_POLICY}/firewalls/${WAF_1}`);
    expect(nodeOf(nodes, VCN).consoleUrl).toBe(`https://cloud.oracle.com/networking/vcns/${VCN}?region=ap-tokyo-1`);
    expect(nodeOf(nodes, NAT).consoleUrl).toBe(
      `https://cloud.oracle.com/networking/vcns/${VCN}/nat-gateways/${NAT}?region=ap-tokyo-1`,
    );
    expect(nodeOf(nodes, DRG).consoleUrl).toBe(`https://cloud.oracle.com/networking/drgs/${DRG}?region=ap-tokyo-1`);
    expect(nodeOf(nodes, "k8s-service:app/web").consoleUrl).toBeUndefined();
  });

  it("PVノードは参照先ストレージのコンソールURLを持つ", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    expect(nodeOf(nodes, "k8s-pv:pv-block").consoleUrl).toBe(
      `https://cloud.oracle.com/block-storage/volumes/${VOLUME_1}?region=ap-tokyo-1`,
    );
    expect(nodeOf(nodes, "k8s-pv:pv-fss").consoleUrl).toBe(
      `https://cloud.oracle.com/fss/file-systems/${FILE_SYSTEM_1}?region=ap-tokyo-1`,
    );
  });

  it("詳細は共通3項目+種別固有5項目までに収める", () => {
    const { nodes } = buildTopologyGraph(
      withVnic(fullInput(), { "subnet-id": SUBNET_A, "private-ip": "10.0.1.10", "public-ip": "203.0.113.50" }),
    );
    for (const node of nodes) {
      expect(node.detail.length).toBeLessThanOrEqual(8);
    }
    expect(nodeOf(nodes, SUBNET_A).detail).toEqual([
      { label: "Name", value: "node-subnet" },
      { label: "OCID", value: SUBNET_A, role: "ocid" },
      { label: "CIDR", value: "10.0.1.0/24", role: "cidr" },
      { label: "Route Table", value: RT_A },
      { label: "Security Lists", value: "ocid1.securitylist.oc1.ap-tokyo-1.sl1" },
    ]);
  });
});

describe("buildTopologyGraph エッジ", () => {
  it("8種のエッジを引く", () => {
    const { edges } = buildTopologyGraph(fullInput());
    expect(edgeKinds(edges)).toEqual(
      new Set([
        "backend",
        "waf-lb",
        "service-lb",
        "pv-storage",
        "attachment",
        "volume-backup",
        "fss-snapshot",
        "route",
      ]),
    );
    expect(edges).toEqual(
      expect.arrayContaining([
        { id: `backend|${NLB_1}|${INSTANCE_1}`, source: NLB_1, target: INSTANCE_1, kind: "backend" },
        { id: `backend|${LB_1}|${NLB_1}`, source: LB_1, target: NLB_1, kind: "backend" },
        { id: `waf-lb|${WAF_1}|${LB_1}`, source: WAF_1, target: LB_1, kind: "waf-lb" },
        {
          id: `service-lb|k8s-service:app/web|${NLB_1}`,
          source: "k8s-service:app/web",
          target: NLB_1,
          kind: "service-lb",
        },
        {
          id: `pv-storage|k8s-pv:pv-block|${VOLUME_1}`,
          source: "k8s-pv:pv-block",
          target: VOLUME_1,
          kind: "pv-storage",
        },
        {
          id: `volume-backup|${VOLUME_1}|${BACKUP_POLICY}`,
          source: VOLUME_1,
          target: BACKUP_POLICY,
          kind: "volume-backup",
        },
        {
          id: `fss-snapshot|${FILE_SYSTEM_1}|${SNAPSHOT_POLICY}`,
          source: FILE_SYSTEM_1,
          target: SNAPSHOT_POLICY,
          kind: "fss-snapshot",
        },
        { id: `attachment|${INSTANCE_1}|${VOLUME_1}`, source: INSTANCE_1, target: VOLUME_1, kind: "attachment" },
        { id: `route|${SUBNET_A}|${NAT}`, source: SUBNET_A, target: NAT, kind: "route" },
        { id: `route|${SUBNET_A}|${DRG}`, source: SUBNET_A, target: DRG, kind: "route" },
      ]),
    );
  });

  it("エッジidは一意で、source・target・kindから決まる", () => {
    const { edges } = buildTopologyGraph(fullInput());
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
    for (const edge of edges) expect(edge.id).toBe(`${edge.kind}|${edge.source}|${edge.target}`);
  });

  it("同一backend IPに複数候補が一致すると全候補へエッジを引く", () => {
    const instance2 = "ocid1.instance.oc1.ap-tokyo-1.i2";
    const input = fullInput();
    const data = {
      ...input.data,
      instances: anyOk([
        { id: INSTANCE_1, "display-name": "node-1", "lifecycle-state": "RUNNING" },
        { id: instance2, "display-name": "node-2", "lifecycle-state": "RUNNING" },
      ]),
    };
    const { edges } = buildTopologyGraph({
      ...input,
      data,
      nodes: [k8sNode("node-1", INSTANCE_1, ["10.0.1.10"]), k8sNode("node-2", instance2, ["10.0.1.10"])],
    });
    const backends = edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1);
    expect(backends.map((edge) => edge.target)).toEqual([INSTANCE_1, instance2]);
  });

  it("循環するbackend参照でも停止し双方向のエッジを1本ずつ引く", () => {
    const lb2 = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb2";
    const input = fullInput();
    const data = {
      ...input.data,
      lbs: anyOk([
        {
          id: LB_1,
          "display-name": "lb-1",
          "subnet-ids": [SUBNET_B],
          "ip-addresses": [{ "ip-address": "10.0.2.1" }],
          "backend-sets": { a: { backends: [{ "ip-address": "10.0.2.2" }, { "ip-address": "10.0.2.1" }] } },
        },
        {
          id: lb2,
          "display-name": "lb-2",
          "subnet-ids": [SUBNET_B],
          "ip-addresses": [{ "ip-address": "10.0.2.2" }],
          "backend-sets": { a: { backends: [{ "ip-address": "10.0.2.1" }] } },
        },
      ]),
      wafs: anyOk([]),
    };
    const { edges } = buildTopologyGraph({ ...input, data, services: [service("app", "web", "10.0.2.1")] });
    const between = edges.filter((edge) => edge.kind === "backend" && edge.source !== NLB_1);
    expect(between).toEqual([
      { id: `backend|${LB_1}|${lb2}`, source: LB_1, target: lb2, kind: "backend" },
      { id: `backend|${lb2}|${LB_1}`, source: lb2, target: LB_1, kind: "backend" },
    ]);
  });

  it("照合入力が揃っていて一致しないだけのときはエッジを引かず欠落にもしない", () => {
    const input = fullInput();
    const { edges, missing } = buildTopologyGraph({
      ...input,
      services: [service("app", "web", "198.51.100.7")],
    });
    expect(edges.some((edge) => edge.kind === "service-lb")).toBe(false);
    expect(missing).toEqual([]);
  });
});

describe("buildTopologyGraph バックエンドヘルス", () => {
  const NLB_SET_HEALTH = backendHealthKey("nlb", NLB_1, "TCP-80");
  const LB_SET_HEALTH = backendHealthKey("lb", LB_1, "TCP-443");

  function withHealths(backendHealths: ClusterOciData["backendHealths"]): TopologyGraphInput {
    const input = fullInput();
    return { ...input, data: { ...input.data, backendHealths } };
  }

  function backendEdge(input: TopologyGraphInput, source: string, target: string): TopologyEdge | undefined {
    const { edges } = buildTopologyGraph(input);
    return edges.find((edge) => edge.kind === "backend" && edge.source === source && edge.target === target);
  }

  it("ヘルス未取得のbackendエッジはhealthを持たない", () => {
    expect(backendEdge(fullInput(), NLB_1, INSTANCE_1)).not.toHaveProperty("health");
  });

  it("ヘルス取得に失敗したbackend setのエッジはhealthを持たない", () => {
    expect(backendEdge(withHealths({ [NLB_SET_HEALTH]: FAILED }), NLB_1, INSTANCE_1)).not.toHaveProperty("health");
  });

  it("state名リストのIP:portに一致するInstanceの状態を引く", () => {
    const cases = [
      ["criticalStateBackendNames", "critical"],
      ["warningStateBackendNames", "warning"],
      ["unknownStateBackendNames", "unknown"],
    ] as const;
    for (const [field, expected] of cases) {
      const input = withHealths({ [NLB_SET_HEALTH]: ok({ [field]: ["10.0.1.10:32704"] }) });
      expect(backendEdge(input, NLB_1, INSTANCE_1)?.health).toBe(expected);
    }
  });

  it("ヘルスがありどのstate名リストにも無いInstanceはokになる", () => {
    const input = withHealths({ [NLB_SET_HEALTH]: ok({ status: "OK", totalBackendCount: 1 }) });
    expect(backendEdge(input, NLB_1, INSTANCE_1)?.health).toBe("ok");
  });

  it("LB→NLBのbackendエッジもLB側のbackend set healthで判定する", () => {
    const input = withHealths({ [LB_SET_HEALTH]: ok({ criticalStateBackendNames: ["203.0.113.1:443"] }) });
    expect(backendEdge(input, LB_1, NLB_1)?.health).toBe("critical");
    // NLB側のヘルスは未取得のまま(LB側の取得結果が別のエッジへ漏れない)
    expect(backendEdge(input, NLB_1, INSTANCE_1)).not.toHaveProperty("health");
  });

  it("同じInstanceへ向かう複数backend setの状態は深刻な方へ寄せる", () => {
    const input = fullInput();
    const data = {
      ...input.data,
      nlbs: anyOk([
        {
          id: NLB_1,
          "display-name": "ingress-nlb",
          "lifecycle-state": "ACTIVE",
          "subnet-id": SUBNET_A,
          "ip-addresses": [{ "ip-address": "10.0.1.5" }, { "ip-address": "203.0.113.1" }],
          "backend-sets": {
            "TCP-80": { backends: [{ "ip-address": "10.0.1.10" }] },
            "TCP-443": { backends: [{ "ip-address": "10.0.1.10" }] },
          },
        },
      ]),
      backendHealths: {
        [NLB_SET_HEALTH]: ok({ status: "OK" }),
        [backendHealthKey("nlb", NLB_1, "TCP-443")]: ok({ warningStateBackendNames: ["10.0.1.10:443"] }),
      },
    };
    expect(backendEdge({ ...input, data }, NLB_1, INSTANCE_1)?.health).toBe("warning");
  });

  it("ポートを持たないbackend名もIPとして突き合わせる", () => {
    const input = withHealths({ [NLB_SET_HEALTH]: ok({ criticalStateBackendNames: ["10.0.1.10"] }) });
    expect(backendEdge(input, NLB_1, INSTANCE_1)?.health).toBe("critical");
  });
});

describe("buildTopologyGraph externalTrafficPolicy: Localによる格下げ", () => {
  const NLB_SET_HEALTH = backendHealthKey("nlb", NLB_1, "TCP-80");
  const LB_SET_HEALTH = backendHealthKey("lb", LB_1, "TCP-443");
  const OTHER_NODE = [endpointSlice("app", "web", [{ nodeName: "node-2", ready: true }])];

  /** node-1(INSTANCE_1)へのbackendエッジがcriticalになる入力。 */
  function criticalInput(overrides: Partial<TopologyGraphInput> = {}): TopologyGraphInput {
    const input = fullInput({
      services: [service("app", "web", "203.0.113.1", "Local")],
      endpointSlices: OTHER_NODE,
      ...overrides,
    });
    return {
      ...input,
      data: {
        ...input.data,
        backendHealths: {
          [NLB_SET_HEALTH]: ok({ criticalStateBackendNames: ["10.0.1.10:32704"] }),
          [LB_SET_HEALTH]: ok({ criticalStateBackendNames: ["203.0.113.1:443"] }),
        },
      },
    };
  }

  function healthOf(input: TopologyGraphInput, source: string, target: string) {
    const { edges } = buildTopologyGraph(input);
    return edges.find((edge) => edge.kind === "backend" && edge.source === source && edge.target === target)?.health;
  }

  it("Localかつ当該ノードにready endpointが無いcriticalを格下げする", () => {
    expect(healthOf(criticalInput(), NLB_1, INSTANCE_1)).toBe("no-local-pod");
  });

  it("Localかつ当該ノードにready endpointが有ればcriticalのまま残す", () => {
    const endpointSlices = [endpointSlice("app", "web", [{ nodeName: "node-1", ready: true }])];
    expect(healthOf(criticalInput({ endpointSlices }), NLB_1, INSTANCE_1)).toBe("critical");
  });

  it("externalTrafficPolicyがClusterならcriticalのまま残す", () => {
    const services = [service("app", "web", "203.0.113.1", "Cluster")];
    expect(healthOf(criticalInput({ services }), NLB_1, INSTANCE_1)).toBe("critical");
  });

  it("EndpointSliceを渡さなければcriticalのまま残す", () => {
    expect(healthOf(criticalInput({ endpointSlices: undefined }), NLB_1, INSTANCE_1)).toBe("critical");
  });

  it("ready endpointがどのノードにも無ければcriticalのまま残す", () => {
    const endpointSlices = [endpointSlice("app", "web", [{ nodeName: "node-2", ready: false }])];
    expect(healthOf(criticalInput({ endpointSlices }), NLB_1, INSTANCE_1)).toBe("critical");
  });

  it("LBに対応するServiceが無ければcriticalのまま残す", () => {
    const services = [service("app", "web", "198.51.100.7", "Local")];
    expect(healthOf(criticalInput({ services }), NLB_1, INSTANCE_1)).toBe("critical");
  });

  it("同じLBにLocal以外のServiceも対応していればcriticalのまま残す", () => {
    const services = [service("app", "web", "203.0.113.1", "Local"), service("app", "api", "203.0.113.1", "Cluster")];
    const endpointSlices = [...OTHER_NODE, endpointSlice("app", "api", [{ nodeName: "node-2", ready: true }])];
    expect(healthOf(criticalInput({ services, endpointSlices }), NLB_1, INSTANCE_1)).toBe("critical");
  });

  it("warningも同じ条件で格下げする", () => {
    const input = criticalInput();
    const data = {
      ...input.data,
      backendHealths: { [NLB_SET_HEALTH]: ok({ warningStateBackendNames: ["10.0.1.10:32704"] }) },
    };
    expect(healthOf({ ...input, data }, NLB_1, INSTANCE_1)).toBe("no-local-pod");
  });

  it("ok・unknownは格下げの対象にしない", () => {
    const input = criticalInput();
    const withHealth = (health: OciResult<OciBackendSetHealthView>) => ({
      ...input,
      data: { ...input.data, backendHealths: { [NLB_SET_HEALTH]: health } },
    });
    expect(healthOf(withHealth(ok({ status: "OK" })), NLB_1, INSTANCE_1)).toBe("ok");
    expect(healthOf(withHealth(ok({ unknownStateBackendNames: ["10.0.1.10:32704"] })), NLB_1, INSTANCE_1)).toBe(
      "unknown",
    );
  });

  it("K8s Nodeへ対応しないbackend(LB→NLB)は格下げしない", () => {
    expect(healthOf(criticalInput(), LB_1, NLB_1)).toBe("critical");
  });

  it("集約ノードへ畳んだエッジは格下げされていない側の状態を残す", () => {
    const instances = Array.from({ length: 11 }, (_, index) => ({
      id: `${INSTANCE_1}${index}`,
      "display-name": `node-${index}`,
      "lifecycle-state": "RUNNING",
    }));
    const input = criticalInput({
      nodes: instances.map((instance, index) => k8sNode(`node-${index}`, instance.id, [`10.0.1.${20 + index}`])),
    });
    const data = {
      ...input.data,
      instances: anyOk(instances),
      nlbs: anyOk([
        {
          id: NLB_1,
          "display-name": "ingress-nlb",
          "lifecycle-state": "ACTIVE",
          "subnet-id": SUBNET_A,
          "ip-addresses": [{ "ip-address": "10.0.1.5" }, { "ip-address": "203.0.113.1" }],
          "backend-sets": {
            "TCP-80": { backends: instances.map((_, index) => ({ "ip-address": `10.0.1.${20 + index}` })) },
          },
        },
      ]),
      backendHealths: {
        [NLB_SET_HEALTH]: ok({
          criticalStateBackendNames: instances.map((_, index) => `10.0.1.${20 + index}:32704`),
        }),
      },
    };
    // node-0にだけready endpointがあり、他の10台は格下げされる。
    const endpointSlices = [endpointSlice("app", "web", [{ nodeName: "node-0", ready: true }])];
    const { edges } = buildTopologyGraph({ ...input, data, endpointSlices });
    const backends = edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1);
    expect(backends).toHaveLength(1);
    expect(backends[0]?.target).toContain("instance-group:");
    expect(backends[0]?.health).toBe("critical");
  });

  it("localTrafficは判定材料と格下げ本数を数える", () => {
    expect(buildTopologyGraph(criticalInput()).localTraffic).toEqual({
      endpointSlices: 1,
      localServices: 1,
      downgraded: 1,
    });
  });

  it("EndpointSliceが空でもlocalServicesは数え、材料不足を切り分けられる", () => {
    expect(buildTopologyGraph(criticalInput({ endpointSlices: undefined })).localTraffic).toEqual({
      endpointSlices: 0,
      localServices: 1,
      downgraded: 0,
    });
  });

  it("LB対応ServiceがClusterのみならlocalServicesは0", () => {
    const services = [service("app", "web", "203.0.113.1", "Cluster")];
    expect(buildTopologyGraph(criticalInput({ services })).localTraffic).toEqual({
      endpointSlices: 1,
      localServices: 0,
      downgraded: 0,
    });
  });
});

describe("buildTopologyGraph Unplaced", () => {
  it("InternalIPがどのSubnet CIDRにも一致しないInstanceは親を持たない", () => {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({ ...input, nodes: [k8sNode("node-1", INSTANCE_1, ["192.0.2.10"])] });
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBeUndefined();
  });

  it("複数SubnetのCIDRに一致するInstanceは親を持たない", () => {
    const input = fullInput();
    const subnets = {
      ...input.data.subnets,
      [SUBNET_B]: anyOk({ id: SUBNET_B, "display-name": "lb-subnet", "vcn-id": VCN, "cidr-block": "10.0.0.0/16" }),
    };
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, subnets } });
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBeUndefined();
  });

  it("providerIDを解決できないNodeのInstanceノードは作らない", () => {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({
      ...input,
      nodes: [k8sNode("virtual-node", undefined, ["10.0.1.10"])],
    });
    expect(nodes.some((node) => node.kind === "instance")).toBe(false);
  });

  it("配置に使うのはInternalIPだけで、ExternalIPは根拠にしない", () => {
    const input = fullInput();
    const node: TopologyK8sNode = {
      metadata: { name: "node-1" },
      spec: { providerID: `oci://${INSTANCE_1}` },
      status: {
        addresses: [
          { type: "InternalIP", address: "192.0.2.10" },
          { type: "ExternalIP", address: "10.0.1.10" },
        ],
      },
    };
    const { nodes } = buildTopologyGraph({ ...input, nodes: [node] });
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBeUndefined();
  });

  it("複数InternalIPは同一Subnetに収まれば配置し、別Subnetに散れば曖昧として置かない", () => {
    const input = fullInput();
    const placed = buildTopologyGraph({ ...input, nodes: [k8sNode("node-1", INSTANCE_1, ["10.0.1.10", "10.0.1.11"])] });
    expect(nodeOf(placed.nodes, INSTANCE_1).parentId).toBe(SUBNET_A);
    const ambiguous = buildTopologyGraph({
      ...input,
      nodes: [k8sNode("node-1", INSTANCE_1, ["10.0.1.10", "10.0.2.11"])],
    });
    expect(nodeOf(ambiguous.nodes, INSTANCE_1).parentId).toBeUndefined();
  });

  it("不正なIP・CIDRは例外にせず配置根拠なしとして扱う", () => {
    const input = fullInput();
    const subnets = {
      [SUBNET_A]: anyOk({ id: SUBNET_A, "display-name": "broken", "vcn-id": VCN, "cidr-block": "10.0.1.0/99" }),
    };
    const graph = buildTopologyGraph({
      ...input,
      data: { ...input.data, subnets },
      nodes: [k8sNode("node-1", INSTANCE_1, ["10.0.1.999"])],
    });
    expect(nodeOf(graph.nodes, INSTANCE_1).parentId).toBeUndefined();
  });

  it("subnet-idsのうち図にあるSubnetの先頭へclassic LBを置き、詳細には全subnetを載せる", () => {
    const input = fullInput();
    const lbs = anyOk([
      {
        id: LB_1,
        "display-name": "waf-lb",
        "lifecycle-state": "ACTIVE",
        "subnet-ids": [SUBNET_B, SUBNET_A, "ocid1.subnet.oc1.ap-tokyo-1.unknown"],
        "ip-addresses": [{ "ip-address": "203.0.113.9" }],
        "backend-sets": { "TCP-443": { backends: [{ "ip-address": "203.0.113.1" }] } },
      },
    ]);
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, lbs } });
    const lb = nodeOf(nodes, LB_1);
    expect(lb.parentId).toBe(SUBNET_A);
    expect(lb.detail).toContainEqual({
      label: "Subnets",
      value: [SUBNET_B, SUBNET_A, "ocid1.subnet.oc1.ap-tokyo-1.unknown"].join("\n"),
    });
  });
});

describe("buildTopologyGraph Subnetの絞り込み", () => {
  const SUBNET_ENDPOINT = "ocid1.subnet.oc1.ap-tokyo-1.endpoint";
  const SUBNET_OTHER_1 = "ocid1.subnet.oc1.ap-tokyo-1.other1";
  const SUBNET_OTHER_2 = "ocid1.subnet.oc1.ap-tokyo-1.other2";
  const RT_OTHER = "ocid1.routetable.oc1.ap-tokyo-1.rt2";
  const SGW = "ocid1.servicegateway.oc1.ap-tokyo-1.sgw1";

  /** 共有VCN(クラスタと無関係なSubnetが同居)を模した入力。 */
  function sharedVcnInput(overrides: Partial<TopologyGraphInput> = {}): TopologyGraphInput {
    const input = fullInput();
    const other = (id: string, cidr: string) =>
      anyOk({ id, "display-name": `other-${id}`, "vcn-id": VCN, "cidr-block": cidr, "route-table-id": RT_OTHER });
    const data = {
      ...input.data,
      cluster: anyOk({
        id: "ocid1.cluster.oc1.ap-tokyo-1.c1",
        name: "demo",
        "vcn-id": VCN,
        "endpoint-config": { "subnet-id": SUBNET_ENDPOINT },
      }),
      subnets: {
        ...input.data.subnets,
        [SUBNET_ENDPOINT]: anyOk({
          id: SUBNET_ENDPOINT,
          "display-name": "endpoint-subnet",
          "vcn-id": VCN,
          "cidr-block": "10.0.9.0/28",
          "route-table-id": RT_A,
        }),
        [SUBNET_OTHER_1]: other(SUBNET_OTHER_1, "10.0.100.0/24"),
        [SUBNET_OTHER_2]: other(SUBNET_OTHER_2, "10.0.101.0/24"),
      },
      routeTables: {
        ...input.data.routeTables,
        [RT_OTHER]: anyOk({ id: RT_OTHER, "vcn-id": VCN, "route-rules": [{ "network-entity-id": SGW }] }),
      },
      gateways: { ...input.data.gateways, [SGW]: gatewayView("Service Gateway", "sgw") },
    };
    return { ...input, data, ...overrides };
  }

  it("クラスタ関連の子を持たないSubnetはノード化せず件数サマリにまとめる", () => {
    const { nodes } = buildTopologyGraph(sharedVcnInput());
    expect(nodes.some((node) => node.id === SUBNET_OTHER_1)).toBe(false);
    expect(nodes.some((node) => node.id === SUBNET_OTHER_2)).toBe(false);
    expect(nodeOf(nodes, SUBNET_SUMMARY_ID)).toMatchObject({
      kind: "subnet-summary",
      label: "2 subnets not shown",
      parentId: VCN,
      count: 2,
    });
  });

  it("件数サマリは畳んだSubnetの名前・CIDR・OCIDを一覧に持つ", () => {
    const { nodes } = buildTopologyGraph(sharedVcnInput());
    expect(nodeOf(nodes, SUBNET_SUMMARY_ID).detail).toEqual([
      { label: `other-${SUBNET_OTHER_1} 10.0.100.0/24`, value: SUBNET_OTHER_1, role: "ocid" },
      { label: `other-${SUBNET_OTHER_2} 10.0.101.0/24`, value: SUBNET_OTHER_2, role: "ocid" },
    ]);
  });

  it("endpointサブネットは子が無くても残す", () => {
    const { nodes } = buildTopologyGraph(sharedVcnInput());
    expect(nodeOf(nodes, SUBNET_ENDPOINT)).toMatchObject({ kind: "subnet", parentId: VCN });
    expect(nodeOf(nodes, SUBNET_A)).toMatchObject({ kind: "subnet" });
    expect(nodeOf(nodes, SUBNET_B)).toMatchObject({ kind: "subnet" });
  });

  it("表示Subnetから参照されないゲートウェイはノード化しない", () => {
    const { nodes } = buildTopologyGraph(sharedVcnInput());
    expect(nodes.filter((node) => node.kind === "gateway").map((node) => node.id)).toEqual([DRG, NAT]);
  });

  it("routeエッジは表示Subnet発のみ引く", () => {
    const { edges } = buildTopologyGraph(sharedVcnInput());
    const routes = edges.filter((edge) => edge.kind === "route");
    expect(routes.map((edge) => `${edge.source}|${edge.target}`)).toEqual([
      `${SUBNET_A}|${DRG}`,
      `${SUBNET_A}|${NAT}`,
      `${SUBNET_ENDPOINT}|${DRG}`,
      `${SUBNET_ENDPOINT}|${NAT}`,
    ]);
  });

  it("無関係なSubnetが無ければサマリノードを作らない", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    expect(nodes.some((node) => node.kind === "subnet-summary")).toBe(false);
  });

  it("endpointサブネットが取得できていなければ件数に数える", () => {
    const input = sharedVcnInput();
    const subnets = { ...input.data.subnets };
    delete subnets[SUBNET_ENDPOINT];
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, subnets } });
    expect(nodes.some((node) => node.id === SUBNET_ENDPOINT)).toBe(false);
    expect(nodeOf(nodes, SUBNET_SUMMARY_ID).count).toBe(2);
  });

  it('件数サマリはdisplay-name未設定ならOCID、複数CIDRは", "連結で並べる', () => {
    const input = sharedVcnInput();
    const NO_NAME = "ocid1.subnet.oc1.ap-tokyo-1.noname";
    const DUAL = "ocid1.subnet.oc1.ap-tokyo-1.dual";
    const subnets = {
      ...input.data.subnets,
      [NO_NAME]: anyOk({ id: NO_NAME, "vcn-id": VCN, "route-table-id": RT_OTHER }),
      [DUAL]: anyOk({
        id: DUAL,
        "display-name": "dual-stack",
        "vcn-id": VCN,
        "cidr-block": "10.0.102.0/24",
        "ipv6-cidr-block": "fd00::/64",
        "route-table-id": RT_OTHER,
      }),
    };
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, subnets } });
    const detail = nodeOf(nodes, SUBNET_SUMMARY_ID).detail;
    expect(detail).toContainEqual({ label: "dual-stack 10.0.102.0/24, fd00::/64", value: DUAL, role: "ocid" });
    expect(detail).toContainEqual({ label: NO_NAME, value: NO_NAME, role: "ocid" });
  });
});

describe("buildTopologyGraph 集約縮退", () => {
  function manyInstancesInput(count: number, expandedSubnetIds?: Set<string>): TopologyGraphInput {
    const input = fullInput();
    const ids = Array.from({ length: count }, (_, index) => `ocid1.instance.oc1.ap-tokyo-1.i${index + 10}`);
    const data = {
      ...input.data,
      instances: anyOk(ids.map((id, index) => ({ id, "display-name": `node-${index}`, "lifecycle-state": "RUNNING" }))),
      nlbs: anyOk([
        {
          id: NLB_1,
          "display-name": "ingress-nlb",
          "lifecycle-state": "ACTIVE",
          "subnet-id": SUBNET_A,
          "ip-addresses": [{ "ip-address": "10.0.1.5" }, { "ip-address": "203.0.113.1" }],
          "backend-sets": {
            "TCP-80": { backends: ids.slice(0, 3).map((_, index) => ({ "ip-address": `10.0.1.${index + 20}` })) },
          },
        },
      ]),
    };
    return {
      ...input,
      data,
      nodes: ids.map((id, index) => k8sNode(`node-${index}`, id, [`10.0.1.${index + 20}`])),
      expandedSubnetIds,
    };
  }

  it("Subnet内Instanceが10件までは畳まない", () => {
    const { nodes } = buildTopologyGraph(manyInstancesInput(10));
    expect(nodes.filter((node) => node.kind === "instance")).toHaveLength(10);
    expect(nodes.some((node) => node.kind === "instance-group")).toBe(false);
  });

  it("10件を超えると集約ノードへ畳み、メンバー宛てエッジを付け替えて重複排除する", () => {
    const { nodes, edges } = buildTopologyGraph(manyInstancesInput(11));
    const group = nodeOf(nodes, `instance-group:${SUBNET_A}`);
    expect(group).toMatchObject({ kind: "instance-group", label: "11 nodes", parentId: SUBNET_A, count: 11 });
    expect(group.memberIds).toHaveLength(11);
    expect(nodes.some((node) => node.kind === "instance")).toBe(false);
    expect(edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1)).toEqual([
      {
        id: `backend|${NLB_1}|instance-group:${SUBNET_A}`,
        source: NLB_1,
        target: `instance-group:${SUBNET_A}`,
        kind: "backend",
      },
    ]);
  });

  it("集約ノードへ畳んだInstanceのヘルスは深刻な方へ寄せる", () => {
    const input = manyInstancesInput(11);
    const data = {
      ...input.data,
      backendHealths: {
        [backendHealthKey("nlb", NLB_1, "TCP-80")]: ok({ criticalStateBackendNames: ["10.0.1.22:32704"] }),
      },
    };
    const { edges } = buildTopologyGraph({ ...input, data });
    const backends = edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1);
    expect(backends.map((edge) => edge.health)).toEqual(["critical"]);
  });

  it("畳んだInstanceの名前・OCIDで集約ノードが検索にマッチする", () => {
    const graph = buildTopologyGraph(manyInstancesInput(11));
    const flow = toTopologyFlow(graph, layoutTopology(graph.nodes, graph.edges));
    expect([...matchTopologyNodes(flow.nodes, "node-7")]).toEqual([`instance-group:${SUBNET_A}`]);
    expect([...matchTopologyNodes(flow.nodes, "ocid1.instance.oc1.ap-tokyo-1.i17")]).toEqual([
      `instance-group:${SUBNET_A}`,
    ]);
  });

  it("展開中のSubnetは個々のInstanceとメンバー宛てエッジに戻す", () => {
    const { nodes, edges } = buildTopologyGraph(manyInstancesInput(11, new Set([SUBNET_A])));
    expect(nodes.filter((node) => node.kind === "instance")).toHaveLength(11);
    expect(nodes.some((node) => node.kind === "instance-group")).toBe(false);
    expect(edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1)).toHaveLength(3);
  });

  const POOL_A = "ocid1.nodepool.oc1.ap-tokyo-1.pa";
  const POOL_B = "ocid1.nodepool.oc1.ap-tokyo-1.pb";

  function instanceIdsOf(input: TopologyGraphInput): string[] {
    return (input.data.instances.ok ? input.data.instances.data : []).map((instance) => instance.id);
  }

  function poolDetail(memberIds: string[]): ClusterOciData["nodePoolDetails"][string] {
    return ok({ "cluster-id": "ocid1.cluster.oc1.ap-tokyo-1.c1", nodes: memberIds.map((id) => ({ id })) });
  }

  /** count件のInstanceのうち先頭split件をPOOL_A、残りをPOOL_Bへ割り当てた入力。 */
  function pooledInput(count: number, split: number): TopologyGraphInput {
    const input = manyInstancesInput(count);
    const ids = instanceIdsOf(input);
    return {
      ...input,
      data: {
        ...input.data,
        nodePools: anyOk([
          {
            id: POOL_A,
            name: "pool-a",
            "node-shape": "VM.Standard.E4.Flex",
            "kubernetes-version": "v1.31.1",
            "node-config-details": { size: split },
          },
          { id: POOL_B, name: "pool-b" },
        ]),
        nodePoolDetails: {
          [POOL_A]: poolDetail(ids.slice(0, split)),
          [POOL_B]: poolDetail(ids.slice(split)),
        },
      },
    };
  }

  it("Subnet内の集約をノードプール単位へ割り、ラベルにプール名を出す", () => {
    const { nodes, edges } = buildTopologyGraph(pooledInput(12, 7));
    expect(nodes.some((node) => node.kind === "instance")).toBe(false);
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_A}`)).toMatchObject({
      label: "pool-a (7 nodes)",
      summary: "VM.Standard.E4.Flex · v1.31.1",
      parentId: SUBNET_A,
      count: 7,
    });
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_B}`)).toMatchObject({
      label: "pool-b (5 nodes)",
      count: 5,
    });
    // バックエンドのIPはPOOL_A側の3件。エッジはそのプールの集約ノードへ寄る。
    expect(edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1)).toEqual([
      {
        id: `backend|${NLB_1}|instance-group:${SUBNET_A}:${POOL_A}`,
        source: NLB_1,
        target: `instance-group:${SUBNET_A}:${POOL_A}`,
        kind: "backend",
      },
    ]);
  });

  it("集約ノードの詳細にプールの構成と畳んだInstanceを載せる", () => {
    const { nodes } = buildTopologyGraph(pooledInput(12, 7));
    const detail = nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_A}`).detail;
    expect(detail).toContainEqual({ label: "Node Pool", value: "pool-a", role: undefined });
    expect(detail).toContainEqual({ label: "OCID", value: POOL_A, role: "ocid" });
    expect(detail).toContainEqual({ label: "Size", value: "7", role: undefined });
    expect(detail).toContainEqual({ label: "Instances", value: "7" });
    expect(detail.filter((row) => row.label === "Member")).toHaveLength(7);
  });

  it("個々のInstanceの詳細にも所属プール名を出す", () => {
    const { nodes } = buildTopologyGraph({ ...pooledInput(12, 7), expandedSubnetIds: new Set([SUBNET_A]) });
    const detail = nodeOf(nodes, instanceIdsOf(manyInstancesInput(12))[0] as string).detail;
    expect(detail).toContainEqual({ label: "Node Pool", value: "pool-a", role: undefined });
  });

  it("どのプールにも属さないInstanceは1つの束へまとめる", () => {
    const input = pooledInput(12, 7);
    const { nodes } = buildTopologyGraph({
      ...input,
      // POOL_B側の割り当てを消すと、その5件はプール不明になる。
      data: { ...input.data, nodePoolDetails: { [POOL_A]: poolDetail(instanceIdsOf(input).slice(0, 7)) } },
    });
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_A}`).count).toBe(7);
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}`)).toMatchObject({ label: "5 nodes", count: 5 });
  });

  it("プール本体を取得できなければ従来どおり1つの集約ノードへ畳む", () => {
    const input = pooledInput(11, 6);
    const { nodes } = buildTopologyGraph({
      ...input,
      data: { ...input.data, nodePoolDetails: { [POOL_A]: FAILED, [POOL_B]: FAILED } },
    });
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}`)).toMatchObject({ label: "11 nodes", count: 11 });
    expect(nodes.filter((node) => node.kind === "instance-group")).toHaveLength(1);
  });

  it("1件だけのプールは畳まずInstanceのまま残す", () => {
    const { nodes } = buildTopologyGraph(pooledInput(12, 11));
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_A}`).count).toBe(11);
    expect(nodes.filter((node) => node.kind === "instance")).toHaveLength(1);
    expect(nodes.some((node) => node.id === `instance-group:${SUBNET_A}:${POOL_B}`)).toBe(false);
  });

  it("CreatedByタグとプール本体が食い違えばプール本体を採る", () => {
    const input = pooledInput(12, 7);
    const instances = (input.data.instances.ok ? input.data.instances.data : []).map((instance) => ({
      ...instance,
      "defined-tags": { "Oracle-Tags": { CreatedBy: POOL_B } },
    }));
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, instances: anyOk(instances) } });
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_A}`).count).toBe(7);
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_B}`).count).toBe(5);
  });

  it("プール本体が無いInstanceはCreatedByタグの対応へ落とす", () => {
    const input = manyInstancesInput(12);
    const instances = instanceIdsOf(input).map((id, index) => ({
      id,
      "display-name": `node-${index}`,
      "lifecycle-state": "RUNNING",
      "defined-tags": { "Oracle-Tags": { CreatedBy: index < 7 ? POOL_A : POOL_B } },
    }));
    const { nodes } = buildTopologyGraph({
      ...input,
      data: {
        ...input.data,
        instances: anyOk(instances),
        nodePools: anyOk([
          { id: POOL_A, name: "pool-a" },
          { id: POOL_B, name: "pool-b" },
        ]),
      },
    });
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_A}`).count).toBe(7);
    expect(nodeOf(nodes, `instance-group:${SUBNET_A}:${POOL_B}`).count).toBe(5);
  });
});

describe("buildTopologyGraph FSS export", () => {
  /** volumeHandleの先頭要素がExport OCIDのPVだけを持つ入力。 */
  function exportPvInput(fssExports: ClusterOciData["fssExports"]): TopologyGraphInput {
    const input = fullInput();
    return {
      ...input,
      data: { ...input.data, fssExports },
      persistentVolumes: [pv("pv-fss-export", FSS_DRIVER, `${FSS_EXPORT_1}:10.0.1.20:/export`)],
    };
  }

  it("Export OCIDはfile-system-idで解決したFileSystemノードへpv-storageエッジを引く", () => {
    const { nodes, edges } = buildTopologyGraph(
      exportPvInput({ [FSS_EXPORT_1]: anyOk({ "file-system-id": FILE_SYSTEM_1 }) }),
    );
    expect(nodeOf(nodes, FILE_SYSTEM_1).kind).toBe("filesystem");
    expect(nodeOf(nodes, FILE_SYSTEM_1).label).toBe("shared-fss");
    expect(nodeOf(nodes, "k8s-pv:pv-fss-export").consoleUrl).toBe(
      `https://cloud.oracle.com/fss/file-systems/${FILE_SYSTEM_1}?region=ap-tokyo-1`,
    );
    // mount target IP / export pathの照合材料が無いため、handle先頭OCIDからの推定として印が付く。
    expect(edges).toContainEqual({
      id: `pv-storage|k8s-pv:pv-fss-export|${FILE_SYSTEM_1}`,
      source: "k8s-pv:pv-fss-export",
      target: FILE_SYSTEM_1,
      kind: "pv-storage",
      label: "PV → Storage (inferred)",
    });
  });

  it("export取得の失敗はFileSystemノードとpv-storageエッジの欠落になる", () => {
    const { nodes, edges, missing } = buildTopologyGraph(exportPvInput({ [FSS_EXPORT_1]: FAILED }));
    expect(nodes.some((node) => node.kind === "filesystem")).toBe(false);
    expect(edges.some((edge) => edge.kind === "pv-storage")).toBe(false);
    expect(nodeOf(nodes, "k8s-pv:pv-fss-export").kind).toBe("k8s-pv");
    expect(nodeOf(nodes, "k8s-pv:pv-fss-export").consoleUrl).toBeUndefined();
    expect(missing).toEqual([
      { target: "node", kind: "filesystem", sections: ["fileSystems"] },
      { target: "edge", kind: "pv-storage", sections: ["fileSystems"] },
      { target: "edge", kind: "fss-snapshot", sections: ["fileSystems"] },
    ]);
  });
});

describe("buildTopologyGraph FSS IP:path照合", () => {
  // volumeHandle先頭は別FSS(/wp相当)を指し、IP:pathはFILE_SYSTEM_1のexportに合う(実機のTavinos系PVの形)。
  const HANDLE_FILE_SYSTEM = "ocid1.filesystem.oc1.ap_tokyo_1.fswp";
  const MOUNT_ENTRIES: ClusterOciData["fssMountEntries"] = anyOk({
    entries: [{ ipAddress: "10.0.1.20", path: "/Tavinos", exportId: FSS_EXPORT_1, fileSystemId: FILE_SYSTEM_1 }],
    mountTargetIps: ["10.0.1.20"],
  });

  function mountPvInput(volumeHandle: string): TopologyGraphInput {
    const input = fullInput();
    return {
      ...input,
      data: { ...input.data, fssMountEntries: MOUNT_ENTRIES },
      persistentVolumes: [pv("pv-tavinos", FSS_DRIVER, volumeHandle)],
    };
  }

  it("IP:pathで照合したFileSystemへ繋ぎ、handle先頭OCIDが別FSSを指すことを詳細に注記する", () => {
    const { nodes, edges } = buildTopologyGraph(mountPvInput(`${HANDLE_FILE_SYSTEM}:10.0.1.20:/Tavinos`));
    const node = nodeOf(nodes, "k8s-pv:pv-tavinos");
    expect(node.detail).toContainEqual({
      label: "Note",
      value: `volumeHandle OCID points to a different file system (${HANDLE_FILE_SYSTEM})`,
    });
    expect(node.consoleUrl).toBe(`https://cloud.oracle.com/fss/file-systems/${FILE_SYSTEM_1}?region=ap-tokyo-1`);
    expect(edges).toContainEqual({
      id: `pv-storage|k8s-pv:pv-tavinos|${FILE_SYSTEM_1}`,
      source: "k8s-pv:pv-tavinos",
      target: FILE_SYSTEM_1,
      kind: "pv-storage",
    });
    expect(nodes.some((candidate) => candidate.id === HANDLE_FILE_SYSTEM)).toBe(false);
  });

  it("handle先頭OCIDが照合先と一致すれば注記も推定の印も付けない", () => {
    const { nodes } = buildTopologyGraph(mountPvInput(`${FSS_EXPORT_1}:10.0.1.20:/Tavinos`));
    const labels = nodeOf(nodes, "k8s-pv:pv-tavinos").detail.map((detail) => detail.label);
    expect(labels).not.toContain("Note");
    expect(labels).not.toContain("FSS Match");
  });

  it("照合できなければhandle先頭OCIDで繋ぎ、推定の印を詳細とエッジに付ける", () => {
    const input = mountPvInput(`${FILE_SYSTEM_1}:10.0.1.99:/Tavinos`);
    const { nodes, edges } = buildTopologyGraph(input);
    expect(nodeOf(nodes, "k8s-pv:pv-tavinos").detail).toContainEqual({
      label: "FSS Match",
      value: "Inferred from volumeHandle OCID (not matched by mount target IP and export path)",
    });
    expect(edges).toContainEqual({
      id: `pv-storage|k8s-pv:pv-tavinos|${FILE_SYSTEM_1}`,
      source: "k8s-pv:pv-tavinos",
      target: FILE_SYSTEM_1,
      kind: "pv-storage",
      label: "PV → Storage (inferred)",
    });
  });
});

describe("buildTopologyGraph 別クラスタを指すタグ", () => {
  const CURRENT = "ocid1.cluster.oc1.ap-tokyo-1.c1";
  const OTHER = "ocid1.cluster.oc1.ap-tokyo-1.c2";
  const NODE_POOL = "ocid1.nodepool.oc1.ap-tokyo-1.np1";

  function tags(managedBy: string | undefined, createdBy: string | undefined): Record<string, unknown> {
    return {
      "system-tags": managedBy ? { "orcl-containerengine": { Cluster: managedBy } } : {},
      "defined-tags": createdBy ? { "Oracle-Tags": { CreatedBy: createdBy } } : {},
    };
  }

  /** fullInputの5種(Instance・NLB・LB・Volume・FSS)へタグを足した入力。 */
  function taggedInput(clusterId: string | undefined): TopologyGraphInput {
    const input = fullInput();
    const data = input.data;
    const first = <T>(result: OciResult<T[]>): T => (result.ok ? (result.data[0] as T) : ({} as T));
    return {
      ...input,
      clusterId,
      data: {
        ...data,
        instances: anyOk([{ ...first(data.instances), ...tags(OTHER, NODE_POOL) }]),
        nlbs: anyOk([{ ...first(data.nlbs), ...tags(CURRENT, CURRENT) }]),
        lbs: anyOk([{ ...first(data.lbs), ...tags(OTHER, OTHER) }]),
        volumes: anyOk([{ ...first(data.volumes), ...tags(OTHER, undefined) }]),
        fileSystems: {
          [FILE_SYSTEM_1]: anyOk({
            ...(data.fileSystems[FILE_SYSTEM_1]?.ok ? data.fileSystems[FILE_SYSTEM_1].data : {}),
            ...tags(CURRENT, OTHER),
          }),
        },
      },
    };
  }

  it("食い違いを出所ごとの詳細行(OCIDはコピー可)に載せ、ノードを警告にする", () => {
    const { nodes } = buildTopologyGraph(taggedInput(CURRENT));
    const managed = { label: "Managed by another cluster (system tag)", value: OTHER, role: "ocid" };
    const created = { label: "Created by another cluster (CreatedBy tag)", value: OTHER, role: "ocid" };
    expect(nodeOf(nodes, VOLUME_1).detail).toContainEqual(managed);
    expect(nodeOf(nodes, VOLUME_1).detail).not.toContainEqual(created);
    expect(nodeOf(nodes, FILE_SYSTEM_1).detail).toContainEqual(created);
    expect(nodeOf(nodes, FILE_SYSTEM_1).detail).not.toContainEqual(managed);
    expect(nodeOf(nodes, LB_1).detail).toEqual(expect.arrayContaining([managed, created]));
    for (const id of [VOLUME_1, FILE_SYSTEM_1, LB_1, INSTANCE_1]) {
      expect(nodeOf(nodes, id).status).toBe("warning");
    }
  });

  it("InstanceはCreatedBy(ノードプール)を見ず、system tagだけで判定する", () => {
    const { nodes } = buildTopologyGraph(taggedInput(CURRENT));
    const labels = nodeOf(nodes, INSTANCE_1).detail.map((row) => row.label);
    expect(labels).toContain("Managed by another cluster (system tag)");
    expect(labels).not.toContain("Created by another cluster (CreatedBy tag)");
  });

  it("両方が現クラスタを指すノードは詳細行を足さず、状態もlifecycle-stateのまま", () => {
    const { nodes } = buildTopologyGraph(taggedInput(CURRENT));
    expect(nodeOf(nodes, NLB_1).status).toBe("ok");
    expect(nodeOf(nodes, NLB_1).detail.map((row) => row.label)).toEqual([
      "Name",
      "OCID",
      "State",
      "IP Addresses",
      "Subnets",
    ]);
  });

  it("現クラスタを渡さなければ判定しない", () => {
    const { nodes } = buildTopologyGraph(taggedInput(undefined));
    expect(nodeOf(nodes, LB_1).status).toBe("ok");
    expect(nodeOf(nodes, VOLUME_1).detail.map((row) => row.label)).not.toContain(
      "Managed by another cluster (system tag)",
    );
  });

  it("FSSのタグはIP:pathで照合した実体のものを読む(handle先頭OCIDが指す側ではない)", () => {
    const input = taggedInput(CURRENT);
    const handleFileSystem = "ocid1.filesystem.oc1.ap_tokyo_1.fswp";
    const { nodes } = buildTopologyGraph({
      ...input,
      data: {
        ...input.data,
        fssMountEntries: anyOk({
          entries: [{ ipAddress: "10.0.1.20", path: "/export", exportId: FSS_EXPORT_1, fileSystemId: FILE_SYSTEM_1 }],
          mountTargetIps: ["10.0.1.20"],
        }),
        fileSystems: {
          ...input.data.fileSystems,
          [handleFileSystem]: anyOk({ "display-name": "wp", "lifecycle-state": "ACTIVE", ...tags(CURRENT, CURRENT) }),
        },
      },
      persistentVolumes: [pv("pv-fss", FSS_DRIVER, `${handleFileSystem}:10.0.1.20:/export`)],
    });
    expect(nodeOf(nodes, FILE_SYSTEM_1).detail).toContainEqual({
      label: "Created by another cluster (CreatedBy tag)",
      value: OTHER,
      role: "ocid",
    });
    expect(nodes.some((node) => node.id === handleFileSystem)).toBe(false);
  });
});

describe("buildTopologyGraph 孤立PV", () => {
  const NOT_FOUND = { ok: false as const, kind: "resource_not_found" as const, raw: { message: "gone" } };

  /** Block Volume PV 1本だけを持ち、参照先VolumeがVolume一覧にも無い入力。 */
  function orphanBlockInput(
    volumeBackupPolicies: ClusterOciData["volumeBackupPolicies"],
    resourceSearches: ClusterOciData["resourceSearches"] = {},
  ): TopologyGraphInput {
    const input = fullInput();
    return {
      ...input,
      data: {
        ...input.data,
        volumes: anyOk([]),
        volumeAttachments: anyOk([]),
        volumeBackupPolicies,
        resourceSearches,
      },
      persistentVolumes: [pv("pv-block", BLOCK_VOLUME_DRIVER, VOLUME_1)],
    };
  }

  it("Searchでも決まらないVolumeを参照するPVノードは警告色になり、不在と権限不足の両方を読める理由が載る", () => {
    const { nodes } = buildTopologyGraph(orphanBlockInput({ [VOLUME_1]: NOT_FOUND }, { [VOLUME_1]: anyOk(null) }));
    const node = nodeOf(nodes, "k8s-pv:pv-block");
    expect(node.status).toBe("warning");
    expect(node.detail).toContainEqual({
      label: "Status",
      value: "Referenced volume not found in OCI or not readable (unconfirmed)",
    });
    expect(node.consoleUrl).toBeUndefined();
  });

  it("Searchでヒットした(権限不足と確定した)Volumeと、終了状態でヒットした(不在と確定した)Volumeを書き分ける", () => {
    const forbidden = buildTopologyGraph(
      orphanBlockInput({ [VOLUME_1]: NOT_FOUND }, { [VOLUME_1]: anyOk({ "lifecycle-state": "AVAILABLE" }) }),
    );
    expect(nodeOf(forbidden.nodes, "k8s-pv:pv-block").detail).toContainEqual({
      label: "Status",
      value: "Referenced volume exists in OCI but is not readable (insufficient permission)",
    });
    const absent = buildTopologyGraph(
      orphanBlockInput({ [VOLUME_1]: NOT_FOUND }, { [VOLUME_1]: anyOk({ "lifecycle-state": "TERMINATED" }) }),
    );
    expect(nodeOf(absent.nodes, "k8s-pv:pv-block").detail).toContainEqual({
      label: "Status",
      value: "Referenced volume does not exist in OCI (orphaned PV)",
    });
    expect(nodeOf(absent.nodes, "k8s-pv:pv-block").status).toBe("warning");
  });

  it("Search自体の失敗は欠落バナーに載せず、不明の文言に倒す", () => {
    const { nodes, missing } = buildTopologyGraph(orphanBlockInput({ [VOLUME_1]: NOT_FOUND }, { [VOLUME_1]: FAILED }));
    expect(nodeOf(nodes, "k8s-pv:pv-block").detail).toContainEqual({
      label: "Status",
      value: "Referenced volume not found in OCI or not readable (unconfirmed)",
    });
    expect(missing).toEqual([]);
  });

  it("実体なしは欠落バナーの材料にならない", () => {
    expect(buildTopologyGraph(orphanBlockInput({ [VOLUME_1]: NOT_FOUND })).missing).toEqual([]);
  });

  it("同じ照会が本物の失敗なら警告色にせず従来どおり欠落として並ぶ", () => {
    const { nodes, missing } = buildTopologyGraph(orphanBlockInput({ [VOLUME_1]: FAILED }));
    expect(nodeOf(nodes, "k8s-pv:pv-block").status).toBe("unknown");
    expect(missing).toEqual([
      { target: "node", kind: "backup-policy", sections: ["volumeBackupPolicies"] },
      { target: "edge", kind: "volume-backup", sections: ["volumeBackupPolicies"] },
    ]);
  });

  /** Export OCID参照のFSS PV 1本だけを持つ入力。 */
  function orphanFssInput(data: Partial<ClusterOciData>): TopologyGraphInput {
    const input = fullInput();
    return {
      ...input,
      data: { ...input.data, ...data },
      persistentVolumes: [pv("pv-fss-export", FSS_DRIVER, `${FSS_EXPORT_1}:10.0.1.20:/export`)],
    };
  }

  it("getが失敗したexportはFileSystemの不在と区別した文言で警告色にする", () => {
    const { nodes, missing } = buildTopologyGraph(orphanFssInput({ fssExports: { [FSS_EXPORT_1]: NOT_FOUND } }));
    const node = nodeOf(nodes, "k8s-pv:pv-fss-export");
    expect(node.status).toBe("warning");
    expect(node.detail).toContainEqual({
      label: "Status",
      value: "Referenced FSS export not found or not readable (file system may still exist)",
    });
    expect(node.consoleUrl).toBeUndefined();
    expect(missing).toEqual([]);
  });

  it("exportが解決できてFileSystemが実体なしならFileSystem側の文言になる", () => {
    const { nodes, missing } = buildTopologyGraph(
      orphanFssInput({
        fssExports: { [FSS_EXPORT_1]: anyOk({ "file-system-id": FILE_SYSTEM_1 }) },
        fileSystems: { [FILE_SYSTEM_1]: NOT_FOUND },
      }),
    );
    const node = nodeOf(nodes, "k8s-pv:pv-fss-export");
    expect(node.status).toBe("warning");
    expect(node.detail).toContainEqual({
      label: "Status",
      value: "Referenced file system not found in OCI or not readable (unconfirmed)",
    });
    expect(node.consoleUrl).toBeUndefined();
    expect(missing).toEqual([]);
  });

  it("IP:pathのmount targetにexportが無いPVはexport不在と断定する", () => {
    const { nodes } = buildTopologyGraph(
      orphanFssInput({
        fssMountEntries: anyOk({ entries: [], mountTargetIps: ["10.0.1.20"] }),
        fssExports: { [FSS_EXPORT_1]: anyOk({ "file-system-id": FILE_SYSTEM_1 }) },
      }),
    );
    expect(nodeOf(nodes, "k8s-pv:pv-fss-export").detail).toContainEqual({
      label: "Status",
      value: "Referenced FSS export does not exist (file system may still exist)",
    });
  });
});

describe("buildTopologyGraph VNIC", () => {
  it("primary VNICのsubnet-idはInternalIPのCIDR照合より優先する", () => {
    const { nodes } = buildTopologyGraph(withVnic(fullInput(), { "subnet-id": SUBNET_B }));
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBe(SUBNET_B);
  });

  it("primary以外のVNICしか無ければCIDR照合へ落とす", () => {
    const { nodes } = buildTopologyGraph(withVnic(fullInput(), { "subnet-id": SUBNET_B, "is-primary": false }));
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBe(SUBNET_A);
  });

  it("VNIC本体の取得失敗はCIDR照合へ落とす", () => {
    const input = withVnic(fullInput(), { "subnet-id": SUBNET_B });
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, vnics: { [VNIC_1]: FAILED } } });
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBe(SUBNET_A);
  });

  it("VNICのsubnetが取得済みSubnetに無ければCIDR照合で代替せずUnplacedにする", () => {
    const { nodes } = buildTopologyGraph(withVnic(fullInput(), { "subnet-id": "ocid1.subnet.oc1.ap-tokyo-1.unknown" }));
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBeUndefined();
  });

  it("切り離し済みattachmentのVNICはprimaryとして採用しない", () => {
    const input = withVnic(
      fullInput(),
      { "subnet-id": SUBNET_B, "private-ip": "10.0.2.5" },
      { "lifecycle-state": "DETACHED" },
    );
    const { nodes } = buildTopologyGraph(input);
    const node = nodeOf(nodes, INSTANCE_1);
    expect(node.parentId).toBe(SUBNET_A);
    expect(detailValue(node, "Private IP")).toBeUndefined();
  });

  it("attachment一覧の失敗はCIDR照合へ落とす", () => {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, vnicAttachments: FAILED } });
    expect(nodeOf(nodes, INSTANCE_1).parentId).toBe(SUBNET_A);
  });

  it("primary VNICのIPを詳細に出す", () => {
    const { nodes } = buildTopologyGraph(
      withVnic(fullInput(), { "subnet-id": SUBNET_A, "private-ip": "10.0.1.10", "public-ip": "203.0.113.50" }),
    );
    const node = nodeOf(nodes, INSTANCE_1);
    expect(detailValue(node, "Private IP")).toBe("10.0.1.10");
    expect(detailValue(node, "Public IP")).toBe("203.0.113.50");
  });

  it("public-ipがnullならPublic IP行を出さない", () => {
    const { nodes } = buildTopologyGraph(
      withVnic(fullInput(), { "subnet-id": SUBNET_A, "private-ip": "10.0.1.10", "public-ip": null }),
    );
    expect(detailValue(nodeOf(nodes, INSTANCE_1), "Public IP")).toBeUndefined();
  });
});

describe("buildTopologyGraph ボリュームアタッチメント", () => {
  /** attachmentだけを差し替えた入力(他はfullInputのまま)。 */
  function withAttachments(attachments: Record<string, unknown>[]): TopologyGraphInput {
    const input = fullInput();
    return { ...input, data: { ...input.data, volumeAttachments: anyOk(attachments) } };
  }

  function attachment(volumeId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: `${volumeId}-attachment`,
      "instance-id": INSTANCE_1,
      "volume-id": volumeId,
      "lifecycle-state": "ATTACHED",
      ...overrides,
    };
  }

  it("PV経由で出ているVolumeノードへ合流し、ノードを増やさない", () => {
    const { nodes, edges } = buildTopologyGraph(fullInput());
    expect(nodes.filter((node) => node.kind === "volume").map((node) => node.id)).toEqual([VOLUME_1]);
    expect(edges).toContainEqual({
      id: `attachment|${INSTANCE_1}|${VOLUME_1}`,
      source: INSTANCE_1,
      target: VOLUME_1,
      kind: "attachment",
    });
  });

  it("PVから辿れないVolumeはノードを新規に作り、Subnet配下には置かない", () => {
    const input = withAttachments([attachment(VOLUME_1), attachment(VOLUME_2)]);
    const volumes = anyOk([
      { id: VOLUME_1, "display-name": "pvc-vol", "lifecycle-state": "AVAILABLE", "size-in-gbs": 50 },
      { id: VOLUME_2, "display-name": "data-vol", "lifecycle-state": "AVAILABLE", "size-in-gbs": 100 },
    ]);
    const { nodes, edges } = buildTopologyGraph({ ...input, data: { ...input.data, volumes } });
    const node = nodeOf(nodes, VOLUME_2);
    expect(node).toMatchObject({ kind: "volume", label: "data-vol", status: "ok" });
    expect(node.parentId).toBeUndefined();
    expect(detailValue(node, "Size")).toBe("100 GB");
    expect(detailValue(node, "State")).toBe("AVAILABLE");
    expect(detailValue(node, "OCID")).toBe(VOLUME_2);
    expect(edges).toContainEqual({
      id: `attachment|${INSTANCE_1}|${VOLUME_2}`,
      source: INSTANCE_1,
      target: VOLUME_2,
      kind: "attachment",
    });
  });

  it("Volume一覧に無くattachmentで生えたVolumeにもPVからエッジを引く", () => {
    const input = fullInput();
    const { nodes, edges } = buildTopologyGraph({ ...input, data: { ...input.data, volumes: anyOk([]) } });
    expect(nodeOf(nodes, VOLUME_1).label).toBe(VOLUME_1);
    expect(edges).toContainEqual({
      id: `pv-storage|k8s-pv:pv-block|${VOLUME_1}`,
      source: "k8s-pv:pv-block",
      target: VOLUME_1,
      kind: "pv-storage",
    });
  });

  it("参照先Volumeがどこにも無ければPVからのエッジは出ない", () => {
    const input = fullInput();
    const data = { ...input.data, volumes: anyOk([]), volumeAttachments: anyOk([]) };
    const { nodes, edges } = buildTopologyGraph({ ...input, data });
    expect(nodes.some((node) => node.id === VOLUME_1)).toBe(false);
    expect(edges.some((edge) => edge.kind === "pv-storage" && edge.target === VOLUME_1)).toBe(false);
  });

  it("Volume一覧に無いOCIDでもOCIDラベルのノードを作る", () => {
    const { nodes } = buildTopologyGraph(withAttachments([attachment(VOLUME_2)]));
    expect(nodeOf(nodes, VOLUME_2)).toMatchObject({ kind: "volume", label: VOLUME_2, status: "unknown" });
  });

  it("ATTACHED以外とクラスタ外Instanceのattachmentは引かない", () => {
    const other = "ocid1.instance.oc1.ap-tokyo-1.other";
    const { nodes, edges } = buildTopologyGraph(
      withAttachments([
        attachment(VOLUME_2, { "lifecycle-state": "DETACHED" }),
        attachment(VOLUME_2, { id: "att-other", "instance-id": other }),
      ]),
    );
    expect(edges.some((edge) => edge.kind === "attachment")).toBe(false);
    expect(nodes.some((node) => node.id === VOLUME_2)).toBe(false);
  });

  it("集約ノードへ畳まれたInstanceのattachmentは集約ノード発になる", () => {
    const input = fullInput();
    const ids = Array.from({ length: 11 }, (_, index) => `ocid1.instance.oc1.ap-tokyo-1.i${index + 10}`);
    const data = {
      ...input.data,
      instances: anyOk(ids.map((id, index) => ({ id, "display-name": `node-${index}` }))),
      volumeAttachments: anyOk(
        ids.map((id) => ({ id: `${id}-att`, "instance-id": id, "volume-id": VOLUME_2, "lifecycle-state": "ATTACHED" })),
      ),
    };
    const { edges } = buildTopologyGraph({
      ...input,
      data,
      nodes: ids.map((id, index) => k8sNode(`node-${index}`, id, [`10.0.1.${index + 20}`])),
    });
    expect(edges.filter((edge) => edge.kind === "attachment")).toEqual([
      {
        id: `attachment|instance-group:${SUBNET_A}|${VOLUME_2}`,
        source: `instance-group:${SUBNET_A}`,
        target: VOLUME_2,
        kind: "attachment",
      },
    ]);
  });

  it("attachment一覧の失敗はVolumeノードとattachmentエッジの欠落になる", () => {
    const input = fullInput();
    const { missing } = buildTopologyGraph({ ...input, data: { ...input.data, volumeAttachments: FAILED } });
    expect(missing).toEqual([
      { target: "node", kind: "volume", sections: ["volumeAttachments"] },
      { target: "edge", kind: "attachment", sections: ["volumeAttachments"] },
    ]);
  });
});

describe("buildTopologyGraph Volumeのバックアップポリシー", () => {
  it("割当ありは名前、照会済みで未割当はNoneを出す", () => {
    const input = fullInput();
    expect(detailValue(nodeOf(buildTopologyGraph(input).nodes, VOLUME_1), "Backup Policy")).toBe("gold");

    const data = { ...input.data, volumeBackupPolicies: { [VOLUME_1]: ok({}) } };
    const { nodes } = buildTopologyGraph({ ...input, data });
    expect(detailValue(nodeOf(nodes, VOLUME_1), "Backup Policy")).toBe("None");
  });

  it("照会自体が走っていないVolumeはNot queriedとしてNoneと書き分ける", () => {
    const input = fullInput();
    const data = {
      ...input.data,
      volumeAttachments: anyOk([
        { id: "att-2", "instance-id": INSTANCE_1, "volume-id": VOLUME_2, "lifecycle-state": "ATTACHED" },
      ]),
    };
    const { nodes } = buildTopologyGraph({ ...input, data });
    expect(detailValue(nodeOf(nodes, VOLUME_2), "Backup Policy")).toBe("Not queried");
  });

  it("照会が失敗したVolumeは行を出さない(欠落バナー側で示す)", () => {
    const input = fullInput();
    const data = { ...input.data, volumeBackupPolicies: { [VOLUME_1]: FAILED } };
    const { nodes } = buildTopologyGraph({ ...input, data });
    expect(detailValue(nodeOf(nodes, VOLUME_1), "Backup Policy")).toBeUndefined();
  });
});

describe("buildTopologyGraph Instanceのshape", () => {
  function instanceNode(instance: Record<string, unknown>): TopologyNode {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({
      ...input,
      data: { ...input.data, instances: anyOk([{ id: INSTANCE_1, "display-name": "node-1", ...instance }]) },
    });
    return nodeOf(nodes, INSTANCE_1);
  }

  it("shape-configをShape行とラベル要約に併記する", () => {
    const node = instanceNode({
      shape: "VM.Standard.E4.Flex",
      "shape-config": { ocpus: 2, "memory-in-gbs": 16 },
    });
    expect(detailValue(node, "Shape")).toBe("VM.Standard.E4.Flex 2 OCPU / 16 GB");
    expect(node.summary).toBe("VM.Standard.E4.Flex 2c/16G");
  });

  it("shape-config欠落時はshapeだけを出す", () => {
    const node = instanceNode({ shape: "VM.Standard.E4.Flex" });
    expect(detailValue(node, "Shape")).toBe("VM.Standard.E4.Flex");
    expect(node.summary).toBe("VM.Standard.E4.Flex");
  });

  it("shapeもshape-configも無ければShape行も要約も持たない", () => {
    const node = instanceNode({});
    expect(detailValue(node, "Shape")).toBeUndefined();
    expect(node.summary).toBeUndefined();
  });

  it("AD/FDを短縮してラベル要約の末尾に添える", () => {
    const node = instanceNode({
      shape: "VM.Standard.E4.Flex",
      "shape-config": { ocpus: 2, "memory-in-gbs": 16 },
      "availability-domain": "xxxx:AP-TOKYO-1-AD-1",
      "fault-domain": "FAULT-DOMAIN-2",
    });
    expect(node.summary).toBe("VM.Standard.E4.Flex 2c/16G · AD-1 / FD-2");
  });

  it("短縮できないAD/FDは原文のまま出す", () => {
    const node = instanceNode({ "availability-domain": "xxxx:AP-TOKYO-1", "fault-domain": "FD_2" });
    expect(node.summary).toBe("xxxx:AP-TOKYO-1 / FD_2");
  });

  it("片方だけのAD/FDはその1つだけを出す", () => {
    expect(instanceNode({ "fault-domain": "FAULT-DOMAIN-3" }).summary).toBe("FD-3");
    expect(instanceNode({ shape: "VM.Standard.E4.Flex", "availability-domain": "xxxx:AP-TOKYO-1-AD-2" }).summary).toBe(
      "VM.Standard.E4.Flex · AD-2",
    );
  });
});

describe("buildTopologyGraph Subnet/Volumeのラベル要約", () => {
  it("SubnetのCIDRとVolumeの容量をsublabelに出す", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    expect(nodeOf(nodes, SUBNET_A).summary).toBe("10.0.1.0/24");
    expect(nodeOf(nodes, VOLUME_1).summary).toBe("50 GB");
  });

  it("VCNのCIDRもsublabelに出す", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    expect(nodeOf(nodes, VCN).summary).toBe("10.0.0.0/16");
  });

  it("VCN本体が取れていなければsublabelを持たない", () => {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, vcns: {} } });
    expect(nodeOf(nodes, VCN).summary).toBeUndefined();
  });

  it("複数CIDRのSubnet/VCNは先頭CIDR + 残り件数に畳む", () => {
    const input = fullInput();
    const data = {
      ...input.data,
      vcns: { [VCN]: anyOk({ id: VCN, "cidr-blocks": ["10.0.0.0/16", "10.1.0.0/16"] }) },
      subnets: {
        ...input.data.subnets,
        [SUBNET_A]: anyOk({
          id: SUBNET_A,
          "vcn-id": VCN,
          "cidr-block": "10.0.1.0/24",
          "ipv6-cidr-blocks": ["2001:db8:0:4500::/64"],
        }),
      },
    };
    const { nodes } = buildTopologyGraph({ ...input, data });
    expect(nodeOf(nodes, VCN).summary).toBe("10.0.0.0/16 +1");
    expect(nodeOf(nodes, SUBNET_A).summary).toBe("10.0.1.0/24 +1");
  });

  it("容量が分からないVolumeはsublabelを持たない", () => {
    const input = fullInput();
    const { nodes } = buildTopologyGraph({ ...input, data: { ...input.data, volumes: anyOk([]) } });
    expect(nodeOf(nodes, VOLUME_1).summary).toBeUndefined();
  });
});

describe("buildTopologyGraph 欠落種別", () => {
  it("全セクション成功なら欠落なし", () => {
    expect(buildTopologyGraph(fullInput()).missing).toEqual([]);
  });

  it("セクション失敗はノード種別とエッジ種別の欠落として並ぶ", () => {
    const input = fullInput();
    const data = { ...input.data, volumes: FAILED, gateways: { [NAT]: FAILED } };
    const { missing, nodes } = buildTopologyGraph({ ...input, data });
    expect(missing).toEqual([
      { target: "node", kind: "gateway", sections: ["gateways"] },
      { target: "node", kind: "volume", sections: ["volumes"] },
      { target: "edge", kind: "pv-storage", sections: ["volumes"] },
      { target: "edge", kind: "volume-backup", sections: ["volumes"] },
      { target: "edge", kind: "route", sections: ["gateways"] },
    ]);
    expect(nodeOf(nodes, VOLUME_1)).toMatchObject({ kind: "volume", label: VOLUME_1, status: "unknown" });
  });

  it("ClusterOciDataに現れないlist失敗はfailedSectionsで補える", () => {
    const { missing } = buildTopologyGraph({ ...fullInput(), failedSections: ["subnets"] });
    expect(missing).toEqual([
      { target: "node", kind: "subnet", sections: ["subnets"] },
      { target: "edge", kind: "route", sections: ["subnets"] },
      { target: "edge", kind: "sl-allow", sections: ["subnets"] },
    ]);
  });

  it("タグ検索の失敗はLB/NLB/WAFとその繋がりの欠落として並ぶ", () => {
    const input = fullInput();
    const { missing } = buildTopologyGraph({ ...input, data: { ...input.data, taggedResources: FAILED } });
    expect(missing).toEqual([
      { target: "node", kind: "lb", sections: ["taggedResources"] },
      { target: "node", kind: "nlb", sections: ["taggedResources"] },
      { target: "node", kind: "waf", sections: ["taggedResources"] },
      { target: "edge", kind: "backend", sections: ["taggedResources"] },
      { target: "edge", kind: "waf-lb", sections: ["taggedResources"] },
      { target: "edge", kind: "service-lb", sections: ["taggedResources"] },
      { target: "edge", kind: "nsg-allow", sections: ["taggedResources"] },
    ]);
  });

  it("VNIC取得の失敗はInstanceノードでなく詳細(配置根拠)の欠落として扱う", () => {
    const input = fullInput();
    const { missing, nodes } = buildTopologyGraph({ ...input, data: { ...input.data, vnicAttachments: FAILED } });
    expect(missing).toContainEqual({ target: "detail", kind: "instance", sections: ["vnics"] });
    expect(missing).not.toContainEqual({ target: "node", kind: "instance", sections: ["vnics"] });
    expect(nodes.some((node) => node.id === INSTANCE_1)).toBe(true);
  });

  it("cluster失敗はVCNノードの欠落として扱う", () => {
    const input = fullInput();
    const { missing, nodes } = buildTopologyGraph({ ...input, data: { ...input.data, cluster: FAILED } });
    expect(missing).toContainEqual({ target: "node", kind: "vcn", sections: ["cluster"] });
    expect(nodes.some((node) => node.kind === "vcn")).toBe(false);
  });
});

describe("buildTopologyGraph 通信許可エッジ", () => {
  const SL_A = "ocid1.securitylist.oc1.ap-tokyo-1.sl1";
  const NSG_LB = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.nsglb";
  const NSG_NODE = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.nsgnode";
  const NODE_POOL = "ocid1.nodepool.oc1.ap-tokyo-1.np1";

  function tcpRule(port: number, source: string): Record<string, unknown> {
    return { protocol: "6", source, "tcp-options": { "destination-port-range": { min: port, max: port } } };
  }

  /** SUBNET_A(10.0.1.0/24)のSLがSUBNET_B(10.0.2.0/24)を、ノードNSGがLB NSGを許可する構成。 */
  function securityInput(overrides: Partial<TopologyGraphInput> = {}): TopologyGraphInput {
    const base = fullInput();
    const nlb = base.data.nlbs.ok ? base.data.nlbs.data[0] : undefined;
    return {
      ...base,
      data: {
        ...base.data,
        instances: anyOk([
          {
            id: INSTANCE_1,
            "display-name": "node-1",
            "lifecycle-state": "RUNNING",
            shape: "VM.Standard.E4.Flex",
            "defined-tags": { "Oracle-Tags": { CreatedBy: NODE_POOL } },
          },
        ]),
        nodePools: anyOk([{ id: NODE_POOL, name: "np1", "node-config-details": { "nsg-ids": [NSG_NODE] } }]),
        nlbs: anyOk([{ ...nlb, "network-security-group-ids": [NSG_LB] }]),
        securityLists: {
          [SL_A]: anyOk({
            id: SL_A,
            "vcn-id": VCN,
            "ingress-security-rules": [
              tcpRule(10250, "10.0.2.0/24"),
              {
                protocol: "6",
                source: "10.0.2.0/24",
                "tcp-options": { "destination-port-range": { min: 30000, max: 32767 } },
              },
              tcpRule(22, "10.0.0.0/16"),
              tcpRule(80, "0.0.0.0/0"),
            ],
          }),
        },
        nsgs: {
          [NSG_NODE]: anyOk({
            nsg: { id: NSG_NODE, "vcn-id": VCN },
            rules: [
              { ...tcpRule(10250, NSG_LB), direction: "INGRESS" },
              { ...tcpRule(443, NSG_NODE), direction: "INGRESS" },
              { ...tcpRule(53, NSG_LB), direction: "EGRESS" },
            ],
          }),
          [NSG_LB]: anyOk({ nsg: { id: NSG_LB, "vcn-id": VCN }, rules: [] }),
        },
      },
      ...overrides,
    };
  }

  function securityEdgesOf(graph: { edges: TopologyEdge[] }): TopologyEdge[] {
    return graph.edges.filter((edge) => edge.kind === "sl-allow" || edge.kind === "nsg-allow");
  }

  it("既定で通信許可エッジと件数を出す", () => {
    const graph = buildTopologyGraph(securityInput());
    expect(securityEdgesOf(graph).length).toBeGreaterThan(0);
    expect(graph.security).toEqual({ links: 3, edges: 2 });
  });

  it("通信許可エッジ以外のノード・エッジはSL/NSGを持たない入力と変わらない", () => {
    const base = securityInput();
    const withoutRules = buildTopologyGraph({
      ...base,
      data: { ...base.data, securityLists: {}, nsgs: {} },
    });
    const graph = buildTopologyGraph(base);
    expect(graph.nodes).toEqual(withoutRules.nodes);
    expect(graph.edges.filter((edge) => edge.kind !== "sl-allow" && edge.kind !== "nsg-allow")).toEqual(
      withoutRules.edges,
    );
    expect(graph.missing).toEqual(withoutRules.missing);
  });

  it("SLのingressはsource CIDRと重なるSubnetから許可先Subnetへ1本に畳む", () => {
    const { edges } = buildTopologyGraph(securityInput());
    const slEdges = edges.filter((edge) => edge.kind === "sl-allow");
    expect(slEdges).toEqual([
      {
        id: `sl-allow|${SUBNET_B}|${SUBNET_A}`,
        source: SUBNET_B,
        target: SUBNET_A,
        kind: "sl-allow",
        label: "tcp/10250, tcp/30000-32767",
      },
    ]);
  });

  it("NSGのingressはsourceが指すNSGを持つリソースから許可先リソースへ張る", () => {
    const { edges } = buildTopologyGraph(securityInput());
    const nsgEdges = edges.filter((edge) => edge.kind === "nsg-allow");
    expect(nsgEdges).toEqual([
      {
        id: `nsg-allow|${NLB_1}|${INSTANCE_1}`,
        source: NLB_1,
        target: INSTANCE_1,
        kind: "nsg-allow",
        label: "tcp/10250",
      },
    ]);
  });

  it("集約前のリンク数と集約後のエッジ数を返す", () => {
    const { security } = buildTopologyGraph(securityInput());
    expect(security).toEqual({ links: 3, edges: 2 });
  });

  it("集約ノードへ畳んだInstance宛ての許可は集約ノードの1本へ合流する", () => {
    const base = securityInput();
    const instances = Array.from({ length: 11 }, (_, index) => ({
      id: `ocid1.instance.oc1.ap-tokyo-1.i${index}`,
      "display-name": `node-${index}`,
      "lifecycle-state": "RUNNING",
      "defined-tags": { "Oracle-Tags": { CreatedBy: NODE_POOL } },
    }));
    const { edges } = buildTopologyGraph({
      ...base,
      data: { ...base.data, instances: anyOk(instances) },
      nodes: instances.map((instance, index) => k8sNode(`node-${index}`, instance.id, [`10.0.1.${20 + index}`])),
    });
    const nsgEdges = edges.filter((edge) => edge.kind === "nsg-allow");
    expect(nsgEdges).toEqual([
      {
        id: `nsg-allow|${NLB_1}|instance-group:${SUBNET_A}:${NODE_POOL}`,
        source: NLB_1,
        target: `instance-group:${SUBNET_A}:${NODE_POOL}`,
        kind: "nsg-allow",
        label: "tcp/10250",
      },
    ]);
  });

  it("SL/NSGの取得失敗を欠落として出す", () => {
    const base = securityInput();
    const data = { ...base.data, securityLists: { [SL_A]: FAILED }, nsgs: { [NSG_NODE]: FAILED } };
    expect(buildTopologyGraph({ ...base, data }).missing).toEqual([
      { target: "edge", kind: "sl-allow", sections: ["securityLists"] },
      { target: "edge", kind: "nsg-allow", sections: ["nsgs"] },
    ]);
  });

  it("VCNの取得失敗では通信許可エッジを出さず、欠落へvcnを載せる", () => {
    const base = securityInput();
    const graph = buildTopologyGraph({ ...base, data: { ...base.data, vcns: { [VCN]: FAILED } } });
    expect(securityEdgesOf(graph)).toEqual([]);
    expect(graph.security).toEqual({ links: 0, edges: 0 });
    expect(graph.missing).toEqual([
      { target: "edge", kind: "sl-allow", sections: ["vcn"] },
      { target: "edge", kind: "nsg-allow", sections: ["vcn"] },
    ]);
  });

  it("VCNが未取得の間も通信許可エッジを出さない", () => {
    const base = securityInput();
    expect(securityEdgesOf(buildTopologyGraph({ ...base, data: { ...base.data, vcns: {} } }))).toEqual([]);
  });
});

describe("buildTopologyGraph 決定論", () => {
  it("入力配列の順序が違っても同一の出力になる", () => {
    const input = fullInput();
    const reversed: TopologyGraphInput = {
      ...input,
      nodes: [...(input.nodes ?? [])].reverse(),
      services: [...(input.services ?? [])].reverse(),
      persistentVolumes: [...(input.persistentVolumes ?? [])].reverse(),
    };
    expect(buildTopologyGraph(reversed)).toEqual(buildTopologyGraph(input));
  });
});

describe("buildTopologyGraph 実機フィクスチャ", () => {
  const FIXTURE_VCN = "ocid1.vcn.oc1.ap-tokyo-1.aaaaexample0001";
  const FIXTURE_SUBNET = "ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0001";
  const NLB_SUBNET = "ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0003";
  const FIXTURE_RT = "ocid1.routetable.oc1.ap-tokyo-1.aaaaexample0001";
  const FIXTURE_NAT = "ocid1.natgateway.oc1.ap-tokyo-1.aaaaexample0001";
  const FIXTURE_SGW = "ocid1.servicegateway.oc1.ap-tokyo-1.aaaaexample0001";
  const FIXTURE_DRG = "ocid1.drg.oc1.ap-tokyo-1.aaaaexample0001";

  function fixtureGraph() {
    // node-subnet(10.0.10.80/28)にNLB用subnetを足してNLBのsubnet-idを解決させる。
    const nlbSubnet = anyOk({
      id: NLB_SUBNET,
      "display-name": "example-lb-subnet",
      "vcn-id": FIXTURE_VCN,
      "cidr-block": "10.0.10.96/28",
      "route-table-id": FIXTURE_RT,
    });
    const data = baseData({
      cluster: anyOk(fixture("02-ce-cluster-get.json")),
      vcns: { [FIXTURE_VCN]: anyOk(fixture("29-network-vcn-get.json")) },
      subnets: { [FIXTURE_SUBNET]: anyOk(fixture("11-network-subnet-get.json")), [NLB_SUBNET]: nlbSubnet },
      routeTables: { [FIXTURE_RT]: anyOk(fixture("13-network-route-table-get.json")) },
      gateways: {
        [FIXTURE_NAT]: gatewayView("NAT Gateway", "example-nat"),
        [FIXTURE_SGW]: gatewayView("Service Gateway", "example-sgw"),
        [FIXTURE_DRG]: gatewayView("DRG", "example-drg"),
      },
      instances: anyOk(fixture("03-compute-instance-list.json")),
      nodePools: anyOk(fixture("09-ce-node-pool-list.json")),
      taggedResources: anyOk([]),
      nlbs: anyOk(fixture<{ items: unknown[] }>("05-nlb-network-load-balancer-list.json").items),
      lbs: anyOk(fixture("06-lb-load-balancer-list.json")),
      wafs: anyOk(fixture<{ items: unknown[] }>("10-waf-web-app-firewall-list.json").items),
      volumes: anyOk(fixture("07-bv-volume-list.json")),
    });
    const instanceIds = fixture<{ id: string }[]>("03-compute-instance-list.json").map((instance) => instance.id);
    const nodeIps = ["10.0.10.83", "10.0.10.84", "10.0.10.91"];
    return buildTopologyGraph({
      data,
      nodes: instanceIds.map((id, index) => k8sNode(`node-${index}`, id, [nodeIps[index] ?? ""])),
    });
  }

  it("実応答のVCN/Subnet/Instance/NLBが包含関係で並ぶ", () => {
    const { nodes } = fixtureGraph();
    expect(nodeOf(nodes, FIXTURE_VCN)).toMatchObject({ kind: "vcn", label: "example-k8s-vcn" });
    expect(nodeOf(nodes, FIXTURE_VCN).detail).toContainEqual({
      label: "CIDR",
      value: "10.0.0.0/16\n2001:db8:0:4500::/56",
      role: "cidr",
    });
    expect(nodeOf(nodes, FIXTURE_SUBNET)).toMatchObject({ kind: "subnet", parentId: FIXTURE_VCN });
    expect(nodeOf(nodes, "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0001").parentId).toBe(FIXTURE_SUBNET);
    expect(nodeOf(nodes, "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaaexample0001").parentId).toBe(NLB_SUBNET);
  });

  it("実応答のbackend IPからLB→Instanceのエッジを引き、RTのルート先へrouteエッジを引く", () => {
    const { edges } = fixtureGraph();
    const backends = edges.filter(
      (edge) => edge.kind === "backend" && edge.source === "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaaexample0001",
    );
    expect(backends.map((edge) => edge.target)).toEqual([
      "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0001",
      "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0003",
      "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0004",
    ]);
    expect(edges.filter((edge) => edge.kind === "route").map((edge) => edge.target)).toEqual(
      expect.arrayContaining([FIXTURE_NAT, FIXTURE_SGW, FIXTURE_DRG]),
    );
  });

  it("クラスタと無関係なclassic LB(backendがノードでもServiceでもない)は図に出さない", () => {
    const { nodes } = fixtureGraph();
    expect(nodes.some((node) => node.kind === "lb")).toBe(false);
    expect(nodes.some((node) => node.kind === "waf")).toBe(false);
  });
});
