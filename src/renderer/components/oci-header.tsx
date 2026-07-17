import type * as React from "react";
import type { OciHeaderInfo } from "../match/header-info";
import { ConsoleButton } from "./console-button";
import { Button } from "./freelens-ui";
import { OcidCopyButton } from "./ocid-copy-button";
import { LifecycleBadge } from "./status-badge";

const ERROR_TEXT_STYLE: React.CSSProperties = {
  color: "var(--colorError, #e05a5a)",
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "12px 16px",
  borderBottom: "1px solid var(--borderColor, #3f4041)",
  flexShrink: 0,
};

const TITLE_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 16,
  fontWeight: "bold",
  color: "var(--textColorPrimary, #fff)",
};

const META_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  fontSize: 12,
  color: "var(--textColorSecondary, #9aa0a6)",
};

export interface OciHeaderProps {
  info: OciHeaderInfo;
  fetching: boolean;
  onRefresh: () => void;
  extras?: React.ReactNode;
}

export function OciHeader({ info, fetching, onRefresh, extras }: OciHeaderProps) {
  return (
    <div style={HEADER_STYLE}>
      <div style={TITLE_ROW_STYLE}>
        <span style={TITLE_STYLE}>{info.clusterName}</span>
        {info.lifecycleState && <LifecycleBadge state={info.lifecycleState} />}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>{extras}</span>
        <Button primary small disabled={fetching} onClick={onRefresh} label={fetching ? "Refreshing..." : "Refresh"} />
        {info.clusterOcid && info.region && (
          <ConsoleButton type="cluster" ocid={info.clusterOcid} region={info.region} />
        )}
      </div>
      <div style={META_ROW_STYLE}>
        {info.kubernetesVersion && <span>K8s: {info.kubernetesVersion}</span>}
        {info.clusterOcid && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            OCID: {info.clusterOcid}
            <OcidCopyButton ocid={info.clusterOcid} />
          </span>
        )}
        {info.fetchedAt && <span>Last updated: {new Date(info.fetchedAt).toLocaleString()}</span>}
        {info.clusterInfoFailed && <span style={ERROR_TEXT_STYLE}>Failed to fetch cluster info</span>}
      </div>
    </div>
  );
}
