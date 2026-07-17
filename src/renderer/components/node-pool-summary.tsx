import type { OciResult } from "../sdk/result";
import type { OciNodePoolSummary } from "../sdk/types";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";

/** ノードページ上部のプールサマリ表。0件は空表示、同名プール(別OCID)は別行(受入条件)。 */
export function NodePoolSummary({ nodePools }: { nodePools: OciResult<OciNodePoolSummary[]> }) {
  if (!nodePools.ok) {
    if (nodePools.kind === "not_requested") return null;
    return <SectionError kind={nodePools.kind} raw={nodePools.raw} />;
  }
  if (nodePools.data.length === 0) {
    return <EmptyState message="ノードプールがありません" />;
  }
  return (
    <table style={{ ...TABLE_STYLE, marginBottom: 16 }}>
      <thead>
        <tr>
          <th style={TH_STYLE}>ノードプール</th>
          <th style={TH_STYLE}>Shape</th>
          <th style={TH_STYLE}>K8sバージョン</th>
          <th style={TH_STYLE}>size</th>
          <th style={TH_STYLE}>lifecycle-state</th>
        </tr>
      </thead>
      <tbody>
        {nodePools.data.map((pool) => (
          <tr key={pool.id}>
            <td style={TD_STYLE}>{pool.name ?? "-"}</td>
            <td style={TD_STYLE}>{pool.nodeShape ?? "-"}</td>
            <td style={TD_STYLE}>{pool.kubernetesVersion ?? "-"}</td>
            <td style={TD_STYLE}>{pool.nodeConfigDetails?.size ?? "-"}</td>
            <td style={TD_STYLE}>
              <LifecycleBadge state={pool.lifecycleState} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
