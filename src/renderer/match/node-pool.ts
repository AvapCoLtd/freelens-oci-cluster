import type { OciInstance, OciNodePoolSummary } from "../sdk/types";

const NODEPOOL_OCID_PREFIX = "ocid1.nodepool.";

/**
 * InstanceのCreatedByタグからノードプールOCIDを取り出す(アンカー解決と同じ検証済み前提)。
 * virtual node / self-managed nodeはCreatedByがnodepool形式にならないためundefined(プール列は「-」表示)。
 */
export function nodePoolIdOfInstance(instance: OciInstance | undefined): string | undefined {
  const createdBy = instance?.definedTags?.["Oracle-Tags"]?.CreatedBy;
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
