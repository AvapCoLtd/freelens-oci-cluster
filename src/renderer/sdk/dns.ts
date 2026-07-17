import { lookup } from "node:dns/promises";
import type { OciResult } from "./result";

// 未解決(NXDOMAIN等)は「観測結果が空」という正常系として返す。
const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA"]);

/**
 * ホスト名のIPv4解決(DNS突合セクション用)。
 * resolve4(DNSサーバへの直接クエリ)はWindowsのVPN/リゾルバ構成でECONNREFUSEDになるため使わない(実機で遭遇)。
 * lookup(OSのgetaddrinfo)は実際にアプリが接続時に使う解決経路そのもので、突合の意味にも合う。
 * スプリットDNS環境では外部からの解決と異なることがある(UI側に注意書きを出す)。
 */
export async function resolveHostIps(host: string): Promise<OciResult<string[]>> {
  try {
    const records = await lookup(host, { all: true, family: 4 });
    return { ok: true, data: [...new Set(records.map((record) => record.address))] };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && NOT_FOUND_CODES.has(code)) return { ok: true, data: [] };
    return { ok: false, kind: "other", raw: { message: `DNS resolution failed: ${String(error)}`, code } };
  }
}
