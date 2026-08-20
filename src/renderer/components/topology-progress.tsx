import type * as React from "react";
import { TOPOLOGY_SECTION_LABEL } from "../match/page-sections";
import type { TopologyK8sLoaded } from "../store/k8s-adapter";
import type { TopologySectionProgress } from "../store/oci-cluster-store";
import { Spinner } from "./spinner";

const CENTER_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  gap: 8,
  color: "var(--textColorPrimary, #fff)",
};

const COUNT_STYLE: React.CSSProperties = { fontSize: 13 };

const WAITING_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "var(--textColorSecondary, #9aa0a6)",
  maxWidth: 520,
  textAlign: "center",
};

const K8S_LABEL: Record<keyof TopologyK8sLoaded, string> = {
  nodes: "K8s Nodes",
  services: "K8s Services",
  persistentVolumes: "K8s PersistentVolumes",
};

const K8S_UNITS = ["nodes", "services", "persistentVolumes"] as const;

export interface TopologyProgressProps {
  sections: readonly TopologySectionProgress[];
  k8s: TopologyK8sLoaded;
}

/**
 * 図は全必要セクション確定で一括描画するため、待たせている中身を明示する(無言スピナーにしない)。
 * 分母はOCIの型別listにK8s側3ストアを加えた数。
 */
export function TopologyProgress({ sections, k8s }: TopologyProgressProps) {
  const waiting = [
    ...sections.filter((entry) => entry.status === "loading").map((entry) => TOPOLOGY_SECTION_LABEL[entry.section]),
    ...K8S_UNITS.filter((unit) => !k8s[unit]).map((unit) => K8S_LABEL[unit]),
  ];
  const total = sections.length + K8S_UNITS.length;
  return (
    <div style={CENTER_STYLE}>
      <Spinner />
      <div style={COUNT_STYLE}>
        Loading topology: {total - waiting.length}/{total} settled
      </div>
      {waiting.length > 0 && <div style={WAITING_STYLE}>Waiting for: {waiting.join(", ")}</div>}
    </div>
  );
}
