import { filterRows } from "../match/filter-rows";
import type { OciResult } from "../oci/result";
import type { OciNodePoolSummary } from "../oci/types";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";

function searchValuesOf(pool: OciNodePoolSummary): (string | number | undefined)[] {
  return [
    pool.name,
    pool["node-shape"],
    pool["kubernetes-version"],
    pool["node-config-details"]?.size,
    pool["lifecycle-state"],
  ];
}

/** ノードページ上部のプールサマリ表。0件は空表示、同名プール(別OCID)は別行(受入条件)。 */
export function NodePoolSummary({ nodePools, query }: { nodePools: OciResult<OciNodePoolSummary[]>; query: string }) {
  if (!nodePools.ok) {
    if (nodePools.kind === "not_requested") return null;
    return <SectionError kind={nodePools.kind} raw={nodePools.raw} />;
  }
  if (nodePools.data.length === 0) {
    return <EmptyState message="No node pools" />;
  }
  const rows = filterRows(nodePools.data, query, searchValuesOf);
  if (rows.length === 0) {
    return <EmptyState message={`No node pools match "${query}"`} />;
  }
  return (
    <table style={{ ...TABLE_STYLE, marginBottom: 16 }}>
      <thead>
        <tr>
          <th style={TH_STYLE}>Node Pool</th>
          <th style={TH_STYLE}>Shape</th>
          <th style={TH_STYLE}>K8s Version</th>
          <th style={TH_STYLE}>size</th>
          <th style={TH_STYLE}>lifecycle-state</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((pool) => (
          <tr key={pool.id}>
            <td style={TD_STYLE}>{pool.name ?? "-"}</td>
            <td style={TD_STYLE}>{pool["node-shape"] ?? "-"}</td>
            <td style={TD_STYLE}>{pool["kubernetes-version"] ?? "-"}</td>
            <td style={TD_STYLE}>{pool["node-config-details"]?.size ?? "-"}</td>
            <td style={TD_STYLE}>
              <LifecycleBadge state={pool["lifecycle-state"]} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
