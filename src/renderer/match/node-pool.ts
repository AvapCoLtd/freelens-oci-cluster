import type { OciResult } from "../oci/result";
import type { OciInstance, OciNodePool, OciNodePoolSummary } from "../oci/types";

const NODEPOOL_OCID_PREFIX = "ocid1.nodepool.";

/**
 * InstanceのCreatedByタグからノードプールOCIDを取り出す(アンカー解決と同じ検証済み前提)。
 * virtual node / self-managed nodeはCreatedByがnodepool形式にならないためundefined(プール列は「-」表示)。
 */
export function nodePoolIdOfInstance(instance: OciInstance | undefined): string | undefined {
  const createdBy = instance?.["defined-tags"]?.["Oracle-Tags"]?.CreatedBy;
  if (typeof createdBy !== "string" || !createdBy.startsWith(NODEPOOL_OCID_PREFIX)) return undefined;
  return createdBy;
}

export function nodePoolNameOfInstance(
  pools: OciNodePoolSummary[],
  instance: OciInstance | undefined,
): string | undefined {
  const poolId = nodePoolIdOfInstance(instance);
  if (!poolId) return undefined;
  return pools.find((pool) => pool.id === poolId)?.name;
}

export function nodePoolIdsByInstance(
  details: Record<string, OciResult<OciNodePool>> | undefined,
): Map<string, string> {
  const byInstance = new Map<string, string>();
  for (const [poolId, result] of Object.entries(details ?? {})) {
    if (!result.ok) continue;
    for (const node of result.data.nodes ?? []) {
      if (node.id) byInstance.set(node.id, poolId);
    }
  }
  return byInstance;
}

export function resolveNodePoolId(instance: OciInstance, byInstance: ReadonlyMap<string, string>): string | undefined {
  return byInstance.get(instance.id) ?? nodePoolIdOfInstance(instance);
}
