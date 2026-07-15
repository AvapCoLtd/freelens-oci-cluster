import type { CliErrorKind, CliRawErrorInfo } from "../match/classify-cli-error";
import { runOci } from "./run";
import type { OciInstanceSummary, OciNodePoolSummary } from "./types";

const NODEPOOL_OCID_PREFIX = "ocid1.nodepool.";

export type AnchorResult =
  | { kind: "non_oke" }
  | { kind: "resolved"; instanceId: string; clusterId: string; compartmentId: string }
  | { kind: "cli_error"; stage: "instance_get" | "node_pool_get"; errorKind: CliErrorKind; raw: CliRawErrorInfo }
  | { kind: "unexpected_shape"; stage: "instance_get" | "node_pool_get"; detail: string };

interface InstanceGetResponse {
  data: OciInstanceSummary;
}

interface NodePoolGetResponse {
  data: OciNodePoolSummary;
}

/**
 * アンカー解決(設計 CLI呼び出し一覧 #1): Instance OCID → CreatedBy(nodepool OCID) → cluster-id/compartment-id。
 * 呼び出し元が事前にproviderIDのOKE形式チェックを済ませている前提(非OKEはここに来ない)。
 */
export async function resolveAnchor(instanceId: string, overrideCommand: string): Promise<AnchorResult> {
  const instanceResult = await runOci<InstanceGetResponse>(
    ["compute", "instance", "get", "--instance-id", instanceId],
    overrideCommand,
  );
  if (!instanceResult.ok) {
    return { kind: "cli_error", stage: "instance_get", errorKind: instanceResult.kind, raw: instanceResult.raw };
  }

  const createdBy = instanceResult.data.data["defined-tags"]?.["Oracle-Tags"]?.CreatedBy;
  if (!createdBy?.startsWith(NODEPOOL_OCID_PREFIX)) {
    return {
      kind: "unexpected_shape",
      stage: "instance_get",
      detail: `defined-tags."Oracle-Tags".CreatedBy が想定形式(${NODEPOOL_OCID_PREFIX}...)ではありません: ${createdBy ?? "(なし)"}`,
    };
  }

  const nodePoolResult = await runOci<NodePoolGetResponse>(
    ["ce", "node-pool", "get", "--node-pool-id", createdBy],
    overrideCommand,
  );
  if (!nodePoolResult.ok) {
    return { kind: "cli_error", stage: "node_pool_get", errorKind: nodePoolResult.kind, raw: nodePoolResult.raw };
  }

  const clusterId = nodePoolResult.data.data["cluster-id"];
  const compartmentId = nodePoolResult.data.data["compartment-id"];
  if (!clusterId || !compartmentId) {
    return {
      kind: "unexpected_shape",
      stage: "node_pool_get",
      detail: "node-pool get 応答に cluster-id または compartment-id がありません",
    };
  }

  return { kind: "resolved", instanceId, clusterId, compartmentId };
}
