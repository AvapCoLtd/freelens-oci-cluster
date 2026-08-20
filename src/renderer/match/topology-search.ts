import { filterRows } from "./filter-rows";
import type { TopologyFlowNode } from "./topology-flow";

function searchTextOf(node: TopologyFlowNode): readonly (string | undefined)[] {
  return [node.data.label, node.data.kindLabel, node.data.sublabel, ...node.data.searchText];
}

/** 図の検索にマッチしたノードのid。空queryは全ノード(呼び出し側は減光しない)。 */
export function matchTopologyNodes(nodes: readonly TopologyFlowNode[], query: string): Set<string> {
  return new Set(filterRows(nodes, query, searchTextOf).map((node) => node.id));
}
