// "command_launch_failed"は指定コマンドの起動失敗(不在・権限等)。設定の誤りであってバグではないため
// "internal"に混ぜない(案内文言と対処が別)。
// "command_incompatible"は利用者が設定した互換コマンドが引数を転送しない/サブコマンドを知らない場合。
// "internal"はoci実行自体でなく、出力の後処理(結合等)で例外が出た場合に呼び出し元が付与する。
// "not_requested"はそのページが要求していないセクションのplaceholderに呼び出し元が付与する。
// "loading"は取得中セクションのplaceholder。失敗ではないため表示側でエラー枠に混ぜてはならない。
// "resource_not_found"は参照先のOCIリソース自身のgetが"forbidden_or_not_found"を返し、実体なしと
// 確定した場合。取得失敗ではなく残骸の観測結果のため、表示側でエラー枠・欠落バナーに混ぜてはならない。
export type OciErrorKind =
  | "command_launch_failed"
  | "not_authenticated"
  | "forbidden_or_not_found"
  | "other"
  | "command_incompatible"
  | "internal"
  | "not_requested"
  | "loading"
  | "resource_not_found";

export interface OciRawErrorInfo {
  message: string;
  statusCode?: number;
  serviceCode?: string;
  opcRequestId?: string;
  code?: string | number | null;
  stderr?: string;
}

export type OciResult<T> = { ok: true; data: T } | { ok: false; kind: OciErrorKind; raw: OciRawErrorInfo };

/** そのセクションがまだ取得中か(段階表示で「空」と「未取得」を区別する)。 */
export function isPending<T>(result: OciResult<T> | undefined): boolean {
  return !!result && !result.ok && result.kind === "loading";
}

/** 参照先のOCIリソースが実在しないと確定したか(取得失敗ではない)。 */
export function isResourceNotFound(result: OciResult<unknown> | undefined): boolean {
  return !!result && !result.ok && result.kind === "resource_not_found";
}
