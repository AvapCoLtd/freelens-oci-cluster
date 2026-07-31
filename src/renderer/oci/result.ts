// "command_launch_failed"は指定コマンドの起動失敗(不在・権限等)。設定の誤りであってバグではないため
// "internal"に混ぜない(案内文言と対処が別)。
// "command_incompatible"は利用者が設定した互換コマンドが引数を転送しない/サブコマンドを知らない場合。
// "internal"はoci実行自体でなく、出力の後処理(結合等)で例外が出た場合に呼び出し元が付与する。
// "not_requested"はそのページが要求していないセクションのplaceholderに呼び出し元が付与する。
export type OciErrorKind =
  | "command_launch_failed"
  | "not_authenticated"
  | "forbidden_or_not_found"
  | "other"
  | "command_incompatible"
  | "internal"
  | "not_requested";

export interface OciRawErrorInfo {
  message: string;
  statusCode?: number;
  serviceCode?: string;
  opcRequestId?: string;
  code?: string | number | null;
  stderr?: string;
}

export type OciResult<T> = { ok: true; data: T } | { ok: false; kind: OciErrorKind; raw: OciRawErrorInfo };
