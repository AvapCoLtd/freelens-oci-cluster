import { ociCommands } from "../cli/command-defs";
import { runOciCommand } from "../cli/run";
import type { OciErrorKind, OciRawErrorInfo } from "../oci/result";

const NODEPOOL_OCID_PREFIX = "ocid1.nodepool.";

export type AnchorResult =
  | { kind: "non_oke" }
  | { kind: "resolved"; instanceId: string; clusterId: string; compartmentId: string }
  | { kind: "auth_error"; stage: "instance_get" | "node_pool_get"; errorKind: OciErrorKind; raw: OciRawErrorInfo }
  | { kind: "unexpected_shape"; stage: "instance_get" | "node_pool_get"; detail: string };

/**
 * アンカー解決(#1): Instance OCID → CreatedBy(nodepool OCID) → cluster-id/compartment-id。
 * 呼び出し元が事前にproviderIDのOKE形式チェックを済ませている前提(非OKEはここに来ない)。
 */
export async function resolveAnchor(instanceId: string, ociCliCommand: string): Promise<AnchorResult> {
  const instanceResult = await runOciCommand(ociCommands.instanceGet, { instanceId }, ociCliCommand);
  if (!instanceResult.ok) {
    return { kind: "auth_error", stage: "instance_get", errorKind: instanceResult.kind, raw: instanceResult.raw };
  }

  const createdBy = instanceResult.data["defined-tags"]?.["Oracle-Tags"]?.CreatedBy;
  if (typeof createdBy !== "string" || !createdBy.startsWith(NODEPOOL_OCID_PREFIX)) {
    return {
      kind: "unexpected_shape",
      stage: "instance_get",
      detail: `defined-tags."Oracle-Tags".CreatedBy is not in the expected format (${NODEPOOL_OCID_PREFIX}...): ${typeof createdBy === "string" ? createdBy : "(None)"}`,
    };
  }

  const nodePoolResult = await runOciCommand(ociCommands.nodePoolGet, { nodePoolId: createdBy }, ociCliCommand);
  if (!nodePoolResult.ok) {
    return { kind: "auth_error", stage: "node_pool_get", errorKind: nodePoolResult.kind, raw: nodePoolResult.raw };
  }

  const clusterId = nodePoolResult.data["cluster-id"];
  const compartmentId = nodePoolResult.data["compartment-id"];
  if (!clusterId || !compartmentId) {
    return {
      kind: "unexpected_shape",
      stage: "node_pool_get",
      detail: "NodePool response is missing cluster-id or compartment-id",
    };
  }

  return { kind: "resolved", instanceId, clusterId, compartmentId };
}
