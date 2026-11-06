import { EDGE_HEALTH_LEVELS } from "./backend-health";
import {
  TOPOLOGY_EDGE_KINDS,
  type TopologyEdgeHealth,
  type TopologyEdgeKind,
  type TopologyGraph,
} from "./topology-graph";

export interface TopologyEdgeKindCount {
  kind: TopologyEdgeKind;
  count: number;
}

export interface TopologyLegendKindRow {
  type: "kind";
  kind: TopologyEdgeKind;
  count: number;
  shown: boolean;
}

export interface TopologyLegendHealthRow {
  type: "health";
  health: TopologyEdgeHealth;
  count: number;
  shown: boolean;
}

export type TopologyLegendRow = TopologyLegendKindRow | TopologyLegendHealthRow;

const NO_HIDDEN_HEALTHS: ReadonlySet<TopologyEdgeHealth> = new Set();

export function edgeKindCountsOf(graph: TopologyGraph): TopologyEdgeKindCount[] {
  const counts = new Map<TopologyEdgeKind, number>();
  for (const edge of graph.edges) counts.set(edge.kind, (counts.get(edge.kind) ?? 0) + 1);
  const rows: TopologyEdgeKindCount[] = [];
  for (const kind of TOPOLOGY_EDGE_KINDS) {
    const count = counts.get(kind);
    if (count !== undefined) rows.push({ kind, count });
  }
  return rows;
}

function healthCountsOf(graph: TopologyGraph): Map<TopologyEdgeHealth, number> {
  const counts = new Map<TopologyEdgeHealth, number>();
  for (const edge of graph.edges) {
    if (edge.health === undefined) continue;
    counts.set(edge.health, (counts.get(edge.health) ?? 0) + 1);
  }
  return counts;
}

/** フィルタ後のグラフを渡さない: 隠した種別の行と本数が凡例から消える。 */
export function topologyLegendRowsOf(
  graph: TopologyGraph,
  hidden: ReadonlySet<TopologyEdgeKind>,
  hiddenHealths: ReadonlySet<TopologyEdgeHealth> = NO_HIDDEN_HEALTHS,
): TopologyLegendRow[] {
  const countByKind = new Map(edgeKindCountsOf(graph).map((row) => [row.kind, row.count]));
  const countByHealth = healthCountsOf(graph);
  const rows: TopologyLegendRow[] = [];
  for (const kind of TOPOLOGY_EDGE_KINDS) {
    const count = countByKind.get(kind);
    if (count === undefined) continue;
    const shown = !hidden.has(kind);
    rows.push({ type: "kind", kind, count, shown });
    if (kind !== "backend" || !shown) continue;
    for (const health of EDGE_HEALTH_LEVELS) {
      const healthCount = countByHealth.get(health);
      if (healthCount !== undefined)
        rows.push({ type: "health", health, count: healthCount, shown: !hiddenHealths.has(health) });
    }
  }
  return rows;
}

/** 隠した種別は欠落(missing)からも落とし、描かない種別の欠落をバナー・出力へ出さない。 */
export function hideTopologyEdgeKinds(
  graph: TopologyGraph,
  hidden: ReadonlySet<TopologyEdgeKind>,
  hiddenHealths: ReadonlySet<TopologyEdgeHealth> = NO_HIDDEN_HEALTHS,
): TopologyGraph {
  // 落とす対象が無ければ同じ参照を返す: 全種別ON時の描画・出力を変更前と一致させる。
  if (hidden.size === 0 && hiddenHealths.size === 0) return graph;
  // healthを持たないエッジは種別の判定だけに従う: ヘルス未取得を隠す対象に含めない。
  const edges = graph.edges.filter(
    (edge) => !hidden.has(edge.kind) && (edge.health === undefined || !hiddenHealths.has(edge.health)),
  );
  const missing = graph.missing.filter(
    (entry) => entry.target !== "edge" || !hidden.has(entry.kind as TopologyEdgeKind),
  );
  if (edges.length === graph.edges.length && missing.length === graph.missing.length) return graph;
  // 診断統計は集計前の本数のため、エッジを落としたグラフでは名乗らせない。
  return { ...graph, edges, missing, security: undefined, localTraffic: undefined };
}
