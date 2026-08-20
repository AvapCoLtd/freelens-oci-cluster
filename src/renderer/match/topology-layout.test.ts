import { describe, expect, it } from "vitest";
import type { TopologyEdge, TopologyNode, TopologyNodeKind } from "./topology-graph";
import { layoutTopology, type TopologyLayoutNode, UNPLACED_REGION_ID } from "./topology-layout";

function node(id: string, kind: TopologyNodeKind, parentId?: string): TopologyNode {
  return { id, kind, label: id, parentId, detail: [] };
}

const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vcn1";
const SUBNET_A = "ocid1.subnet.oc1.ap-tokyo-1.a";
const SUBNET_B = "ocid1.subnet.oc1.ap-tokyo-1.b";

function sampleNodes(): TopologyNode[] {
  return [
    node(VCN, "vcn"),
    node(SUBNET_A, "subnet", VCN),
    node(SUBNET_B, "subnet", VCN),
    node("ocid1.instance.oc1.ap-tokyo-1.i1", "instance", SUBNET_A),
    node("ocid1.instance.oc1.ap-tokyo-1.i2", "instance", SUBNET_A),
    node("ocid1.instance.oc1.ap-tokyo-1.i3", "instance", SUBNET_A),
    node("ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1", "nlb", SUBNET_B),
    node("ocid1.natgateway.oc1.ap-tokyo-1.nat1", "gateway", VCN),
    node("ocid1.loadbalancer.oc1.ap-tokyo-1.lb1", "lb"),
    node("ocid1.instance.oc1.ap-tokyo-1.i9", "instance"),
    node("ocid1.webappfirewall.oc1.ap-tokyo-1.waf1", "waf"),
    node("ocid1.volume.oc1.ap-tokyo-1.v1", "volume"),
    node("k8s-service:app/web", "k8s-service"),
    node("k8s-pv:pv-1", "k8s-pv"),
  ];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 兄弟の箱の間に確保するエッジの通り道(最小はUnplaced領域の行間)。 */
const MIN_CORRIDOR = 32;

/** 親相対座標を絶対座標へ展開する。 */
function absoluteRects(nodes: TopologyLayoutNode[]): Map<string, Rect> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rects = new Map<string, Rect>();
  const rectOf = (id: string): Rect => {
    const cached = rects.get(id);
    if (cached) return cached;
    const target = byId.get(id);
    if (!target) throw new Error(`layout node not found: ${id}`);
    const origin = target.parentId ? rectOf(target.parentId) : { x: 0, y: 0, width: 0, height: 0 };
    const rect = {
      x: origin.x + target.position.x,
      y: origin.y + target.position.y,
      width: target.size.width,
      height: target.size.height,
    };
    rects.set(id, rect);
    return rect;
  };
  for (const target of nodes) rectOf(target.id);
  return rects;
}

/** 左右レーンの間隔。レーンの中はこれより詰まる。 */
const LANE_GAP = 120;
/** レーンの中の行間・ノード間の上限。 */
const LANE_INNER_GAP_MAX = 56;

const WAF = "ocid1.webappfirewall.oc1.ap-tokyo-1.waf1";
const STRAY_LB = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const POLICY = "policy:bp-0";

/** PV→Volume→共有バックアップポリシーの鎖をpairs本持つグラフ。 */
function storageGraph(pairs: number): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const nodes: TopologyNode[] = [node(VCN, "vcn"), node(SUBNET_A, "subnet", VCN), node(POLICY, "backup-policy")];
  const edges: TopologyEdge[] = [];
  for (let index = 0; index < pairs; index += 1) {
    const pv = `k8s-pv:pv-${index}`;
    const volume = `volume:v-${index}`;
    nodes.push(node(pv, "k8s-pv"), node(volume, "volume"));
    edges.push({ id: `pv-storage|${index}`, source: pv, target: volume, kind: "pv-storage" });
    edges.push({ id: `volume-backup|${index}`, source: volume, target: POLICY, kind: "volume-backup" });
  }
  return { nodes, edges };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("layoutTopology", () => {
  it("入力配列の順序が違っても同一の配置になる", () => {
    const forward = layoutTopology(sampleNodes());
    const shuffled = layoutTopology([...sampleNodes()].reverse());
    const rotated = sampleNodes();
    rotated.push(...rotated.splice(0, 5));
    expect(shuffled).toEqual(forward);
    expect(layoutTopology(rotated)).toEqual(forward);
  });

  it("親は子より前に並ぶ(深さ昇順・同深さはid昇順)", () => {
    const { nodes } = layoutTopology(sampleNodes());
    const index = new Map(nodes.map((node, position) => [node.id, position]));
    for (const [position, node] of nodes.entries()) {
      if (!node.parentId) continue;
      const parent = index.get(node.parentId);
      expect(parent).toBeDefined();
      expect(parent as number).toBeLessThan(position);
    }
    const roots = nodes.filter((node) => !node.parentId).map((node) => node.id);
    expect(roots).toEqual([...roots].sort());
  });

  it("子は親の内側に完全に収まる", () => {
    const { nodes, size } = layoutTopology(sampleNodes());
    const rects = absoluteRects(nodes);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      const rect = rects.get(node.id) as Rect;
      if (!node.parentId) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(size.width);
        expect(rect.y + rect.height).toBeLessThanOrEqual(size.height);
        continue;
      }
      const parent = rects.get(byId.get(node.id)?.parentId as string) as Rect;
      expect(node.position.x).toBeGreaterThan(0);
      expect(node.position.y).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it("兄弟同士は重ならない", () => {
    const { nodes } = layoutTopology(sampleNodes());
    const rects = absoluteRects(nodes);
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const key = node.parentId ?? "";
      const siblings = groups.get(key);
      if (siblings) siblings.push(node.id);
      else groups.set(key, [node.id]);
    }
    for (const siblings of groups.values()) {
      for (const [index, left] of siblings.entries()) {
        for (const right of siblings.slice(index + 1)) {
          expect(overlaps(rects.get(left) as Rect, rects.get(right) as Rect)).toBe(false);
        }
      }
    }
  });

  it("兄弟の箱の間はエッジが通れる幅だけ空く", () => {
    const { nodes } = layoutTopology(sampleNodes());
    const rects = absoluteRects(nodes);
    const groups = new Map<string, string[]>();
    for (const node of nodes) {
      const key = node.parentId ?? "";
      const siblings = groups.get(key);
      if (siblings) siblings.push(node.id);
      else groups.set(key, [node.id]);
    }
    const gap = (aStart: number, aSize: number, bStart: number, bSize: number) =>
      Math.max(bStart - (aStart + aSize), aStart - (bStart + bSize));
    for (const siblings of groups.values()) {
      for (const [index, leftId] of siblings.entries()) {
        for (const rightId of siblings.slice(index + 1)) {
          const a = rects.get(leftId) as Rect;
          const b = rects.get(rightId) as Rect;
          expect(Math.max(gap(a.x, a.width, b.x, b.width), gap(a.y, a.height, b.y, b.height))).toBeGreaterThanOrEqual(
            MIN_CORRIDOR,
          );
        }
      }
    }
  });

  it("件数サマリの箱は種別チップと本文の2行が収まる高さを持つ", () => {
    const { nodes } = layoutTopology([
      node(VCN, "vcn"),
      node(SUBNET_A, "subnet", VCN),
      node("subnet-summary", "subnet-summary", VCN),
    ]);
    const summary = nodes.find((placed) => placed.id === "subnet-summary") as TopologyLayoutNode;
    expect(summary.size).toEqual({ width: 168, height: 52 });
  });

  it("配置根拠を持たないInstance/LBはUnplaced領域の子になる", () => {
    const { nodes } = layoutTopology(sampleNodes());
    const region = nodes.find((node) => node.id === UNPLACED_REGION_ID);
    expect(region).toMatchObject({ synthetic: true, parentId: undefined });
    const members = nodes.filter((node) => node.parentId === UNPLACED_REGION_ID).map((node) => node.id);
    expect(members).toEqual(["ocid1.instance.oc1.ap-tokyo-1.i9", "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1"]);
  });

  it("Unplacedが無ければ領域を作らない", () => {
    const nodes = sampleNodes().filter(
      (node) => node.parentId !== undefined || !["instance", "lb", "nlb", "instance-group"].includes(node.kind),
    );
    const layout = layoutTopology(nodes);
    expect(layout.nodes.some((node) => node.synthetic)).toBe(false);
  });

  it("VCN外のノードは親を持たず、グラフ由来ノード以外は作らない", () => {
    const { nodes } = layoutTopology(sampleNodes());
    expect(nodes.filter((node) => node.synthetic).map((node) => node.id)).toEqual([UNPLACED_REGION_ID]);
    expect(nodes).toHaveLength(sampleNodes().length + 1);
  });

  it("コンテナのサイズは子の配置から決まる", () => {
    const one = layoutTopology([node(VCN, "vcn"), node(SUBNET_A, "subnet", VCN)]);
    const many = layoutTopology([
      node(VCN, "vcn"),
      node(SUBNET_A, "subnet", VCN),
      node("ocid1.instance.oc1.ap-tokyo-1.i1", "instance", SUBNET_A),
      node("ocid1.instance.oc1.ap-tokyo-1.i2", "instance", SUBNET_A),
      node("ocid1.instance.oc1.ap-tokyo-1.i3", "instance", SUBNET_A),
      node("ocid1.instance.oc1.ap-tokyo-1.i4", "instance", SUBNET_A),
    ]);
    const subnetOf = (layout: { nodes: TopologyLayoutNode[] }) =>
      layout.nodes.find((node) => node.id === SUBNET_A) as TopologyLayoutNode;
    expect(subnetOf(many).size.width).toBeGreaterThan(subnetOf(one).size.width);
    expect(subnetOf(many).size.height).toBeGreaterThan(subnetOf(one).size.height);
    expect(many.size.width).toBeGreaterThanOrEqual(subnetOf(many).size.width);
  });

  it("親が存在しないparentIdは最上位として扱う", () => {
    const { nodes } = layoutTopology([node("ocid1.instance.oc1.ap-tokyo-1.i1", "instance", "ocid1.subnet.oc1.gone")]);
    expect(nodes.map((node) => node.parentId)).toEqual([undefined, UNPLACED_REGION_ID]);
  });
});

describe("layoutTopology ゲートウェイ", () => {
  function manySubnetsAndGateways(subnetCount: number, gatewayCount: number, parented = true): TopologyNode[] {
    const nodes: TopologyNode[] = [node(VCN, "vcn")];
    for (let index = 0; index < subnetCount; index += 1) {
      const subnetId = `ocid1.subnet.oc1.ap-tokyo-1.s${String(index).padStart(2, "0")}`;
      nodes.push(node(subnetId, "subnet", VCN));
      if (index % 4 === 0) nodes.push(node(`ocid1.instance.oc1.ap-tokyo-1.i${index}`, "instance", subnetId));
    }
    for (let index = 0; index < gatewayCount; index += 1) {
      nodes.push(node(`ocid1.natgateway.oc1.ap-tokyo-1.gw${index}`, "gateway", parented ? VCN : undefined));
    }
    return nodes;
  }

  function gatewayCheck(input: TopologyNode[]) {
    const { nodes } = layoutTopology(input);
    const rects = absoluteRects(nodes);
    const vcn = rects.get(VCN) as Rect;
    const gateways = nodes.filter((placed) => placed.id.includes("natgateway"));
    const subnets = nodes.filter((placed) => placed.id.includes(".subnet."));
    expect(gateways.length).toBeGreaterThan(0);
    for (const gateway of gateways) {
      expect(gateway.parentId).toBe(VCN);
      const rect = rects.get(gateway.id) as Rect;
      expect(rect.x).toBeGreaterThanOrEqual(vcn.x);
      expect(rect.y).toBeGreaterThanOrEqual(vcn.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(vcn.x + vcn.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(vcn.y + vcn.height);
      // Subnetの格子に混ざらず最下行にまとまる
      for (const subnet of subnets) {
        const subnetRect = rects.get(subnet.id) as Rect;
        expect(rect.y).toBeGreaterThanOrEqual(subnetRect.y + subnetRect.height);
      }
    }
  }

  it("多数のSubnetと多数のゲートウェイでもゲートウェイはVCN内の最下行に並ぶ", () => {
    for (const subnetCount of [3, 4, 12, 28, 30, 31]) {
      for (const gatewayCount of [1, 4, 5]) gatewayCheck(manySubnetsAndGateways(subnetCount, gatewayCount));
    }
  });

  it("親を持たないゲートウェイもVCNボックスの中へ入れる(図の外へ出さない)", () => {
    gatewayCheck(manySubnetsAndGateways(30, 4, false));
  });

  it("VCNが無ければ親を持たないゲートウェイは最上位に置く", () => {
    const { nodes } = layoutTopology([node("ocid1.natgateway.oc1.ap-tokyo-1.gw0", "gateway")]);
    expect(nodes).toEqual([
      {
        id: "ocid1.natgateway.oc1.ap-tokyo-1.gw0",
        parentId: undefined,
        position: { x: 0, y: 0 },
        size: { width: 152, height: 48 },
        synthetic: false,
      },
    ]);
  });
});

describe("layoutTopology 隣接性", () => {
  /** 配置順(上の行から、行内は左から)のid列。 */
  function placementOrder(nodes: TopologyLayoutNode[], parentId: string): string[] {
    return nodes
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((node) => node.id);
  }

  it("SubnetはLB/NLB持ち→Instance持ち→残りの順に並ぶ", () => {
    const empty = "ocid1.subnet.oc1.ap-tokyo-1.a-empty";
    const withInstance = "ocid1.subnet.oc1.ap-tokyo-1.b-instance";
    const withLb = "ocid1.subnet.oc1.ap-tokyo-1.c-lb";
    const { nodes } = layoutTopology([
      node(VCN, "vcn"),
      node(empty, "subnet", VCN),
      node(withInstance, "subnet", VCN),
      node(withLb, "subnet", VCN),
      node("ocid1.instance.oc1.ap-tokyo-1.i1", "instance", withInstance),
      node("ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1", "nlb", withLb),
    ]);
    expect(placementOrder(nodes, VCN)).toEqual([withLb, withInstance, empty]);
  });

  it("左レーンはService→WAF→VCNの順に上から降り、VCNの下には何も置かない", () => {
    const { nodes } = layoutTopology(sampleNodes());
    const rects = absoluteRects(nodes);
    const vcn = rects.get(VCN) as Rect;
    const bottomOf = (id: string) => {
      const rect = rects.get(id) as Rect;
      return rect.y + rect.height;
    };
    expect(bottomOf("k8s-service:app/web")).toBeLessThanOrEqual((rects.get(WAF) as Rect).y);
    expect(bottomOf(WAF)).toBeLessThanOrEqual(vcn.y);
    for (const placed of nodes) {
      if (placed.parentId) continue;
      const rect = rects.get(placed.id) as Rect;
      // VCNより下に出てよいのは右レーン(ストレージ / Unplaced)だけ
      if (rect.y >= vcn.y + vcn.height) expect(rect.x).toBeGreaterThanOrEqual(vcn.x + vcn.width);
    }
  });

  it("ストレージとUnplacedはVCNの右横のレーンに入り、レーン間は広く空く", () => {
    const { nodes, edges } = storageGraph(4);
    const layout = layoutTopology([...nodes, node(STRAY_LB, "lb")], edges);
    const rects = absoluteRects(layout.nodes);
    const vcn = rects.get(VCN) as Rect;
    const rightIds = ["k8s-pv:pv-0", "volume:v-0", UNPLACED_REGION_ID];
    for (const id of rightIds) {
      expect((rects.get(id) as Rect).x - (vcn.x + vcn.width)).toBeGreaterThanOrEqual(LANE_GAP);
    }
    // Unplacedは右レーンの最下段
    const unplaced = rects.get(UNPLACED_REGION_ID) as Rect;
    for (const id of ["k8s-pv:pv-0", "k8s-pv:pv-3"]) {
      expect((rects.get(id) as Rect).y).toBeLessThan(unplaced.y);
    }
  });

  it("右レーンは1成分1行の横向き鎖で、行間・ノード間は詰まる", () => {
    const { nodes, edges } = storageGraph(4);
    const layout = layoutTopology(nodes, edges);
    const rows = new Map<number, TopologyLayoutNode[]>();
    for (const placed of layout.nodes.filter((entry) => !entry.parentId && entry.id !== VCN)) {
      const row = rows.get(placed.position.y);
      if (row) row.push(placed);
      else rows.set(placed.position.y, [placed]);
    }
    expect(rows.size).toBe(4);
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.position.x - b.position.x);
      // 鎖の並びはPV → Volume → 共有ポリシー
      expect(sorted.map((entry) => entry.id.split(":")[0] ?? "")).toEqual(
        sorted.length === 3 ? ["k8s-pv", "volume", "policy"] : ["k8s-pv", "volume"],
      );
      for (const [index, entry] of sorted.slice(1).entries()) {
        const previous = sorted[index] as TopologyLayoutNode;
        expect(entry.position.x - (previous.position.x + previous.size.width)).toBeLessThanOrEqual(LANE_INNER_GAP_MAX);
      }
    }
    const tops = [...rows.keys()].sort((a, b) => a - b);
    for (const [index, top] of tops.slice(1).entries()) {
      expect(top - (tops[index] as number)).toBeLessThanOrEqual(48 + LANE_INNER_GAP_MAX);
    }
  });

  it("共有ポリシーは最初の行にだけ置く", () => {
    const { nodes, edges } = storageGraph(4);
    const layout = layoutTopology(nodes, edges);
    const policy = layout.nodes.filter((entry) => entry.id === POLICY);
    expect(policy).toHaveLength(1);
    const top = Math.min(...layout.nodes.filter((entry) => entry.id.startsWith("k8s-pv:")).map((e) => e.position.y));
    expect((policy[0] as TopologyLayoutNode).position.y).toBe(top);
  });

  it("左レーンの帯の列数はノード数に応じて広がる(固定4列にしない)", () => {
    const columnsOf = (count: number) => {
      const nodes: TopologyNode[] = [node(VCN, "vcn"), node(SUBNET_A, "subnet", VCN)];
      for (let index = 0; index < count; index += 1) nodes.push(node(`k8s-service:app/s${index}`, "k8s-service"));
      const layout = layoutTopology(nodes);
      const top = Math.min(...layout.nodes.filter((e) => e.id.startsWith("k8s-service:")).map((e) => e.position.y));
      return layout.nodes.filter((entry) => !entry.parentId && entry.position.y === top).length;
    };
    expect(columnsOf(24)).toBeGreaterThan(4);
    expect(columnsOf(24)).toBeGreaterThan(columnsOf(3));
  });
});
