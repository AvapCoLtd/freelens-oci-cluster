import { describe, expect, it } from "vitest";
import type { TopologyFlowNode, TopologyFlowNodeData } from "./topology-flow";
import { matchTopologyNodes } from "./topology-search";

function node(id: string, data: Partial<TopologyFlowNodeData>): TopologyFlowNode {
  return {
    id,
    type: "resource",
    position: { x: 0, y: 0 },
    width: 100,
    height: 40,
    data: {
      variant: "resource",
      label: id,
      searchText: [],
      status: "unknown",
      expandable: false,
      ...data,
    },
  };
}

const nodes: TopologyFlowNode[] = [
  node("vcn", { variant: "container", kindLabel: "VCN", label: "cluster-vcn", sublabel: "10.0.0.0/16" }),
  node("subnet", { variant: "container", kindLabel: "Subnet", label: "worker-subnet", sublabel: "10.0.1.0/24" }),
  node("instance", {
    kindLabel: "Instance",
    label: "worker-01",
    searchText: ["ocid1.instance.oc1.iad.aaa", "RUNNING"],
  }),
  node("lb", { kindLabel: "LB", label: "ingress", searchText: ["192.168.10.5"] }),
];

function matched(query: string): string[] {
  return [...matchTopologyNodes(nodes, query)].sort();
}

describe("matchTopologyNodes", () => {
  it("returns every node for an empty or whitespace-only query", () => {
    expect(matched("")).toEqual(["instance", "lb", "subnet", "vcn"]);
    expect(matched("   ")).toEqual(["instance", "lb", "subnet", "vcn"]);
  });

  it("matches the label ignoring case", () => {
    expect(matched("WORKER-01")).toEqual(["instance"]);
  });

  it("matches the kind label", () => {
    expect(matched("subnet")).toEqual(["subnet"]);
    expect(matched("vcn")).toEqual(["vcn"]);
  });

  it("matches the sublabel", () => {
    expect(matched("10.0.1.0")).toEqual(["subnet"]);
  });

  it("matches the detail values kept for search only", () => {
    expect(matched("192.168.10.5")).toEqual(["lb"]);
    expect(matched("ocid1.instance")).toEqual(["instance"]);
  });

  it("requires every whitespace-separated token to match (AND)", () => {
    expect(matched("worker subnet")).toEqual(["subnet"]);
    expect(matched("worker running")).toEqual(["instance"]);
    expect(matched("worker nope")).toEqual([]);
  });
});
