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
        title: "OCI 認証情報が見つかりません",
        body:
          "~/.oci/config が存在せず、認証情報コマンドも未設定です。" +
          "FreeLens の Preferences 内「OCI」で認証情報コマンドを設定するか、~/.oci/config を用意してください。" +
          "詳しくはプラグイン README の「前提条件」「設定」を参照してください。",
      };
    case "auth_command":
      return {
        title: "認証情報コマンドの実行に失敗しました",
        body:
          "Preferences 内「OCI」の認証情報コマンドと、その出力(JSON契約)を確認してください。" +
          "漏洩防止のため、コマンドの標準出力はここには表示されません。",
      };
    case "not_authenticated":
      return {
        title: "OCI 認証が切れています",
        body: "ターミナルで `oci session authenticate` 等で再認証したのち、［更新］をクリックしてください。",
      };
    case "forbidden_or_not_found":
      return {
        title: "OCI API の呼び出しに失敗しました",
        body: "権限不足またはリソースが見つかりません(404/403)。下の詳細を確認してください。",
      };
    case "internal":
      return {
        title: "予期しないエラーが発生しました",
        body: "プラグインのバグの可能性があります。下の詳細を確認のうえ報告してください。",
      };
    case "not_requested":
      return {
        title: "このページでは取得対象外です",
        body: "このセクションは現在のページでは取得していません。",
      };
    default:
      return {
        title: "OCI API の呼び出しに失敗しました",
        body: "下の詳細を確認してください。",
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
      <summary>生エラーを表示</summary>
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
      <strong>このクラスタは OCI 連携対象外です</strong>
      <div>
        K8s Node の providerID が OCI Instance OCID 形式ではないため、OCI 側クラスタを自動特定できませんでした。
        OKE(Oracle Container Engine for Kubernetes)クラスタでのみ本ページのデータが表示されます。
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
      <div style={{ fontSize: 12, color: "var(--textColorSecondary, #9aa0a6)" }}>失敗段階: {stage}</div>
      <RawErrorDetails raw={raw} />
      <div style={{ marginTop: 8 }}>
        <Button primary small onClick={onRetry} label="再試行" />
      </div>
    </div>
  );
}
