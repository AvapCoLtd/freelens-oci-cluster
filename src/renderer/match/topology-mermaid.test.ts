import { describe, expect, it } from "vitest";
import type { TopologyEdge, TopologyGraph, TopologyMissing, TopologyNode, TopologyNodeKind } from "./topology-graph";
import { toMermaid } from "./topology-mermaid";

const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vcn1";
const SUBNET = "ocid1.subnet.oc1.ap-tokyo-1.a";
const INSTANCE = "ocid1.instance.oc1.ap-tokyo-1.i1";
const LB = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";
const NAT = "ocid1.natgateway.oc1.ap-tokyo-1.nat1";
const VOLUME = "ocid1.volume.oc1.ap-tokyo-1.v1";

function node(id: string, kind: TopologyNodeKind, parentId?: string, extra: Partial<TopologyNode> = {}): TopologyNode {
  return { id, kind, label: id, parentId, detail: [], ...extra };
}

function edge(kind: TopologyEdge["kind"], source: string, target: string): TopologyEdge {
  return { id: `${kind}|${source}|${target}`, kind, source, target };
}

function graphOf(nodes: TopologyNode[], edges: TopologyEdge[] = [], missing: TopologyMissing[] = []): TopologyGraph {
  return { nodes, edges, missing };
}

describe("toMermaid", () => {
  it("emits only the header for an empty graph", () => {
    expect(toMermaid(graphOf([]))).toBe("flowchart TB");
  });

  it("nests children into the subgraph of their parent and keeps leaves as plain nodes", () => {
    const text = toMermaid(
      graphOf([
        node(VCN, "vcn", undefined, { label: "prod-vcn" }),
        node(SUBNET, "subnet", VCN, { label: "app-subnet" }),
        node(INSTANCE, "instance", SUBNET, { label: "worker-1" }),
        node(NAT, "gateway", VCN, { label: "nat" }),
        node(LB, "lb", undefined, { label: "public-lb" }),
      ]),
    );
    expect(text).toBe(
      [
        "flowchart TB",
        '  subgraph oci["OCI"]',
        '    subgraph n1["[VCN] prod-vcn"]',
        '      subgraph n2["[Subnet] app-subnet"]',
        '        n3["[Instance] worker-1"]',
        "      end",
        '      n4["[Gateway] nat"]',
        "    end",
        '    n5["[LB] public-lb"]',
        "  end",
      ].join("\n"),
    );
  });

  it("splits the top level into the Kubernetes and OCI domains", () => {
    const text = toMermaid(
      graphOf([
        node(VCN, "vcn", undefined, { label: "prod-vcn" }),
        node("k8s-service:app/web", "k8s-service", undefined, { label: "app/web" }),
        node("k8s-pv:pv-1", "k8s-pv", undefined, { label: "pv-1" }),
      ]),
    );
    expect(text).toBe(
      [
        "flowchart TB",
        '  subgraph k8s["Kubernetes"]',
        '    n2["[Service] app/web"]',
        '    n3["[PV] pv-1"]',
        "  end",
        '  subgraph oci["OCI"]',
        '    n1["[VCN] prod-vcn"]',
        "  end",
      ].join("\n"),
    );
  });

  it("omits a domain subgraph that would be empty", () => {
    const k8sOnly = toMermaid(graphOf([node("k8s-service:app/web", "k8s-service", undefined, { label: "app/web" })]));
    expect(k8sOnly).toContain('subgraph k8s["Kubernetes"]');
    expect(k8sOnly).not.toContain('subgraph oci["OCI"]');

    const ociOnly = toMermaid(graphOf([node(LB, "lb", undefined, { label: "public-lb" })]));
    expect(ociOnly).toContain('subgraph oci["OCI"]');
    expect(ociOnly).not.toContain('subgraph k8s["Kubernetes"]');

    expect(toMermaid(graphOf([]))).not.toContain("subgraph");
  });

  it("labels edges with the edge kind and renumbers endpoints", () => {
    const text = toMermaid(
      graphOf(
        [node(LB, "lb", undefined, { label: "public-lb" }), node(INSTANCE, "instance", undefined, { label: "w1" })],
        [edge("backend", LB, INSTANCE)],
      ),
    );
    expect(text).toContain("  n1 -->|LB → Instance| n2");
    expect(text).not.toContain(LB);
  });

  it("uses the subgraph id when the parent node is an edge endpoint", () => {
    const text = toMermaid(
      graphOf(
        [
          node(SUBNET, "subnet", undefined, { label: "app-subnet" }),
          node(INSTANCE, "instance", SUBNET, { label: "worker-1" }),
          node(NAT, "gateway", undefined, { label: "nat" }),
        ],
        [edge("route", SUBNET, NAT)],
      ),
    );
    expect(text).toContain('  subgraph n1["[Subnet] app-subnet"]');
    expect(text).toContain("  n1 -->|Subnet → Gateway| n3");
  });

  it("colors the links per edge kind with linkStyle", () => {
    const text = toMermaid(
      graphOf(
        [
          node(SUBNET, "subnet", undefined, { label: "s" }),
          node(NAT, "gateway", undefined, { label: "nat" }),
          node(LB, "lb", undefined, { label: "lb" }),
          node(INSTANCE, "instance", undefined, { label: "i" }),
        ],
        [edge("route", SUBNET, NAT), edge("backend", LB, INSTANCE), edge("route", SUBNET, LB)],
      ),
    );
    expect(text).toContain("  linkStyle 0,2 stroke:#8b9196");
    expect(text).toContain("  linkStyle 1 stroke:#7ea6d8");
  });

  it("colors the attachment links with their own linkStyle", () => {
    const text = toMermaid(
      graphOf(
        [
          node(INSTANCE, "instance", undefined, { label: "worker-1" }),
          node(VOLUME, "volume", undefined, { label: "data-vol" }),
          node(LB, "lb", undefined, { label: "lb" }),
        ],
        [edge("backend", LB, INSTANCE), edge("attachment", INSTANCE, VOLUME)],
      ),
    );
    expect(text).toContain("  n1 -->|Instance → Volume| n2");
    expect(text).toContain("  linkStyle 1 stroke:#d289cb");
  });

  it("defines the status classes and assigns them per status", () => {
    const text = toMermaid(
      graphOf([
        node(VCN, "vcn", undefined, { label: "prod-vcn", status: "ok" }),
        node(SUBNET, "subnet", VCN, { label: "app-subnet", status: "warning" }),
        node(INSTANCE, "instance", SUBNET, { label: "worker-1", status: "ok" }),
        node(NAT, "gateway", VCN, { label: "nat" }),
      ]),
    );
    expect(text).not.toContain("fill:");
    expect(text).not.toContain("classDef ok");
    expect(text.split("\n").filter((line) => line.startsWith("  class"))).toEqual([
      "  classDef warning stroke:#e0a45a,stroke-width:2px",
      "  class n2 warning",
    ]);
  });

  it("omits the status classes when no node carries a status", () => {
    expect(toMermaid(graphOf([node(LB, "lb")]))).not.toContain("classDef");
  });

  it("omits the status classes when every node is ok", () => {
    expect(toMermaid(graphOf([node(LB, "lb", undefined, { status: "ok" })]))).not.toContain("classDef");
  });

  it("escapes label characters that break the mermaid syntax", () => {
    const text = toMermaid(
      graphOf([
        node(LB, "lb", undefined, { label: 'we"ird [lb] |a| <b> #1 %%{init}%%' }),
        node("instance-group:x", "instance-group", undefined, { label: "12 nodes", count: 12 }),
      ]),
    );
    expect(text).toContain('  n1["[LB] we#quot;ird [lb] |a| #60;b#62; #35;1 #37;#37;{init}#37;#37;"]');
    expect(text).toContain('  n2["[Instances] 12 nodes"]');
  });

  it("puts the sublabel on a second label line", () => {
    const text = toMermaid(
      graphOf([
        node(INSTANCE, "instance", undefined, { label: "worker-1", summary: "VM.Standard.E4.Flex 2c/16G" }),
        node(LB, "lb", undefined, { label: "public-lb" }),
      ]),
    );
    expect(text).toContain('  n1["[Instance] worker-1<br/>VM.Standard.E4.Flex 2c/16G"]');
    expect(text).toContain('  n2["[LB] public-lb"]');
  });

  it("keeps <br/> intact while escaping the sublabel text", () => {
    const text = toMermaid(graphOf([node(INSTANCE, "instance", undefined, { label: "w1", summary: "<b> 2c/16G" })]));
    expect(text).toContain('  n1["[Instance] w1<br/>#60;b#62; 2c/16G"]');
  });

  it("puts the cluster name and compartment in a leading comment when meta is given", () => {
    const text = toMermaid(graphOf([node(LB, "lb", undefined, { label: "public-lb" })]), {
      clusterName: "demo",
      compartmentId: "ocid1.compartment.oc1..c1",
    });
    expect(text.split("\n").slice(0, 2)).toEqual([
      "%% demo / ocid1.compartment.oc1..c1 / generated by freelens-oci-cluster",
      "flowchart TB",
    ]);
  });

  it("drops the missing meta fields and keeps the generator name", () => {
    expect(toMermaid(graphOf([]), { clusterName: "demo" })).toBe(
      ["%% demo / generated by freelens-oci-cluster", "flowchart TB"].join("\n"),
    );
    expect(toMermaid(graphOf([]), {})).toBe(["%% generated by freelens-oci-cluster", "flowchart TB"].join("\n"));
  });

  it("keeps the link indexes relative to the first edge line when meta is given", () => {
    const text = toMermaid(
      graphOf(
        [node(LB, "lb", undefined, { label: "lb" }), node(INSTANCE, "instance", undefined, { label: "i" })],
        [edge("backend", LB, INSTANCE)],
      ),
      { clusterName: "demo" },
    );
    expect(text).toContain("  linkStyle 0 stroke:#7ea6d8");
  });

  it("puts the subnet CIDR and the volume size on the second label line", () => {
    const text = toMermaid(
      graphOf([
        node(SUBNET, "subnet", undefined, { label: "app-subnet", summary: "10.0.1.0/24" }),
        node(INSTANCE, "instance", SUBNET, { label: "worker-1" }),
        node(VOLUME, "volume", undefined, { label: "data-vol", summary: "50 GB" }),
      ]),
    );
    expect(text).toContain('    subgraph n1["[Subnet] app-subnet<br/>10.0.1.0/24"]');
    expect(text).toContain('    n3["[Volume] data-vol<br/>50 GB"]');
  });

  it("lists only the edge kinds and statuses used in the output as a legend", () => {
    const text = toMermaid(
      graphOf(
        [
          node(SUBNET, "subnet", undefined, { label: "app-subnet", status: "ok" }),
          node(NAT, "gateway", undefined, { label: "nat", status: "warning" }),
          node(INSTANCE, "instance", SUBNET, { label: "worker-1" }),
          node(VOLUME, "volume", undefined, { label: "data-vol", status: "unknown" }),
        ],
        [edge("route", SUBNET, NAT), edge("attachment", INSTANCE, VOLUME)],
      ),
    );
    expect(text.split("\n").slice(-5)).toEqual([
      "  %% legend:",
      "  %%   Instance → Volume : #d289cb",
      "  %%   Subnet → Gateway : #8b9196",
      "  %%   warning : abnormal state or orphaned PV (orange border)",
      "  %%   unknown : state unknown (gray dashed border)",
    ]);
  });

  it("omits the legend when no edge and no status is used", () => {
    expect(toMermaid(graphOf([node(LB, "lb", undefined, { label: "lb", status: "ok" })]))).not.toContain("legend");
  });

  it("lists the missing kinds as trailing comments", () => {
    const text = toMermaid(
      graphOf(
        [node(VCN, "vcn", undefined, { label: "prod-vcn" })],
        [],
        [
          { target: "node", kind: "volume", sections: ["volumes"] },
          { target: "edge", kind: "backend", sections: ["lbs", "instances"] },
        ],
      ),
    );
    expect(text.split("\n").slice(-2)).toEqual([
      "  %% missing: node Volume (volumes)",
      "  %% missing: edge LB → Instance (lbs, instances)",
    ]);
  });

  it("ノードは出るが情報が欠ける劣化はdetailとして書き分ける", () => {
    const text = toMermaid(
      graphOf(
        [node(INSTANCE, "instance", undefined, { label: "worker-1" })],
        [],
        [{ target: "detail", kind: "instance", sections: ["vnics"] }],
      ),
    );
    expect(text.split("\n").slice(-1)).toEqual(["  %% missing: detail Instance placement / IP (VNICs) (vnics)"]);
  });

  it("parentIdが互いを指すノードもそれぞれ1回だけ出力する", () => {
    const text = toMermaid(
      graphOf([
        node(SUBNET, "subnet", INSTANCE, { label: "app-subnet" }),
        node(INSTANCE, "instance", SUBNET, { label: "worker-1" }),
      ]),
    );
    const lines = text
      .split("\n")
      .filter((line) => line.includes("[Subnet] app-subnet") || line.includes("[Instance] worker-1"));
    expect(lines).toHaveLength(2);
    expect(lines.filter((line) => line.includes("[Subnet] app-subnet"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("[Instance] worker-1"))).toHaveLength(1);
  });
});
