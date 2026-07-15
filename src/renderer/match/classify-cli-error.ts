// "internal"はoci CLI呼び出し自体でなく、応答の後処理(パース等)で例外が出た場合に呼び出し元が付与する。
// "not_requested"はそのページが要求していないセクションのplaceholderに呼び出し元が付与する。
// classifyCliError はCLIプロセスの失敗のみを分類するため、どちらも返すことはない。
export type CliErrorKind =
  | "enoent"
  | "not_authenticated"
  | "forbidden_or_not_found"
  | "other"
  | "internal"
  | "not_requested";

export interface CliRawErrorInfo {
  code?: string | number | null;
  errno?: number | null;
  message: string;
  stderr: string;
}

const HTTP_STATUS_403_OR_404 = /"status":\s*(403|404)\b/;

/**
 * oci CLI 呼び出し失敗の分類(非OKE判定はこの前段で別途行う)。
 * NotAuthenticatedはOCIサービスエラーのコード名で、message/stderrいずれかに出現する。
 * OCI ServiceErrorはJSON本文にHTTPステータスを`"status": <数値>`として出力する(実機確認済み)。
 */
export function classifyCliError(raw: CliRawErrorInfo): CliErrorKind {
  if (raw.code === "ENOENT") return "enoent";
  if (raw.message.includes("NotAuthenticated") || raw.stderr.includes("NotAuthenticated")) return "not_authenticated";
  if (HTTP_STATUS_403_OR_404.test(raw.stderr) || HTTP_STATUS_403_OR_404.test(raw.message)) {
    return "forbidden_or_not_found";
  }
  return "other";
}
