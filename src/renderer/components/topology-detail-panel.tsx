import type * as React from "react";
import { NODE_KIND_LABEL } from "../match/topology-flow";
import type { TopologyNode } from "../match/topology-graph";
import { ConsoleLinkButton } from "./console-button";
import { Icon } from "./freelens-ui";
import { OcidCopyButton } from "./ocid-copy-button";
import { TD_STYLE, TH_STYLE } from "./table-styles";

const PANEL_STYLE: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  overflow: "auto",
  padding: "12px 14px",
  borderLeft: "1px solid var(--borderColor, #3f4041)",
  background: "var(--mainBackground, #1e2124)",
  color: "var(--textColorPrimary, #fff)",
};

const TITLE_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};

const KIND_STYLE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--textColorSecondary, #9aa0a6)",
};

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
  tableLayout: "fixed",
};

// 件数サマリのように長いラベル(Subnet名)を持つ行があるため、共通THのnowrapを外して折り返す
const LABEL_STYLE: React.CSSProperties = {
  ...TH_STYLE,
  width: 120,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  verticalAlign: "top",
};

const VALUE_STYLE: React.CSSProperties = {
  ...TD_STYLE,
  whiteSpace: "pre-line",
  wordBreak: "break-all",
};

export interface TopologyDetailPanelProps {
  node: TopologyNode;
  onClose: () => void;
}

/** 選択ノードの詳細。項目はグラフ導出層のdetail(SSoT)をそのまま並べる。 */
export function TopologyDetailPanel({ node, onClose }: TopologyDetailPanelProps) {
  return (
    <div style={PANEL_STYLE}>
      <div style={TITLE_ROW_STYLE}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={KIND_STYLE}>{NODE_KIND_LABEL[node.kind]}</div>
          <div style={{ fontSize: 14, fontWeight: "bold", wordBreak: "break-all" }}>{node.label}</div>
        </div>
        <Icon material="close" tooltip="Close" interactive small onClick={onClose} />
      </div>
      <table style={TABLE_STYLE}>
        <tbody>
          {node.detail.map((row) => (
            <tr key={`${row.label} ${row.value}`}>
              <th style={LABEL_STYLE}>{row.label}</th>
              <td style={VALUE_STYLE}>
                {row.value}
                {row.role === "ocid" && <OcidCopyButton ocid={row.value} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {node.consoleUrl && (
        <div style={{ marginTop: 12 }}>
          <ConsoleLinkButton url={node.consoleUrl} />
        </div>
      )}
    </div>
  );
}
