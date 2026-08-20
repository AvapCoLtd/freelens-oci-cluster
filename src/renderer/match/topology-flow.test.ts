import { describe, expect, it } from "vitest";
import { EDGE_KIND_COLOR, toTopologyFlow, UNPLACED_LABEL } from "./topology-flow";
import type { TopologyEdge, TopologyGraph, TopologyNode, TopologyNodeKind } from "./topology-graph";
import { layoutTopology, UNPLACED_REGION_ID } from "./topology-layout";

const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vcn1";
const SUBNET = "ocid1.subnet.oc1.ap-tokyo-1.a";
const INSTANCE = "ocid1.instance.oc1.ap-tokyo-1.i1";
const STRAY_LB = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const NAT = "ocid1.natgateway.oc1.ap-tokyo-1.nat1";

function node(id: string, kind: TopologyNodeKind, parentId?: string, extra: Partial<TopologyNode> = {}): TopologyNode {
  return { id, kind, label: id, parentId, detail: [], ...extra };
}

function graphOf(nodes: TopologyNode[], edges: TopologyEdge[] = []): TopologyGraph {
  return { nodes, edges, missing: [] };
}

function flowOf(graph: TopologyGraph) {
  return toTopologyFlow(graph, layoutTopology(graph.nodes));
}

describe("toTopologyFlow", () => {
  it("keeps the layout order so parents come before their children", () => {
    const flow = flowOf(
      graphOf([
        node(VCN, "vcn"),
        node(SUBNET, "subnet", VCN),
        node(INSTANCE, "instance", SUBNET),
        node(NAT, "gateway", VCN),
      ]),
    );
    const index = new Map(flow.nodes.map((entry, position) => [entry.id, position]));
    expect(index.get(VCN)).toBeLessThan(index.get(SUBNET) as number);
    expect(index.get(SUBNET)).toBeLessThan(index.get(INSTANCE) as number);
    expect(index.get(VCN)).toBeLessThan(index.get(NAT) as number);
  });

  it("marks containers and shortens a multi-CIDR sublabel to one line", () => {
    const flow = flowOf(
      graphOf([
        node(VCN, "vcn", undefined, { detail: [{ label: "CIDR", value: "10.0.0.0/16", role: "cidr" }] }),
        node(SUBNET, "subnet", VCN, {
          detail: [{ label: "CIDR", value: "10.0.1.0/24\n10.0.2.0/24\n2001:db8:0:4500::/64", role: "cidr" }],
        }),
        node(INSTANCE, "instance", SUBNET),
      ]),
    );
    const byId = new Map(flow.nodes.map((entry) => [entry.id, entry]));
    expect(byId.get(VCN)?.type).toBe("container");
    expect(byId.get(VCN)?.data.sublabel).toBe("10.0.0.0/16");
    expect(byId.get(SUBNET)?.data.sublabel).toBe("10.0.1.0/24 +2");
    expect(byId.get(INSTANCE)?.type).toBe("resource");
    expect(byId.get(INSTANCE)?.data.sublabel).toBeUndefined();
  });

  it("renders the layout-only Unplaced region as a container node", () => {
    const flow = flowOf(graphOf([node(VCN, "vcn"), node(STRAY_LB, "lb")]));
    const unplaced = flow.nodes.find((entry) => entry.id === UNPLACED_REGION_ID);
    expect(unplaced?.type).toBe("container");
    expect(unplaced?.data.label).toBe(UNPLACED_LABEL);
    expect(flow.nodes.find((entry) => entry.id === STRAY_LB)?.parentId).toBe(UNPLACED_REGION_ID);
  });

  it("flags aggregate nodes as expandable", () => {
    const flow = flowOf(
      graphOf([
        node(VCN, "vcn"),
        node(SUBNET, "subnet", VCN),
        node(`instance-group:${SUBNET}`, "instance-group", SUBNET, { count: 12, memberIds: [] }),
      ]),
    );
    const group = flow.nodes.find((entry) => entry.id === `instance-group:${SUBNET}`);
    expect(group?.data.expandable).toBe(true);
    expect(flow.nodes.find((entry) => entry.id === SUBNET)?.data.expandable).toBe(false);
  });

  it("keeps edges whose both ends are placed and labels them by kind", () => {
    const graph = graphOf(
      [node(VCN, "vcn"), node(SUBNET, "subnet", VCN), node(NAT, "gateway", VCN)],
      [
        { id: `route|${SUBNET}|${NAT}`, source: SUBNET, target: NAT, kind: "route" },
        { id: "backend|missing|other", source: "missing", target: "other", kind: "backend" },
      ],
    );
    const flow = toTopologyFlow(graph, layoutTopology(graph.nodes));
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0]).toMatchObject({
      id: `route|${SUBNET}|${NAT}`,
      source: SUBNET,
      target: NAT,
      sourceSide: "bottom",
      targetSide: "top",
      sourceHandle: "s-bottom",
      targetHandle: "t-top",
      kind: "route",
      label: "Subnet → Gateway",
      color: EDGE_KIND_COLOR.route,
    });
  });

  it("エッジの経路は両端の箱の辺から始まり辺で終わる直交折れ線になる", () => {
    const graph = graphOf(
      [node(VCN, "vcn"), node(SUBNET, "subnet", VCN), node(NAT, "gateway", VCN)],
      [{ id: `route|${SUBNET}|${NAT}`, source: SUBNET, target: NAT, kind: "route" }],
    );
    const layout = layoutTopology(graph.nodes);
    const flow = toTopologyFlow(graph, layout);
    const points = (flow.edges[0] as { points: { x: number; y: number }[] }).points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (let at = 0; at + 1 < points.length; at += 1) {
      const a = points[at] as { x: number; y: number };
      const b = points[at + 1] as { x: number; y: number };
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("returns the same result for the same graph (layout is deterministic)", () => {
    const nodes = [node(VCN, "vcn"), node(SUBNET, "subnet", VCN), node(INSTANCE, "instance", SUBNET)];
    expect(flowOf(graphOf(nodes))).toEqual(flowOf(graphOf([...nodes].reverse())));
  });
});

describe("toTopologyFlow ハンドルの向き", () => {
  const NLB = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1";
  const SERVICE = "k8s-service:app/web";
  const SUBNET_B = "ocid1.subnet.oc1.ap-tokyo-1.b";

  function sidesOf(graph: TopologyGraph, edgeId: string) {
    const edge = flowOf(graph).edges.find((entry) => entry.id === edgeId);
    return { source: edge?.sourceSide, target: edge?.targetSide, handles: [edge?.sourceHandle, edge?.targetHandle] };
  }

  it("VCNの上に置かれたServiceからVCN内のNLBへは下向きに繋ぐ", () => {
    const graph = graphOf(
      [node(VCN, "vcn"), node(SUBNET, "subnet", VCN), node(NLB, "nlb", SUBNET), node(SERVICE, "k8s-service")],
      [{ id: "service-lb|s|nlb", source: SERVICE, target: NLB, kind: "service-lb" }],
    );
    expect(sidesOf(graph, "service-lb|s|nlb")).toEqual({
      source: "bottom",
      target: "top",
      handles: ["s-bottom", "t-top"],
    });
  });

  it("右レーン(Unplaced)のLBからVCN内のInstanceへは横向きに繋ぐ", () => {
    const graph = graphOf(
      [node(VCN, "vcn"), node(SUBNET, "subnet", VCN), node(INSTANCE, "instance", SUBNET), node(STRAY_LB, "lb")],
      [{ id: "backend|lb|i", source: STRAY_LB, target: INSTANCE, kind: "backend" }],
    );
    expect(sidesOf(graph, "backend|lb|i")).toEqual({
      source: "left",
      target: "right",
      handles: ["s-left", "t-right"],
    });
  });

  it("同一Subnet内で横並びのノード同士は左右で繋ぐ", () => {
    const graph = graphOf(
      [node(VCN, "vcn"), node(SUBNET, "subnet", VCN), node(INSTANCE, "instance", SUBNET), node(STRAY_LB, "lb", SUBNET)],
      [{ id: "backend|lb|i", source: STRAY_LB, target: INSTANCE, kind: "backend" }],
    );
    expect(sidesOf(graph, "backend|lb|i")).toEqual({ source: "left", target: "right", handles: ["s-left", "t-right"] });
  });

  it("同じ辺へ集まるエッジは接続点を辺上でずらす", () => {
    const graph = graphOf(
      [
        node(VCN, "vcn"),
        node(SUBNET, "subnet", VCN),
        node(SUBNET_B, "subnet", VCN),
        node(INSTANCE, "instance", SUBNET),
        node(NLB, "nlb", SUBNET_B),
        node(NAT, "gateway", VCN),
      ],
      [
        { id: `route|${SUBNET}|${NAT}`, source: SUBNET, target: NAT, kind: "route" },
        { id: `route|${SUBNET_B}|${NAT}`, source: SUBNET_B, target: NAT, kind: "route" },
      ],
    );
    const entries = flowOf(graph).edges.map((edge) => {
      const last = edge.points[edge.points.length - 1] as { x: number; y: number };
      return `${last.x},${last.y}`;
    });
    expect(entries).toHaveLength(2);
    expect(new Set(entries).size).toBe(2);
  });
});
