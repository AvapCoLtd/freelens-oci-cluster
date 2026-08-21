import type * as React from "react";
import type { ClusterOciData } from "../fetch/fetch";
import type { TopologySection } from "../match/page-sections";
import { TOPOLOGY_SECTION_LABEL, TOPOLOGY_SECTIONS } from "../match/page-sections";
import { EDGE_KIND_LABEL, NODE_KIND_LABEL } from "../match/topology-flow";
import type { TopologyEdgeKind, TopologyMissing, TopologyNodeKind } from "../match/topology-graph";
import type { OciErrorKind, OciRawErrorInfo, OciResult } from "../oci/result";
import { describeOciError, RawErrorDetails } from "./error-guidance";

const BANNER_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "8px 12px",
  borderBottom: "1px solid var(--borderColor, #3f4041)",
  background: "var(--mainBackground, #1e2124)",
  color: "var(--textColorPrimary, #fff)",
  fontSize: 12,
};

const LINE_STYLE: React.CSSProperties = { color: "var(--textColorSecondary, #9aa0a6)" };

interface SectionFailure {
  kind: OciErrorKind;
  raw: OciRawErrorInfo;
}

// 実体なし(resource_not_found)は孤立PVの表示に回るため、セクションの代表失敗には選ばない。
function failureOf(result: OciResult<unknown> | undefined): SectionFailure | undefined {
  if (!result || result.ok || result.kind === "loading" || result.kind === "resource_not_found") return undefined;
  return { kind: result.kind, raw: result.raw };
}

function firstFailure(record: Record<string, OciResult<unknown>>): SectionFailure | undefined {
  for (const id of Object.keys(record).sort()) {
    const failure = failureOf(record[id]);
    if (failure) return failure;
  }
  return undefined;
}

/**
 * セクションごとの代表的な失敗内容。
 * per-OCID Mapは先頭1件を代表に出す(全件を並べても対処は同じで、原因はstderrで足りる)。
 * list自体の失敗はエントリが生まれないため、ここでは拾えず種別名の列挙だけになる。
 */
function failureOfSection(data: ClusterOciData, section: TopologySection): SectionFailure | undefined {
  switch (section) {
    case "cluster":
    case "taggedResources":
    case "instances":
    case "nodePools":
    case "lbs":
    case "nlbs":
    case "wafs":
    case "volumes":
      return failureOf(data[section]);
    case "fileSystems":
      return firstFailure(data.fileSystems);
    case "volumeBackupPolicies":
      return firstFailure(data.volumeBackupPolicies);
    case "fssSnapshotPolicies":
      return firstFailure(data.fssSnapshotPolicies);
    case "vcn":
      return firstFailure(data.vcns);
    case "subnets":
      return firstFailure(data.subnets);
    case "routeTables":
      return firstFailure(data.routeTables);
    case "securityLists":
      return firstFailure(data.securityLists);
    case "nsgs":
      return firstFailure(data.nsgs);
    case "gateways":
      return firstFailure(data.gateways);
    case "managedCerts":
      return firstFailure(data.managedCerts);
    case "dnsChecks":
      return firstFailure(data.dnsChecks);
    case "dnsZones":
      return failureOf(data.dnsZones);
  }
}

function labelsOf(missing: readonly TopologyMissing[], target: "node" | "edge"): string[] {
  return missing
    .filter((entry) => entry.target === target)
    .map((entry) =>
      target === "node"
        ? NODE_KIND_LABEL[entry.kind as TopologyNodeKind]
        : EDGE_KIND_LABEL[entry.kind as TopologyEdgeKind],
    );
}

export interface TopologyMissingBannerProps {
  missing: readonly TopologyMissing[];
  data: ClusterOciData;
}

/** 取得失敗で図から抜けた種別を図の上部に列挙する。失敗は確定扱いで、描画自体はブロックしない。 */
export function TopologyMissingBanner({ missing, data }: TopologyMissingBannerProps) {
  if (missing.length === 0) return null;
  const nodeLabels = labelsOf(missing, "node");
  const edgeLabels = labelsOf(missing, "edge");
  const failedSections = TOPOLOGY_SECTIONS.filter((section) =>
    missing.some((entry) => entry.sections.includes(section)),
  );
  return (
    <div style={BANNER_STYLE}>
      <strong>Some resources are missing from the diagram</strong>
      {nodeLabels.length > 0 && <div style={LINE_STYLE}>Missing nodes: {nodeLabels.join(", ")}</div>}
      {edgeLabels.length > 0 && <div style={LINE_STYLE}>Missing edges: {edgeLabels.join(", ")}</div>}
      {failedSections.map((section) => {
        const failure = failureOfSection(data, section);
        return (
          <div key={section} style={LINE_STYLE}>
            {TOPOLOGY_SECTION_LABEL[section]}: {failure ? describeOciError(failure.kind).title : "Failed to fetch"}
            {failure && <RawErrorDetails raw={failure.raw} />}
          </div>
        );
      })}
    </div>
  );
}
