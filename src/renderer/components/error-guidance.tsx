import type * as React from "react";
import type { OciErrorKind, OciRawErrorInfo } from "../sdk/result";
import { Button } from "./freelens-ui";

export interface OciErrorGuidance {
  title: string;
  body: string;
}

// 設計 Decision #15: 4分類(非OKEはこの外側で別途ガイダンス表示)ごとに対処方法を案内する。
export function describeOciError(kind: OciErrorKind): OciErrorGuidance {
  switch (kind) {
    case "auth_missing":
      return {
        title: "OCI credentials not found",
        body:
          "~/.oci/config does not exist and no credentials command is configured. " +
          "Set a credentials command under Preferences → OCI, or provide ~/.oci/config. " +
          "See the plugin README's Prerequisites and Configuration sections for details.",
      };
    case "auth_command":
      return {
        title: "Credentials command execution failed",
        body:
          "Check the credentials command under Preferences → OCI and its output (JSON contract). " +
          "The command's stdout is not shown here to avoid leaking credentials.",
      };
    case "not_authenticated":
      return {
        title: "OCI authentication expired",
        body: "Re-authenticate in a terminal (e.g. `oci session authenticate`), then click Refresh.",
      };
    case "forbidden_or_not_found":
      return {
        title: "OCI API call failed",
        body: "Insufficient permissions or resource not found (404/403). Check the details below.",
      };
    case "internal":
      return {
        title: "An unexpected error occurred",
        body: "This may be a plugin bug. Check the details below and report it.",
      };
    case "not_requested":
      return {
        title: "Not fetched on this page",
        body: "This section is not fetched on the current page.",
      };
    default:
      return {
        title: "OCI API call failed",
        body: "Check the details below.",
      };
  }
}

const RAW_ERROR_STYLE: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "var(--textColorSecondary, #9aa0a6)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

export function RawErrorDetails({ raw }: { raw: OciRawErrorInfo }) {
  return (
    <details style={RAW_ERROR_STYLE}>
      <summary>Show raw error</summary>
      <div>message: {raw.message}</div>
      {raw.statusCode !== undefined && <div>status: {raw.statusCode}</div>}
      {raw.serviceCode && <div>serviceCode: {raw.serviceCode}</div>}
      {raw.opcRequestId && <div>opc-request-id: {raw.opcRequestId}</div>}
      {raw.code !== undefined && raw.code !== null && <div>code: {String(raw.code)}</div>}
      {raw.stderr && <div>stderr: {raw.stderr}</div>}
    </details>
  );
}

const NOTICE_BOX_STYLE: React.CSSProperties = {
  padding: "10px 12px",
  marginBottom: 12,
  border: "1px solid var(--borderColor, #3f4041)",
  borderRadius: 4,
  background: "var(--mainBackground, #1e2124)",
  color: "var(--textColorPrimary, #fff)",
};

/** セクション単位(タブ内の一部データ)のOCI呼び出し失敗表示。他セクションの表示は妨げない。 */
export function SectionError({ kind, raw }: { kind: OciErrorKind; raw: OciRawErrorInfo }) {
  const guidance = describeOciError(kind);
  return (
    <div style={NOTICE_BOX_STYLE}>
      <strong>{guidance.title}</strong>
      <div>{guidance.body}</div>
      <RawErrorDetails raw={raw} />
    </div>
  );
}

export function NonOkeGuidance() {
  return (
    <div style={NOTICE_BOX_STYLE}>
      <strong>This cluster is not linked to OCI</strong>
      <div>
        The K8s Node's providerID is not in OCI Instance OCID format, so the OCI-side cluster could not be identified
        automatically. This page only shows data for OKE (Oracle Container Engine for Kubernetes) clusters.
      </div>
    </div>
  );
}

export interface FatalErrorGuidanceProps {
  errorKind: OciErrorKind;
  raw: OciRawErrorInfo;
  stage: string;
  onRetry: () => void;
}

export function FatalErrorGuidance({ errorKind, raw, stage, onRetry }: FatalErrorGuidanceProps) {
  const guidance = describeOciError(errorKind);
  return (
    <div style={NOTICE_BOX_STYLE}>
      <strong>{guidance.title}</strong>
      <div>{guidance.body}</div>
      <div style={{ fontSize: 12, color: "var(--textColorSecondary, #9aa0a6)" }}>Failed stage: {stage}</div>
      <RawErrorDetails raw={raw} />
      <div style={{ marginTop: 8 }}>
        <Button primary small onClick={onRetry} label="Retry" />
      </div>
    </div>
  );
}
