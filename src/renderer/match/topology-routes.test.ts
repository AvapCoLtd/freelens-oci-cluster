import { describe, expect, it } from "vitest";
import { type TopologyFlow, toTopologyFlow } from "./topology-flow";
import type { TopologyEdge, TopologyGraph, TopologyNode, TopologyNodeKind } from "./topology-graph";
import { layoutTopology, type TopologyPoint } from "./topology-layout";
import { type RouteEdge, type RouteNode, routeTopologyEdges } from "./topology-routes";

const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vcn1";
const SUBNET_LB = "ocid1.subnet.oc1.ap-tokyo-1.a-lb";
const SUBNET_NODE = "ocid1.subnet.oc1.ap-tokyo-1.b-node";
const NLB1 = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1";
const NLB2 = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb2";
const NAT = "ocid1.natgateway.oc1.ap-tokyo-1.nat1";
const IGW = "ocid1.internetgateway.oc1.ap-tokyo-1.igw1";
const BACKUP = "ocid1.volumebackuppolicy.oc1.ap-tokyo-1.bp1";

function node(id: string, kind: TopologyNodeKind, parentId?: string): TopologyNode {
  return { id, kind, label: id, parentId, detail: [] };
}

function instance(index: number): string {
  return `ocid1.instance.oc1.ap-tokyo-1.i${index}`;
}

function storage(nodes: TopologyNode[], edges: TopologyEdge[], pairs: number): void {
  nodes.push(node(BACKUP, "backup-policy"));
  for (let index = 0; index < pairs; index += 1) {
    const key = String(index).padStart(2, "0");
    const volume = `ocid1.volume.oc1.ap-tokyo-1.v${key}`;
    nodes.push(node(`k8s-pv:pv-${key}`, "k8s-pv"), node(volume, "volume"));
    edges.push({ id: `pv-storage|${key}`, source: `k8s-pv:pv-${key}`, target: volume, kind: "pv-storage" });
    edges.push({ id: `volume-backup|${key}`, source: volume, target: BACKUP, kind: "volume-backup" });
  }
}

/**
 * 実機で問題になった形を含むフィクスチャ。
 * VCN上のServiceがSubnet内2行目のNLBへ降り、NLBから複数のインスタンスへ並走し、
 * VCN外の帯にはPV/Volume/ポリシーが数十個並ぶ。
 */
function sampleGraph(pairs: number): TopologyGraph {
  const nodes: TopologyNode[] = [
    node(VCN, "vcn"),
    node(SUBNET_LB, "subnet", VCN),
    node(SUBNET_NODE, "subnet", VCN),
    node(NLB1, "nlb", SUBNET_LB),
    node(NLB2, "nlb", SUBNET_LB),
    node(instance(1), "instance", SUBNET_LB),
    node(instance(2), "instance", SUBNET_LB),
    node(NAT, "gateway", VCN),
    node(IGW, "gateway", VCN),
    node("k8s-service:app/web", "k8s-service"),
    node("k8s-service:app/api", "k8s-service"),
  ];
  for (let index = 3; index <= 6; index += 1) nodes.push(node(instance(index), "instance", SUBNET_NODE));

  const edges: TopologyEdge[] = [
    { id: "service-lb|web|nlb1", source: "k8s-service:app/web", target: NLB1, kind: "service-lb" },
    { id: "service-lb|api|nlb2", source: "k8s-service:app/api", target: NLB2, kind: "service-lb" },
    { id: `route|${SUBNET_LB}|${NAT}`, source: SUBNET_LB, target: NAT, kind: "route" },
    { id: `route|${SUBNET_NODE}|${NAT}`, source: SUBNET_NODE, target: NAT, kind: "route" },
    { id: `route|${SUBNET_LB}|${IGW}`, source: SUBNET_LB, target: IGW, kind: "route" },
  ];
  for (let index = 1; index <= 4; index += 1) {
    edges.push({ id: `backend|nlb1|${index}`, source: NLB1, target: instance(index), kind: "backend" });
  }
  for (let index = 5; index <= 6; index += 1) {
    edges.push({ id: `backend|nlb2|${index}`, source: NLB2, target: instance(index), kind: "backend" });
  }
  storage(nodes, edges, pairs);
  return { nodes, edges, missing: [] };
}

function flowOf(graph: TopologyGraph): TopologyFlow {
  return toTopologyFlow(graph, layoutTopology(graph.nodes, graph.edges));
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function absoluteRects(flow: TopologyFlow): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const placed of flow.nodes) {
    const origin = placed.parentId ? (rects.get(placed.parentId) as Rect) : { x: 0, y: 0, width: 0, height: 0 };
    rects.set(placed.id, {
      x: origin.x + placed.position.x,
      y: origin.y + placed.position.y,
      width: placed.width,
      height: placed.height,
    });
  }
  return rects;
}

/** 自分と相手の祖先。エッジはここを跨いで出入りするため障害物から外れる。 */
function selfAndAncestors(flow: TopologyFlow, id: string): Set<string> {
  const parentOf = new Map(flow.nodes.map((placed) => [placed.id, placed.parentId]));
  const out = new Set<string>([id]);
  let current = parentOf.get(id);
  while (current && !out.has(current)) {
    out.add(current);
    current = parentOf.get(current);
  }
  return out;
}

/** 経路が矩形を貫いた組。空であることが制約。 */
function crossings(flow: TopologyFlow): string[] {
  const rects = absoluteRects(flow);
  const out: string[] = [];
  for (const edge of flow.edges) {
    const skip = new Set([...selfAndAncestors(flow, edge.source), ...selfAndAncestors(flow, edge.target)]);
    for (let at = 0; at + 1 < edge.points.length; at += 1) {
      const a = edge.points[at] as { x: number; y: number };
      const b = edge.points[at + 1] as { x: number; y: number };
      for (const [id, rect] of rects) {
        if (skip.has(id)) continue;
        const overlapX = Math.min(Math.max(a.x, b.x), rect.x + rect.width) - Math.max(Math.min(a.x, b.x), rect.x);
        const overlapY = Math.min(Math.max(a.y, b.y), rect.y + rect.height) - Math.max(Math.min(a.y, b.y), rect.y);
        if (overlapX > 0 && overlapY > 0) out.push(`${edge.id} x ${id}`);
      }
    }
  }
  return out;
}

/** 同じ線分を共有したエッジの組。空であることが制約(ホバーせずに1本ずつ追えるための条件)。 */
function sharedSegments(flow: TopologyFlow): string[] {
  const segments: { edgeId: string; vertical: boolean; fixed: number; low: number; high: number }[] = [];
  for (const edge of flow.edges) {
    for (let at = 0; at + 1 < edge.points.length; at += 1) {
      const a = edge.points[at] as { x: number; y: number };
      const b = edge.points[at + 1] as { x: number; y: number };
      const vertical = a.x === b.x;
      const from = vertical ? a.y : a.x;
      const to = vertical ? b.y : b.x;
      segments.push({
        edgeId: edge.id,
        vertical,
        fixed: vertical ? a.x : a.y,
        low: Math.min(from, to),
        high: Math.max(from, to),
      });
    }
  }
  const out: string[] = [];
  for (const [index, left] of segments.entries()) {
    for (const right of segments.slice(index + 1)) {
      if (left.edgeId === right.edgeId || left.vertical !== right.vertical || left.fixed !== right.fixed) continue;
      if (Math.min(left.high, right.high) - Math.max(left.low, right.low) > 0) {
        out.push(`${left.edgeId} = ${right.edgeId}`);
      }
    }
  }
  return out;
}

describe("トポロジのエッジ経路", () => {
  it("経路はどのノード矩形も貫かない(自分と相手の祖先を除く)", () => {
    for (const pairs of [3, 12]) {
      const flow = flowOf(sampleGraph(pairs));
      expect(flow.edges.length).toBeGreaterThan(10);
      for (const edge of flow.edges) expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(crossings(flow)).toEqual([]);
    }
  });

  it("エッジ同士は同じ線分を共有しない(通路の中でレーンが分かれる)", () => {
    for (const pairs of [3, 12]) expect(sharedSegments(flowOf(sampleGraph(pairs)))).toEqual([]);
  });

  it("経路は直交の折れ線になる", () => {
    for (const edge of flowOf(sampleGraph(3)).edges) {
      for (let at = 0; at + 1 < edge.points.length; at += 1) {
        const a = edge.points[at] as { x: number; y: number };
        const b = edge.points[at + 1] as { x: number; y: number };
        expect({ id: edge.id, orthogonal: a.x === b.x || a.y === b.y }).toEqual({ id: edge.id, orthogonal: true });
      }
    }
  });

  it("入力の順序を入れ替えても同じ経路になる", () => {
    const graph = sampleGraph(3);
    const shuffled: TopologyGraph = {
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
      missing: [],
    };
    const routesOf = (flow: TopologyFlow) =>
      Object.fromEntries([...flow.edges].sort((a, b) => (a.id < b.id ? -1 : 1)).map((edge) => [edge.id, edge.points]));
    expect(flowOf(shuffled).nodes).toEqual(flowOf(graph).nodes);
    expect(routesOf(flowOf(shuffled))).toEqual(routesOf(flowOf(graph)));
  });

  it("VCN上のServiceからSubnet内2行目のNLBへは、同じ列の1行目の箱を避けて回り込む", () => {
    const flow = flowOf(sampleGraph(3));
    const rects = absoluteRects(flow);
    const nlb = rects.get(NLB1) as Rect;
    const firstRow = flow.nodes
      .filter((placed) => placed.parentId === SUBNET_LB)
      .map((placed) => rects.get(placed.id) as Rect)
      .filter((rect) => rect.y + rect.height <= nlb.y);
    // 直進すればこの行の箱を貫く位置関係であること
    expect(firstRow.length).toBeGreaterThan(0);
    const edge = flow.edges.find((entry) => entry.id === "service-lb|web|nlb1") as TopologyFlow["edges"][number];
    expect(edge.points.length).toBeGreaterThan(2);
  });

  it("格子セル数が上限を超える大規模入力ではA*を諦めスタブ直結の折れ線へ落とす", () => {
    // 対角線上に離散配置し、隣接ノード間の間隔を広く取ってレーンが最大本数刻まれるようにする。
    // これにより軸ごとの格子線数がノード数に対して線形以上に増え、少ないノード数でも上限を超えられる。
    const routeNodes: RouteNode[] = [];
    const count = 80;
    for (let index = 0; index < count; index += 1) {
      routeNodes.push({
        id: `n${index}`,
        rect: { x: index * 200, y: index * 200, width: 20, height: 20 },
      });
    }
    const edges: RouteEdge[] = [
      { id: "e0", source: "n0", target: `n${count - 1}`, sourceSide: "right", targetSide: "left" },
    ];
    const routes = routeTopologyEdges(routeNodes, edges);
    const points = routes.get("e0") as TopologyPoint[];
    expect(points.length).toBeLessThanOrEqual(4);
  });
});
