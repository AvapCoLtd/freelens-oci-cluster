/** 描画順・ソートの安定キーを兼ねる種別の並び。 */
export const TOPOLOGY_NODE_KINDS = [
  "vcn",
  "subnet",
  "subnet-summary",
  "instance-group",
  "instance",
  "lb",
  "nlb",
  "gateway",
  "waf",
  "k8s-service",
  "k8s-pv",
  "volume",
  "filesystem",
  "backup-policy",
  "snapshot-policy",
] as const;

export type TopologyNodeKind = (typeof TOPOLOGY_NODE_KINDS)[number];

const KIND_ORDER = new Map<TopologyNodeKind, number>(TOPOLOGY_NODE_KINDS.map((kind, index) => [kind, index]));

export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

interface OrderableNode {
  kind: TopologyNodeKind;
  id: string;
}

export function compareNodes(a: OrderableNode, b: OrderableNode): number {
  const byKind = (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0);
  return byKind !== 0 ? byKind : compareText(a.id, b.id);
}
