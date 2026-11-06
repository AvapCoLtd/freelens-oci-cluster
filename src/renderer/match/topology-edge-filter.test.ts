import { describe, expect, it } from "vitest";
import { edgeKindCountsOf, hideTopologyEdgeKinds, topologyLegendRowsOf } from "./topology-edge-filter";
import { toTopologyFlow } from "./topology-flow";
import type { TopologyEdge, TopologyGraph, TopologyNode } from "./topology-graph";
import { layoutTopology } from "./topology-layout";
import { toMermaid } from "./topology-mermaid";
import { toSvg } from "./topology-svg";

const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vcn1";
const SUBNET = "ocid1.subnet.oc1.ap-tokyo-1.a";
const SUBNET_B = "ocid1.subnet.oc1.ap-tokyo-1.b";
const INSTANCE = "ocid1.instance.oc1.ap-tokyo-1.i1";
const LB = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const NAT = "ocid1.natgateway.oc1.ap-tokyo-1.nat1";

function node(id: string, kind: TopologyNode["kind"], parentId?: string): TopologyNode {
  return { id, kind, label: id, detail: [], ...(parentId === undefined ? {} : { parentId }) };
}

function graphOf(edges: readonly TopologyEdge[], missing: TopologyGraph["missing"] = []): TopologyGraph {
  return {
    nodes: [
      node(VCN, "vcn"),
      node(SUBNET, "subnet", VCN),
      node(SUBNET_B, "subnet", VCN),
      node(INSTANCE, "instance", SUBNET),
      node(LB, "lb", SUBNET),
      node(NAT, "gateway", VCN),
    ],
    edges: [...edges],
    missing: [...missing],
  };
}

const BACKEND: TopologyEdge = { id: "e-backend", source: LB, target: INSTANCE, kind: "backend" };
const BACKEND_HEALTHY: TopologyEdge = {
  id: "e-backend-ok",
  source: LB,
  target: INSTANCE,
  kind: "backend",
  health: "ok",
};
const BACKEND_CRITICAL: TopologyEdge = {
  id: "e-backend-critical",
  source: LB,
  target: INSTANCE,
  kind: "backend",
  health: "critical",
};
const BACKEND_NO_LOCAL_POD: TopologyEdge = {
  id: "e-backend-no-local-pod",
  source: LB,
  target: INSTANCE,
  kind: "backend",
  health: "no-local-pod",
};
const ROUTE: TopologyEdge = { id: "e-route", source: SUBNET, target: NAT, kind: "route" };
const SL_ALLOW: TopologyEdge = { id: "e-sl", source: SUBNET_B, target: SUBNET, kind: "sl-allow", label: "tcp/443" };

function svgOf(graph: TopologyGraph): string {
  return toSvg(toTopologyFlow(graph, layoutTopology(graph.nodes, graph.edges)));
}

describe("edgeKindCountsOf", () => {
  it("counts only the kinds present, in TOPOLOGY_EDGE_KINDS order", () => {
    const graph = graphOf([ROUTE, SL_ALLOW, BACKEND, BACKEND_HEALTHY]);
    expect(edgeKindCountsOf(graph)).toEqual([
      { kind: "backend", count: 2 },
      { kind: "route", count: 1 },
      { kind: "sl-allow", count: 1 },
    ]);
  });

  it("counts the pre-filter graph so a hidden kind keeps its number", () => {
    const graph = graphOf([BACKEND, ROUTE]);
    const visible = hideTopologyEdgeKinds(graph, new Set(["route"]));
    expect(edgeKindCountsOf(graph)).toEqual([
      { kind: "backend", count: 1 },
      { kind: "route", count: 1 },
    ]);
    expect(edgeKindCountsOf(visible)).toEqual([{ kind: "backend", count: 1 }]);
  });

  it("returns nothing for a graph without edges", () => {
    expect(edgeKindCountsOf(graphOf([]))).toEqual([]);
  });
});

describe("topologyLegendRowsOf", () => {
  const noneHidden = new Set<TopologyEdge["kind"]>();

  it("counts every kind present in the graph, security kinds included", () => {
    expect(topologyLegendRowsOf(graphOf([BACKEND, ROUTE, SL_ALLOW]), noneHidden)).toEqual([
      { type: "kind", kind: "backend", count: 1, shown: true },
      { type: "kind", kind: "route", count: 1, shown: true },
      { type: "kind", kind: "sl-allow", count: 1, shown: true },
    ]);
  });

  it("keeps a hidden security row with its pre-filter count so it can be turned back on", () => {
    expect(topologyLegendRowsOf(graphOf([ROUTE, SL_ALLOW]), new Set(["sl-allow"]))).toEqual([
      { type: "kind", kind: "route", count: 1, shown: true },
      { type: "kind", kind: "sl-allow", count: 1, shown: false },
    ]);
  });

  it("puts the health rows right after the backend row in severity order", () => {
    expect(topologyLegendRowsOf(graphOf([BACKEND_CRITICAL, BACKEND_HEALTHY, BACKEND, ROUTE]), noneHidden)).toEqual([
      { type: "kind", kind: "backend", count: 3, shown: true },
      { type: "health", health: "ok", count: 1, shown: true },
      { type: "health", health: "critical", count: 1, shown: true },
      { type: "kind", kind: "route", count: 1, shown: true },
    ]);
  });

  it("places the no-local-pod row between ok and the OCI-reported states", () => {
    const graph = graphOf([BACKEND_CRITICAL, BACKEND_NO_LOCAL_POD, BACKEND_HEALTHY]);
    expect(topologyLegendRowsOf(graph, noneHidden)).toEqual([
      { type: "kind", kind: "backend", count: 3, shown: true },
      { type: "health", health: "ok", count: 1, shown: true },
      { type: "health", health: "no-local-pod", count: 1, shown: true },
      { type: "health", health: "critical", count: 1, shown: true },
    ]);
  });

  it("toggles the no-local-pod row like any other health row", () => {
    const graph = graphOf([BACKEND_NO_LOCAL_POD, BACKEND_CRITICAL]);
    expect(topologyLegendRowsOf(graph, noneHidden, new Set(["no-local-pod"]))).toEqual([
      { type: "kind", kind: "backend", count: 2, shown: true },
      { type: "health", health: "no-local-pod", count: 1, shown: false },
      { type: "health", health: "critical", count: 1, shown: true },
    ]);
  });

  it("marks a hidden health row as not shown while keeping its pre-filter count", () => {
    const graph = graphOf([BACKEND_CRITICAL, BACKEND_HEALTHY]);
    expect(topologyLegendRowsOf(graph, noneHidden, new Set(["critical"]))).toEqual([
      { type: "kind", kind: "backend", count: 2, shown: true },
      { type: "health", health: "ok", count: 1, shown: true },
      { type: "health", health: "critical", count: 1, shown: false },
    ]);
  });

  it("omits the health rows when no backend edge carries health", () => {
    expect(topologyLegendRowsOf(graphOf([BACKEND]), noneHidden)).toEqual([
      { type: "kind", kind: "backend", count: 1, shown: true },
    ]);
  });

  it("drops the health rows while the backend row is off", () => {
    expect(topologyLegendRowsOf(graphOf([BACKEND_HEALTHY]), new Set(["backend"]))).toEqual([
      { type: "kind", kind: "backend", count: 1, shown: false },
    ]);
  });

  it("skips the kinds absent from the graph, security kinds included", () => {
    expect(topologyLegendRowsOf(graphOf([]), noneHidden)).toEqual([]);
  });
});

describe("hideTopologyEdgeKinds", () => {
  it("returns the same graph when nothing is hidden", () => {
    const graph = graphOf([BACKEND, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set())).toBe(graph);
  });

  it("returns the same graph when the hidden kinds are absent", () => {
    const graph = graphOf([BACKEND]);
    expect(hideTopologyEdgeKinds(graph, new Set(["nsg-allow", "attachment"]))).toBe(graph);
  });

  it("drops the hidden kinds and keeps the rest", () => {
    const graph = graphOf([BACKEND, ROUTE, SL_ALLOW]);
    const visible = hideTopologyEdgeKinds(graph, new Set(["route", "sl-allow"]));
    expect(visible.edges).toEqual([BACKEND]);
    expect(visible.nodes).toBe(graph.nodes);
    expect(graph.edges).toHaveLength(3);
  });

  it("drops health-colored edges with their kind", () => {
    const graph = graphOf([BACKEND_HEALTHY, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set(["backend"])).edges).toEqual([ROUTE]);
  });

  it("returns the same graph when nothing is hidden by kind or health", () => {
    const graph = graphOf([BACKEND_HEALTHY, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set(), new Set())).toBe(graph);
  });

  it("returns the same graph when the hidden health is absent", () => {
    const graph = graphOf([BACKEND_HEALTHY, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set(), new Set(["warning"]))).toBe(graph);
  });

  it("drops only the edges carrying a hidden health", () => {
    const graph = graphOf([BACKEND_CRITICAL, BACKEND_HEALTHY, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set(), new Set(["critical"])).edges).toEqual([BACKEND_HEALTHY, ROUTE]);
  });

  it("keeps a backend edge without health while every health is hidden", () => {
    const graph = graphOf([BACKEND, BACKEND_HEALTHY, BACKEND_CRITICAL]);
    const hiddenHealths = new Set(["ok", "unknown", "warning", "critical"] as const);
    expect(hideTopologyEdgeKinds(graph, new Set(), hiddenHealths).edges).toEqual([BACKEND]);
  });

  it("drops only the no-local-pod edges when that health is hidden", () => {
    const graph = graphOf([BACKEND_NO_LOCAL_POD, BACKEND_CRITICAL, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set(), new Set(["no-local-pod"])).edges).toEqual([BACKEND_CRITICAL, ROUTE]);
  });

  it("drops a health-hidden edge together with its kind", () => {
    const graph = graphOf([BACKEND_HEALTHY, ROUTE]);
    expect(hideTopologyEdgeKinds(graph, new Set(["backend"]), new Set(["ok"])).edges).toEqual([ROUTE]);
  });

  it("drops the missing entries of hidden edge kinds only", () => {
    const graph = graphOf(
      [BACKEND],
      [
        { target: "node", kind: "volume", sections: ["volumes"] },
        { target: "edge", kind: "route", sections: ["routeTables"] },
        { target: "edge", kind: "backend", sections: ["lbs"] },
        { target: "detail", kind: "instance", sections: ["vnics"] },
      ],
    );
    expect(hideTopologyEdgeKinds(graph, new Set(["route"])).missing).toEqual([
      { target: "node", kind: "volume", sections: ["volumes"] },
      { target: "edge", kind: "backend", sections: ["lbs"] },
      { target: "detail", kind: "instance", sections: ["vnics"] },
    ]);
  });

  it("drops the diagnostic stats when edges are filtered out", () => {
    const graph: TopologyGraph = {
      ...graphOf([SL_ALLOW]),
      security: { links: 4, edges: 1 },
      localTraffic: { endpointSlices: 2, localServices: 1, downgraded: 1 },
    };
    const filtered = hideTopologyEdgeKinds(graph, new Set(["sl-allow"]));
    expect(filtered.security).toBeUndefined();
    expect(filtered.localTraffic).toBeUndefined();
  });

  it("keeps the diagnostic stats when nothing is filtered out", () => {
    const graph: TopologyGraph = { ...graphOf([SL_ALLOW]), security: { links: 4, edges: 1 } };
    expect(hideTopologyEdgeKinds(graph, new Set(["route"])).security).toEqual({ links: 4, edges: 1 });
  });
});

describe("filtered exports", () => {
  const graph = graphOf([BACKEND, ROUTE, SL_ALLOW]);

  it("keeps every output byte-identical when no kind is hidden", () => {
    const visible = hideTopologyEdgeKinds(graph, new Set());
    expect(toMermaid(visible)).toBe(toMermaid(graph));
    expect(svgOf(visible)).toBe(svgOf(graph));
  });

  it("removes the hidden kind from the Mermaid links and legend", () => {
    const mermaid = toMermaid(hideTopologyEdgeKinds(graph, new Set(["route"])));
    expect(mermaid).not.toContain("Subnet → Gateway");
    expect(mermaid).not.toContain("#8b9196");
    expect(mermaid).toContain("LB → Instance : #7ea6d8");
  });

  it("removes the hidden kind from the SVG lines and legend", () => {
    const svg = svgOf(hideTopologyEdgeKinds(graph, new Set(["backend"])));
    expect(svg).not.toContain("LB → Instance");
    expect(svg).not.toContain("#7ea6d8");
    expect(svg).toContain("Subnet → Gateway");
  });

  it("keeps every output byte-identical when no health is hidden", () => {
    const healthy = graphOf([BACKEND_HEALTHY, BACKEND_CRITICAL, ROUTE]);
    const visible = hideTopologyEdgeKinds(healthy, new Set(), new Set());
    expect(toMermaid(visible)).toBe(toMermaid(healthy));
    expect(svgOf(visible)).toBe(svgOf(healthy));
  });

  it("removes only the hidden health from the Mermaid and SVG legends", () => {
    const healthy = graphOf([BACKEND_HEALTHY, BACKEND_CRITICAL, ROUTE]);
    const visible = hideTopologyEdgeKinds(healthy, new Set(), new Set(["critical"]));
    for (const output of [toMermaid(visible), svgOf(visible)]) {
      expect(output).not.toContain("Backend Critical");
      expect(output).not.toContain("#d9534f");
      expect(output).toContain("Backend OK");
      expect(output).toContain("#4fb477");
      expect(output).toContain("Subnet → Gateway");
    }
  });

  it("carries the no-local-pod colour and label into both exports", () => {
    const healthy = graphOf([BACKEND_NO_LOCAL_POD, BACKEND_CRITICAL, ROUTE]);
    for (const output of [toMermaid(healthy), svgOf(healthy)]) {
      expect(output).toContain("No Local Pod (by design)");
      expect(output).toContain("#6e8496");
      expect(output).toContain("Backend Critical");
    }
    expect(toMermaid(healthy)).toContain("stroke:#6e8496,stroke-dasharray:5 4");
    expect(svgOf(healthy)).toContain('stroke="#6e8496" stroke-width="1.5" stroke-linejoin="round"');
    expect(svgOf(healthy)).toContain('stroke-dasharray="5 4"');
  });

  it("removes the no-local-pod rows from both exports while that health is hidden", () => {
    const healthy = graphOf([BACKEND_NO_LOCAL_POD, BACKEND_CRITICAL, ROUTE]);
    const visible = hideTopologyEdgeKinds(healthy, new Set(), new Set(["no-local-pod"]));
    for (const output of [toMermaid(visible), svgOf(visible)]) {
      expect(output).not.toContain("No Local Pod (by design)");
      expect(output).not.toContain("#6e8496");
      expect(output).toContain("Backend Critical");
    }
  });

  it("removes the hidden kind from the missing comments of the Mermaid output", () => {
    const withMissing = graphOf([BACKEND], [{ target: "edge", kind: "route", sections: ["routeTables"] }]);
    expect(toMermaid(withMissing)).toContain("%% missing: edge Subnet → Gateway (routeTables)");
    expect(toMermaid(hideTopologyEdgeKinds(withMissing, new Set(["route"])))).not.toContain("%% missing:");
  });
});
