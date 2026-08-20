import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClusterOciData } from "../fetch/fetch";
import type { OciResult } from "../oci/result";
import type { OciGatewayStatusView } from "./gateway-status";
import {
  buildTopologyGraph,
  ipInCidr,
  SUBNET_SUMMARY_ID,
  type TopologyEdgeKind,
  type TopologyGraphInput,
  type TopologyK8sNode,
  type TopologyK8sPv,
  type TopologyK8sService,
  type TopologyNode,
} from "./topology-graph";

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
    taggedResources: NOT_REQUESTED,
    nlbs: NOT_REQUESTED,
    lbs: NOT_REQUESTED,
    volumes: NOT_REQUESTED,
    fileSystems: {},
    fssExports: {},
    vcns: {},
    nodePools: NOT_REQUESTED,
    wafs: NOT_REQUESTED,
    subnets: {},
    securityLists: {},
    routeTables: {},
    nsgs: {},
    wafPolicies: {},
    gateways: {},
    dnsChecks: {},
    managedCerts: {},
    volumeBackupPolicies: {},
    fssSnapshotPolicies: {},
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
const NLB_1 = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1";
const LB_1 = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const WAF_1 = "ocid1.webappfirewall.oc1.ap-tokyo-1.waf1";
const WAF_POLICY = "ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.wafp1";
const VOLUME_1 = "ocid1.volume.oc1.ap-tokyo-1.v1";
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

function service(namespace: string, name: string, ingressIp: string): TopologyK8sService {
  return {
    metadata: { name, namespace },
    spec: { type: "LoadBalancer", externalTrafficPolicy: "Cluster" },
    status: { loadBalancer: { ingress: [{ ip: ingressIp }] } },
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

function edgeKinds(edges: { kind: TopologyEdgeKind }[]): Set<TopologyEdgeKind> {
  return new Set(edges.map((edge) => edge.kind));
}

describe("ipInCidr", () => {
  it("IPv4の包含を判定する", () => {
    expect(ipInCidr("10.0.1.10", "10.0.1.0/24")).toBe(true);
    expect(ipInCidr("10.0.2.10", "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.1.10", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("10.0.10.91", "10.0.10.80/28")).toBe(true);
    expect(ipInCidr("10.0.10.96", "10.0.10.80/28")).toBe(false);
  });

  it("IPv6の包含を判定する(圧縮表記・埋め込みIPv4を含む)", () => {
    expect(ipInCidr("2001:db8:0:4500::5", "2001:db8:0:4500::/56")).toBe(true);
    expect(ipInCidr("2001:db8:0:4600::5", "2001:db8:0:4500::/56")).toBe(false);
    expect(ipInCidr("::ffff:10.0.1.10", "::ffff:10.0.1.0/120")).toBe(true);
  });

  it("アドレスファミリ不一致・不正表記は例外にせずfalseを返す", () => {
    expect(ipInCidr("10.0.1.10", "2001:db8::/32")).toBe(false);
    expect(ipInCidr("2001:db8::1", "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.1.999", "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.1.10", "10.0.1.0/33")).toBe(false);
    expect(ipInCidr("10.0.1.10", "10.0.1.0")).toBe(false);
    expect(ipInCidr("10.0.1.10", "not-a-cidr")).toBe(false);
    expect(ipInCidr(undefined, "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("1::2::3", "1::/16")).toBe(false);
  });
});

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

  it("詳細は共通3項目+種別固有3項目までに収める", () => {
    const { nodes } = buildTopologyGraph(fullInput());
    for (const node of nodes) {
      expect(node.detail.length).toBeLessThanOrEqual(6);
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
      new Set(["backend", "waf-lb", "service-lb", "pv-storage", "volume-backup", "fss-snapshot", "route"]),
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

  it("展開中のSubnetは個々のInstanceとメンバー宛てエッジに戻す", () => {
    const { nodes, edges } = buildTopologyGraph(manyInstancesInput(11, new Set([SUBNET_A])));
    expect(nodes.filter((node) => node.kind === "instance")).toHaveLength(11);
    expect(nodes.some((node) => node.kind === "instance-group")).toBe(false);
    expect(edges.filter((edge) => edge.kind === "backend" && edge.source === NLB_1)).toHaveLength(3);
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
    expect(edges).toContainEqual({
      id: `pv-storage|k8s-pv:pv-fss-export|${FILE_SYSTEM_1}`,
      source: "k8s-pv:pv-fss-export",
      target: FILE_SYSTEM_1,
      kind: "pv-storage",
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

describe("buildTopologyGraph 孤立PV", () => {
  const NOT_FOUND = { ok: false as const, kind: "resource_not_found" as const, raw: { message: "gone" } };

  /** Block Volume PV 1本だけを持ち、参照先VolumeがVolume一覧にも無い入力。 */
  function orphanBlockInput(volumeBackupPolicies: ClusterOciData["volumeBackupPolicies"]): TopologyGraphInput {
    const input = fullInput();
    return {
      ...input,
      data: { ...input.data, volumes: anyOk([]), volumeBackupPolicies },
      persistentVolumes: [pv("pv-block", BLOCK_VOLUME_DRIVER, VOLUME_1)],
    };
  }

  it("実体なしと確定したVolumeを参照するPVノードは警告色になり詳細に理由が載る", () => {
    const { nodes } = buildTopologyGraph(orphanBlockInput({ [VOLUME_1]: NOT_FOUND }));
    const node = nodeOf(nodes, "k8s-pv:pv-block");
    expect(node.status).toBe("warning");
    expect(node.detail).toContainEqual({
      label: "Status",
      value: "Referenced volume not found in OCI or not accessible (orphaned PV)",
    });
    expect(node.consoleUrl).toBeUndefined();
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

  it("実体なしのexportはFileSystemの不在と区別した文言で警告色にする", () => {
    const { nodes, missing } = buildTopologyGraph(orphanFssInput({ fssExports: { [FSS_EXPORT_1]: NOT_FOUND } }));
    const node = nodeOf(nodes, "k8s-pv:pv-fss-export");
    expect(node.status).toBe("warning");
    expect(node.detail).toContainEqual({
      label: "Status",
      value: "Referenced FSS export not found or not accessible (file system may still exist)",
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
      value: "Referenced file system not found in OCI or not accessible (orphaned PV)",
    });
    expect(node.consoleUrl).toBeUndefined();
    expect(missing).toEqual([]);
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
    expect(nodes.some((node) => node.kind === "volume")).toBe(false);
  });

  it("ClusterOciDataに現れないlist失敗はfailedSectionsで補える", () => {
    const { missing } = buildTopologyGraph({ ...fullInput(), failedSections: ["subnets"] });
    expect(missing).toEqual([
      { target: "node", kind: "subnet", sections: ["subnets"] },
      { target: "edge", kind: "route", sections: ["subnets"] },
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
    ]);
  });

  it("cluster失敗はVCNノードの欠落として扱う", () => {
    const input = fullInput();
    const { missing, nodes } = buildTopologyGraph({ ...input, data: { ...input.data, cluster: FAILED } });
    expect(missing).toContainEqual({ target: "node", kind: "vcn", sections: ["cluster"] });
    expect(nodes.some((node) => node.kind === "vcn")).toBe(false);
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
