import type { HostLookupResult } from "../../common/oci-ipc";
import type { OciResult } from "../oci/result";
import { invokeLookupHostIps } from "../oci-ipc";

/** 未解決は失敗でなく、空配列で返る。 */
export async function resolveHostIps(host: string): Promise<OciResult<string[]>> {
  const result = await invokeLookupHostIps(host).catch(
    (error: unknown): HostLookupResult => ({ ok: false, message: String(error) }),
  );
  if (result.ok) return { ok: true, data: result.addresses };
  return { ok: false, kind: "other", raw: { message: `DNS resolution failed: ${result.message}`, code: result.code } };
}
