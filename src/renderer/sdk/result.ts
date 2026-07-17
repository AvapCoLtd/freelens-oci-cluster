// "internal"はSDK呼び出し自体でなく、応答の後処理(結合等)で例外が出た場合に呼び出し元が付与する。
// "not_requested"はそのページが要求していないセクションのplaceholderに呼び出し元が付与する。
export type OciErrorKind =
  | "auth_missing"
  | "auth_command"
  | "not_authenticated"
  | "forbidden_or_not_found"
  | "other"
  | "internal"
  | "not_requested";

// stderrは認証情報コマンド失敗時のみ入る。認証情報コマンドのstdoutは鍵そのもののため、
// このオブジェクトに入れてはならない(表示・ログ経由の漏洩防止)。
export interface OciRawErrorInfo {
  message: string;
  statusCode?: number;
  serviceCode?: string;
  opcRequestId?: string;
  code?: string | number | null;
  stderr?: string;
}

export type OciResult<T> = { ok: true; data: T } | { ok: false; kind: OciErrorKind; raw: OciRawErrorInfo };
