import { lookup } from "node:dns/promises";
import type { HostLookupResult } from "../common/oci-ipc";

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA"]);

// resolve4にしない: WindowsのVPN/リゾルバ構成でECONNREFUSEDになる。
export async function lookupHostIps(host: string): Promise<HostLookupResult> {
  try {
    const records = await lookup(host, { all: true, family: 4 });
    return { ok: true, addresses: [...new Set(records.map((record) => record.address))] };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && NOT_FOUND_CODES.has(code)) return { ok: true, addresses: [] };
    return { ok: false, message: String(error), code: typeof code === "string" ? code : undefined };
  }
}
