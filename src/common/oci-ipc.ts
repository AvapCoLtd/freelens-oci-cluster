export const EXEC_OCI_CHANNEL = "exec-oci";
export const LOOKUP_HOST_IPS_CHANNEL = "lookup-host-ips";

export type OciCliFailure =
  | { reason: "launch"; message: string; code?: string }
  | { reason: "timeout"; timeoutMs: number; stderr?: string }
  | { reason: "output_limit"; maxBytes: number; stderr?: string }
  | { reason: "exit"; exitCode: number; stdout: string; stderr: string };

export type OciExecResult = { ok: true; stdout: string; stderr: string } | { ok: false; failure: OciCliFailure };

/** 未解決(NXDOMAIN等)は失敗でなく、空のaddressesで返る。 */
export type HostLookupResult = { ok: true; addresses: string[] } | { ok: false; message: string; code?: string };
