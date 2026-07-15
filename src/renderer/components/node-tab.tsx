import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { parseProviderId } from "../match/provider-id";
import { sortRows } from "../match/sort-rows";
import type { ClusterOciData } from "../oci/fetch";
import type { OciInstanceSummary } from "../oci/types";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { OcidCopyButton } from "./ocid-copy-button";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LifecycleBadge, ReadyBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";

function isNodeReady(node: Renderer.K8sApi.Node): boolean {
  return (node.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True");
}

function findInstance(instances: OciInstanceSummary[], instanceId: string | undefined): OciInstanceSummary | undefined {
  return instanceId ? instances.find((i) => i.id === instanceId) : undefined;
}

type NodeColumn = "node" | "instance" | "shape" | "adFd" | "lifecycle" | "ready";

interface NodeRow {
  key: string;
  node: Renderer.K8sApi.Node;
  instance: OciInstanceSummary | undefined;
  ready: boolean;
}

const SORT_VALUE: Record<NodeColumn, (row: NodeRow) => string | number | undefined> = {
  node: (row) => row.node.getName(),
  instance: (row) => row.instance?.["display-name"],
  shape: (row) => row.instance?.shape,
  adFd: (row) =>
    row.instance ? `${row.instance["availability-domain"] ?? ""} / ${row.instance["fault-domain"] ?? ""}` : undefined,
  lifecycle: (row) => row.instance?.["lifecycle-state"],
  ready: (row) => (row.ready ? 1 : 0),
};

export interface NodeTabProps {
  data: ClusterOciData;
  region: string | undefined;
}

export const NodeTab = observer(function NodeTab({ data, region }: NodeTabProps) {
  const nodeStore = Renderer.K8sApi.nodesStore;
  const instancesResult = data.instances;
  const instances = instancesResult.ok ? instancesResult.data : [];
  const [sort, toggleSort] = useColumnSort<NodeColumn>("node");

  if (!nodeStore.isLoaded) {
    return <EmptyState message="読み込み中..." />;
  }
  const nodes = nodeStore.items;
  if (nodes.length === 0) {
    return <EmptyState message="K8s Node がありません" />;
  }

  const rows: NodeRow[] = nodes.map((node) => {
    const parsed = parseProviderId(node.spec.providerID);
    return {
      key: node.getId(),
      node,
      instance: parsed.isOke ? findInstance(instances, parsed.instanceId) : undefined,
      ready: isNodeReady(node),
    };
  });
  const sortedRows = sortRows(rows, SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      {!instancesResult.ok && <SectionError kind={instancesResult.kind} raw={instancesResult.raw} />}
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <SortableHeaderCell column="node" sort={sort} onSort={toggleSort}>
              K8s Node
            </SortableHeaderCell>
            <SortableHeaderCell column="instance" sort={sort} onSort={toggleSort}>
              Instance
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
          {sortedRows.map(({ key, node, instance, ready }) => (
            <tr key={key}>
              <td style={TD_STYLE}>{node.getName()}</td>
              <td style={TD_STYLE}>{instance?.["display-name"] ?? "-"}</td>
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
    </div>
  );
});
