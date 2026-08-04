import { isPending, type OciResult } from "../oci/result";

/**
 * 一覧(1段階目)の表示可否。取得中セクションが1つでもあれば行を出さない。
 * 失敗は「確定」として扱う(1セクションの権限不足で他の表が永久に出ないのを防ぐ)。
 */
export function sectionsReady(...results: OciResult<unknown>[]): boolean {
  return results.every((result) => !isPending(result));
}

/** per-OCID Recordが必要なOCIDを全て載せたか(表の行内容が後から生えるのを防ぐ)。 */
export function entriesReady(record: Record<string, OciResult<unknown>>, ids: readonly string[]): boolean {
  return ids.every((id) => record[id] !== undefined);
}
