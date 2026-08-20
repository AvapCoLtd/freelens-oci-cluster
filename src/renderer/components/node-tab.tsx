import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { ClusterOciData } from "../fetch/fetch";
import { filterRows } from "../match/filter-rows";
import { nodePoolNameOfInstance } from "../match/node-pool";
import { parseProviderId } from "../match/provider-id";
import { sectionsReady } from "../match/section-ready";
import { sortRows } from "../match/sort-rows";
import type { OciInstance } from "../oci/types";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { NodePoolSummary } from "./node-pool-summary";
import { OcidCopyButton } from "./ocid-copy-button";
import { SearchBar } from "./search-bar";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LoadingBlock } from "./spinner";
import { LifecycleBadge, ReadyBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";
import type { SearchState } from "./use-search-query";

function isNodeReady(node: Renderer.K8sApi.Node): boolean {
  return (node.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True");
}

function findInstance(instances: OciInstance[], instanceId: string | undefined): OciInstance | undefined {
  return instanceId ? instances.find((i) => i.id === instanceId) : undefined;
}

type NodeColumn = "node" | "instance" | "pool" | "shape" | "adFd" | "lifecycle" | "ready";

interface NodeRow {
  key: string;
  node: Renderer.K8sApi.Node;
  instance: OciInstance | undefined;
  poolName: string | undefined;
  ready: boolean;
}

const SORT_VALUE: Record<NodeColumn, (row: NodeRow) => string | number | undefined> = {
  node: (row) => row.node.getName(),
  instance: (row) => row.instance?.["display-name"],
  pool: (row) => row.poolName,
  shape: (row) => row.instance?.shape,
  adFd: (row) =>
    row.instance ? `${row.instance["availability-domain"] ?? ""} / ${row.instance["fault-domain"] ?? ""}` : undefined,
  lifecycle: (row) => row.instance?.["lifecycle-state"],
  ready: (row) => (row.ready ? 1 : 0),
};

// K8s Ready列は0/1で全行が"0"や"1"に一致してしまうため検索対象から外す。
function searchValuesOf(row: NodeRow): (string | number | undefined)[] {
  return [
    row.node.getName(),
    row.instance?.["display-name"],
    row.poolName,
    row.instance?.shape,
    row.instance ? `${row.instance["availability-domain"] ?? ""} / ${row.instance["fault-domain"] ?? ""}` : undefined,
    row.instance?.["lifecycle-state"],
  ];
}

export interface NodeTabProps {
  data: ClusterOciData;
  region: string | undefined;
  search: SearchState;
}

export const NodeTab = observer(function NodeTab({ data, region, search }: NodeTabProps) {
  const nodeStore = Renderer.K8sApi.nodesStore;
  const instancesResult = data.instances;
  const instances = instancesResult.ok ? instancesResult.data : [];
  const nodePools = data.nodePools.ok ? data.nodePools.data : [];
  const [sort, toggleSort] = useColumnSort<NodeColumn>("node");
  const { query, setQuery } = search;

  // 行のOCI列が後から埋まるとテーブルがガタつくため、依存セクションが確定してから表を出す。
  if (!nodeStore.isLoaded || !sectionsReady(data.instances, data.nodePools)) {
    return <LoadingBlock />;
  }
  const nodes = nodeStore.items;
  if (nodes.length === 0) {
    return <EmptyState message="No K8s Nodes" />;
  }

  const rows: NodeRow[] = nodes.map((node) => {
    const parsed = parseProviderId(node.spec.providerID);
    const instance = parsed.isOke ? findInstance(instances, parsed.instanceId) : undefined;
    return {
      key: node.getId(),
      node,
      instance,
      poolName: nodePoolNameOfInstance(nodePools, instance),
      ready: isNodeReady(node),
    };
  });
  const filteredRows = filterRows(rows, query, searchValuesOf);
  const sortedRows = sortRows(filteredRows, SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      <SearchBar query={query} onChange={setQuery} placeholder="Search node pools / nodes..." />
      <NodePoolSummary nodePools={data.nodePools} query={query} />
      {!instancesResult.ok && <SectionError kind={instancesResult.kind} raw={instancesResult.raw} />}
      {sortedRows.length === 0 ? (
        <EmptyState message={`No nodes match "${query}"`} />
      ) : (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <SortableHeaderCell column="node" sort={sort} onSort={toggleSort}>
                K8s Node
              </SortableHeaderCell>
              <SortableHeaderCell column="instance" sort={sort} onSort={toggleSort}>
                Instance
              </SortableHeaderCell>
              <SortableHeaderCell column="pool" sort={sort} onSort={toggleSort}>
                Pool
              </SortableHeaderCell>
              <SortableHeaderCell column="shape" sort={sort} onSort={toggleSort}>
                Shape
              </SortableHeaderCell>
              <SortableHeaderCell column="adFd" sort={sort} onSort={toggleSort}>
                AD / FD
              </SortableHeaderCell>
              <SortableHeaderCell column="lifecycle" sort={sort} onSort={toggleSort}>
                lifecycle-state
              </SortableHeaderCell>
              <SortableHeaderCell column="ready" sort={sort} onSort={toggleSort}>
                K8s Ready
              </SortableHeaderCell>
              <th style={TH_STYLE}>OCID</th>
              <th style={TH_STYLE} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ key, node, instance, poolName, ready }) => (
              <tr key={key}>
                <td style={TD_STYLE}>{node.getName()}</td>
                <td style={TD_STYLE}>{instance?.["display-name"] ?? "-"}</td>
                <td style={TD_STYLE}>{poolName ?? "-"}</td>
                <td style={TD_STYLE}>{instance?.shape ?? "-"}</td>
                <td style={TD_STYLE}>
                  {instance ? `${instance["availability-domain"] ?? "-"} / ${instance["fault-domain"] ?? "-"}` : "-"}
                </td>
                <td style={TD_STYLE}>
                  <LifecycleBadge state={instance?.["lifecycle-state"]} />
                </td>
                <td style={TD_STYLE}>
                  <ReadyBadge ready={ready} />
                </td>
                <td style={TD_STYLE}>{instance ? <OcidCopyButton ocid={instance.id} /> : "-"}</td>
                <td style={TD_STYLE}>
                  {instance && region ? <ConsoleButton type="instance" ocid={instance.id} region={region} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
