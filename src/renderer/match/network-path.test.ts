import { describe, expect, it } from "vitest";
import type { ClusterOciData } from "../sdk/fetch";
import type { OciResult } from "../sdk/result";
import {
  buildNetworkView,
  clusterLbIds,
  collectNsgIds,
  collectSubnetIds,
  internalIpsOfNodes,
  routeEntityKind,
} from "./network-path";

const NOT_REQUESTED = { ok: false as const, kind: "not_requested" as const, raw: { message: "not requested" } };

function ok<T>(data: T): OciResult<T> {
  return { ok: true, data };
}

const SUBNET_LB = "ocid1.subnet.oc1.ap-tokyo-1.lb";
const SUBNET_NODE = "ocid1.subnet.oc1.ap-tokyo-1.node";
const SUBNET_EP = "ocid1.subnet.oc1.ap-tokyo-1.ep";
const NSG_LB = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.lbnsg";
const NSG_POOL = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.poolnsg";
const LB_ID = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const NLB_ID = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1";
const WAF_ID = "ocid1.webappfirewall.oc1.ap-tokyo-1.waf1";

function baseData(overrides: Partial<ClusterOciData>): ClusterOciData {
  return {
    cluster: NOT_REQUESTED,
    instances: NOT_REQUESTED,
    taggedResources: NOT_REQUESTED,
    nlbs: NOT_REQUESTED,
    lbs: NOT_REQUESTED,
    volumes: NOT_REQUESTED,
    fileSystems: {},
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

// biome-ignore lint/suspicious/noExplicitAny: SDKモデルはフィールド任意のためテストデータは部分形で組む
function anyOk(data: unknown): any {
  return ok(data);
}

function richData(): ClusterOciData {
  return baseData({
    cluster: anyOk({ id: "ocid1.cluster.oc1..c", endpointConfig: { subnetId: SUBNET_EP, nsgIds: [] } }),
    nodePools: anyOk([
      {
        id: "ocid1.nodepool.oc1..p1",
        name: "pool-a",
        subnetIds: [SUBNET_NODE],
        nodeConfigDetails: { size: 3, placementConfigs: [{ subnetId: SUBNET_NODE }], nsgIds: [NSG_POOL] },
      },
    ]),
    nlbs: anyOk([
      {
        id: NLB_ID,
        displayName: "nlb-1",
        subnetId: SUBNET_LB,
        networkSecurityGroupIds: [NSG_LB],
        ipAddresses: [{ ipAddress: "10.0.0.1" }],
        listeners: { "TCP-80": { port: 80, protocol: "TCP" } },
        backendSets: { "TCP-80": {} },
      },
    ]),
    lbs: anyOk([
      {
        id: LB_ID,
        displayName: "lb-1",
        subnetIds: [SUBNET_LB],
        networkSecurityGroupIds: [],
        ipAddresses: [{ ipAddress: "10.0.0.2" }],
        listeners: {},
        backendSets: {},
      },
    ]),
    wafs: anyOk([
      { id: WAF_ID, displayName: "waf-1", loadBalancerId: LB_ID },
      {
        id: "ocid1.webappfirewall.oc1..other",
        displayName: "waf-other",
        loadBalancerId: "ocid1.loadbalancer.oc1..unrelated",
      },
    ]),
    subnets: {
      [SUBNET_LB]: anyOk({
        id: SUBNET_LB,
        displayName: "lb-subnet",
        cidrBlock: "10.0.0.0/24",
        securityListIds: ["ocid1.securitylist.oc1..sl1"],
        routeTableId: "ocid1.routetable.oc1..rt1",
      }),
    },
  });
}

describe("collectSubnetIds / collectNsgIds", () => {
  it("endpoint・プール(placement含む)・LB/NLB由来のIDを重複なしで集める", () => {
    const data = richData();
    expect(collectSubnetIds(data).sort()).toEqual([SUBNET_EP, SUBNET_LB, SUBNET_NODE].sort());
    expect(collectNsgIds(data).sort()).toEqual([NSG_LB, NSG_POOL].sort());
  });

  it("セクション未取得(失敗含む)は空として扱いthrowしない", () => {
    const data = baseData({});
    expect(collectSubnetIds(data)).toEqual([]);
    expect(collectNsgIds(data)).toEqual([]);
  });

  it("lbIds指定時はクラスタ関連LB由来のsubnet/NSGだけ集める(endpoint/プール由来は常に残す)", () => {
    const data = richData();
    const none = new Set<string>();
    expect(collectSubnetIds(data, none).sort()).toEqual([SUBNET_EP, SUBNET_NODE].sort());
    expect(collectNsgIds(data, none)).toEqual([NSG_POOL]);
  });
});

describe("clusterLbIds", () => {
  it("CreatedByタグ(経路4)とService ingress IP(経路2)の和集合で判定する", () => {
    const data = richData();
    const tagged = {
      ok: true as const,
      data: [{ identifier: NLB_ID }],
    };
    // NLBはタグで、classic LBはIP照合で拾う
    const ids = clusterLbIds({ taggedResources: tagged as never, nlbs: data.nlbs, lbs: data.lbs }, ["10.0.0.2"]);
    expect([...ids].sort()).toEqual([LB_ID, NLB_ID].sort());
  });

  it("タグなし・IP不一致のLBは含めない", () => {
    const data = richData();
    const ids = clusterLbIds(
      { taggedResources: { ok: false, kind: "not_requested", raw: { message: "" } }, nlbs: data.nlbs, lbs: data.lbs },
      [],
    );
    expect(ids.size).toBe(0);
  });

  it("バックエンドがクラスタ関連NLBのIPを指す手動LBを連鎖で拾う(2段LB構成)", () => {
    const data = richData();
    // NLB(10.0.0.1)はタグで関連。手動LB(タグなし)のbackendがNLBのIPを指す
    // biome-ignore lint/suspicious/noExplicitAny: テストデータ差し替え
    (data.lbs as any).data[0].backendSets = { "TCP-443": { backends: [{ ipAddress: "10.0.0.1" }] } };
    const ids = clusterLbIds({ taggedResources: anyOk([{ identifier: NLB_ID }]), nlbs: data.nlbs, lbs: data.lbs }, []);
    expect([...ids].sort()).toEqual([LB_ID, NLB_ID].sort());
  });

  it("バックエンドがノードIPを指す手動LBを拾う(NodePort直結構成)", () => {
    const data = richData();
    // biome-ignore lint/suspicious/noExplicitAny: テストデータ差し替え
    (data.lbs as any).data[0].backendSets = { "TCP-443": { backends: [{ ipAddress: "10.9.9.9" }] } };
    const ids = clusterLbIds(
      { taggedResources: { ok: false, kind: "not_requested", raw: { message: "" } }, nlbs: data.nlbs, lbs: data.lbs },
      [],
      ["10.9.9.9"],
    );
    expect([...ids]).toEqual([LB_ID]);
  });
});

describe("internalIpsOfNodes", () => {
  it("Internal/ExternalIPを重複なしで集める(Hostname等は除外)", () => {
    const nodes = [
      {
        status: {
          addresses: [
            { type: "InternalIP", address: "10.0.1.5" },
            { type: "Hostname", address: "node-1" },
            { type: "ExternalIP", address: "140.1.2.3" },
          ],
        },
      },
      { status: { addresses: [{ type: "InternalIP", address: "10.0.1.5" }] } },
      {},
    ];
    expect(internalIpsOfNodes(nodes).sort()).toEqual(["10.0.1.5", "140.1.2.3"].sort());
  });
});

describe("buildNetworkView", () => {
  it("WAFはクラスタ関連LBに紐付くもののみ、LB名を解決して返す", () => {
    const view = buildNetworkView(richData());
    expect(view.wafRows).toEqual([
      { id: WAF_ID, displayName: "waf-1", lifecycleState: undefined, targetLbId: LB_ID, targetLbName: "lb-1" },
    ]);
  });

  it("LB/NLB行にlistener・backend set・NSGを含める", () => {
    const view = buildNetworkView(richData());
    const nlbRow = view.lbRows.find((row) => row.id === NLB_ID);
    expect(nlbRow).toMatchObject({
      kind: "nlb",
      ips: ["10.0.0.1"],
      subnetIds: [SUBNET_LB],
      nsgIds: [NSG_LB],
      listeners: [{ name: "TCP-80", port: 80, protocol: "TCP" }],
      backendSetNames: ["TCP-80"],
    });
  });

  it("サブネットを役割(lb/node/endpoint)で振り分け、詳細未取得はOCIDのみの行に落とす", () => {
    const view = buildNetworkView(richData());
    expect(view.lbSubnetRows).toHaveLength(1);
    expect(view.lbSubnetRows[0]).toMatchObject({
      subnetId: SUBNET_LB,
      roles: ["lb"],
      displayName: "lb-subnet",
      securityListIds: ["ocid1.securitylist.oc1..sl1"],
      routeTableId: "ocid1.routetable.oc1..rt1",
    });
    // SUBNET_NODEはsubnets Record未取得 → OCIDのみ
    expect(view.nodeSubnetRows[0]).toMatchObject({ subnetId: SUBNET_NODE, roles: ["node"], securityListIds: [] });
    expect(view.endpointSubnetRow).toMatchObject({ subnetId: SUBNET_EP, roles: ["endpoint"] });
    expect(view.nodeNsgIds).toEqual([NSG_POOL]);
  });

  it("endpointサブネットがノードサブネットと同一ならendpoint行を複製しない", () => {
    const data = richData();
    // biome-ignore lint/suspicious/noExplicitAny: テストデータ差し替え
    (data.cluster as any).data.endpointConfig.subnetId = SUBNET_NODE;
    const view = buildNetworkView(data);
    expect(view.endpointSubnetRow).toBeUndefined();
    expect(view.nodeSubnetRows[0]?.roles).toEqual(["node", "endpoint"]);
  });
});

describe("routeEntityKind", () => {
  it("OCIDプレフィックスから種別を表示名にする", () => {
    expect(routeEntityKind("ocid1.natgateway.oc1..x")).toBe("NAT Gateway");
    expect(routeEntityKind("ocid1.drg.oc1..x")).toBe("DRG");
    expect(routeEntityKind("ocid1.localpeeringgateway.oc1..x")).toBe("Local Peering Gateway");
    expect(routeEntityKind(undefined)).toBe("-");
    expect(routeEntityKind("ocid1.unknownthing.oc1..x")).toBe("unknownthing");
  });
});
