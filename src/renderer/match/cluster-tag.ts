import type { OciTagged } from "../oci/types";

/**
 * クラスタを指すタグの出所。意味が違うため書き分ける。
 * - system-tag: `orcl-containerengine.Cluster`。OKEが今そのリソースを管理しているクラスタ
 * - created-by: `Oracle-Tags.CreatedBy`。リソースを作ったクラスタ(作成時に一度付くだけで、管理が移っても変わらない)
 */
export type ClusterTagSource = "system-tag" | "created-by";

export const CLUSTER_TAG_SOURCES: readonly ClusterTagSource[] = ["system-tag", "created-by"];

export interface ClusterTagMismatch {
  source: ClusterTagSource;
  /** タグが指すクラスタのOCID(名前解決・削除済み判定はしない) */
  clusterId: string;
}

const CLUSTER_OCID_PREFIX = "ocid1.cluster.";

function tagValue(tags: OciTagged["defined-tags"], namespace: string, key: string): string | undefined {
  const value = tags?.[namespace]?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function clusterIdOf(resource: OciTagged, source: ClusterTagSource): string | undefined {
  if (source === "system-tag") return tagValue(resource["system-tags"], "orcl-containerengine", "Cluster");
  // CreatedByはクラスタOCIDのほか、ノードプールOCIDや人名(`default/xxx@...`)も入る。クラスタ以外は比較対象にしない。
  const createdBy = tagValue(resource["defined-tags"], "Oracle-Tags", "CreatedBy");
  return createdBy?.startsWith(CLUSTER_OCID_PREFIX) ? createdBy : undefined;
}

/** InstanceはCreatedByがノードプールを指すため、呼び出し側がsourcesを`["system-tag"]`に絞る。 */
export function clusterTagMismatchesOf(
  resource: OciTagged | undefined,
  currentClusterId: string | undefined,
  sources: readonly ClusterTagSource[] = CLUSTER_TAG_SOURCES,
): ClusterTagMismatch[] {
  if (!resource || !currentClusterId) return [];
  const mismatches: ClusterTagMismatch[] = [];
  for (const source of sources) {
    const clusterId = clusterIdOf(resource, source);
    if (clusterId && clusterId !== currentClusterId) mismatches.push({ source, clusterId });
  }
  return mismatches;
}

export const CLUSTER_TAG_MISMATCH_LABEL: Record<ClusterTagSource, string> = {
  "system-tag": "Managed by another cluster (system tag)",
  "created-by": "Created by another cluster (CreatedBy tag)",
};

export const CLUSTER_TAG_KEY: Record<ClusterTagSource, string> = {
  "system-tag": "orcl-containerengine.Cluster",
  "created-by": "Oracle-Tags.CreatedBy",
};

export function clusterTagMismatchText(mismatch: ClusterTagMismatch): string {
  return `${CLUSTER_TAG_MISMATCH_LABEL[mismatch.source]}: ${mismatch.clusterId}`;
}
