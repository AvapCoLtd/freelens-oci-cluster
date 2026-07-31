import type * as React from "react";
import type { OciErrorKind, OciRawErrorInfo } from "../oci/result";
import { Button } from "./freelens-ui";

export interface OciErrorGuidance {
  title: string;
  body: string;
}

// 非OKEはこの外側で別途ガイダンス表示。
export function describeOciError(kind: OciErrorKind): OciErrorGuidance {
  switch (kind) {
    case "command_launch_failed":
      return {
        title: "Could not start the oci command",
        body:
          "Check the oci command under Preferences → OCI: leave it blank to run `oci` from PATH, " +
          "or set an oci-compatible command such as `wsl oci`. " +
          "The details below show why the command could not be started.",
      };
    case "not_authenticated":
      return {
        title: "The oci command is not authenticated",
        body:
          "The command ran but could not authenticate (no config file, unknown profile, or an expired session). " +
          "Check the OCI configuration and session of the environment that runs it — for example run the same " +
          "command in a terminal, or re-authenticate with `oci session authenticate` — then click Refresh.",
      };
    case "forbidden_or_not_found":
      return {
        title: "OCI command failed",
        body:
          "Insufficient permissions or resource not found (OCI reports both as 404). " +
          "Check the details below for which resource was refused.",
      };
    case "command_incompatible":
      return {
        title: "The oci command rejected the arguments",
        body:
          "Check whether the compatible command under Preferences → OCI forwards its arguments as-is, " +
          "or whether the oci CLI needs to be updated.",
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
        title: "OCI command failed",
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
      <summary>Show details (exit code, stderr)</summary>
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
