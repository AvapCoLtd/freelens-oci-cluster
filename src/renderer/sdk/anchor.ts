import { callOci } from "./fetch";
import type { OciErrorKind, OciRawErrorInfo } from "./result";

const NODEPOOL_OCID_PREFIX = "ocid1.nodepool.";

export type AnchorResult =
  | { kind: "non_oke" }
  | { kind: "resolved"; instanceId: string; clusterId: string; compartmentId: string }
  | { kind: "auth_error"; stage: "instance_get" | "node_pool_get"; errorKind: OciErrorKind; raw: OciRawErrorInfo }
  | { kind: "unexpected_shape"; stage: "instance_get" | "node_pool_get"; detail: string };

/**
 * アンカー解決(設計 CLI呼び出し一覧 #1): Instance OCID → CreatedBy(nodepool OCID) → cluster-id/compartment-id。
 * 呼び出し元が事前にproviderIDのOKE形式チェックを済ませている前提(非OKEはここに来ない)。
 */
export async function resolveAnchor(instanceId: string, authCommand: string): Promise<AnchorResult> {
  const instanceResult = await callOci(
    authCommand,
    async (clients) => (await clients.compute.getInstance({ instanceId })).instance,
  );
  if (!instanceResult.ok) {
    return { kind: "auth_error", stage: "instance_get", errorKind: instanceResult.kind, raw: instanceResult.raw };
  }

  const createdBy = instanceResult.data.definedTags?.["Oracle-Tags"]?.CreatedBy;
  if (typeof createdBy !== "string" || !createdBy.startsWith(NODEPOOL_OCID_PREFIX)) {
    return {
      kind: "unexpected_shape",
      stage: "instance_get",
      detail: `definedTags."Oracle-Tags".CreatedBy が想定形式(${NODEPOOL_OCID_PREFIX}...)ではありません: ${typeof createdBy === "string" ? createdBy : "(なし)"}`,
    };
  }

  const nodePoolResult = await callOci(
    authCommand,
    async (clients) => (await clients.containerEngine.getNodePool({ nodePoolId: createdBy })).nodePool,
  );
  if (!nodePoolResult.ok) {
    return { kind: "auth_error", stage: "node_pool_get", errorKind: nodePoolResult.kind, raw: nodePoolResult.raw };
  }

  const { clusterId, compartmentId } = nodePoolResult.data;
  if (!clusterId || !compartmentId) {
    return {
      kind: "unexpected_shape",
      stage: "node_pool_get",
      detail: "NodePool応答に clusterId または compartmentId がありません",
    };
  }

  return { kind: "resolved", instanceId, clusterId, compartmentId };
}
