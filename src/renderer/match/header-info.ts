import type { OciClusterViewState } from "../store/oci-cluster-store";
import { extractRegionFromOcid } from "./ocid-region";

export interface OciHeaderInfo {
  clusterName: string;
  lifecycleState?: string;
  kubernetesVersion?: string;
  clusterOcid?: string;
  region?: string;
  fetchedAt?: number;
  clusterInfoFailed?: boolean;
}

/** state(取得中/非OKE/致命エラーを含む)からヘッダ表示用の情報を組み立てる。 */
export function buildHeaderInfo(state: OciClusterViewState, catalogName: string | undefined): OciHeaderInfo {
  const fallbackName = catalogName ?? "(cluster name unknown)";
  if (state.status !== "loaded") {
    return { clusterName: fallbackName };
  }
  const region = extractRegionFromOcid(state.anchor.clusterId);
  if (!state.data.cluster.ok) {
    return {
      clusterName: fallbackName,
      clusterOcid: state.anchor.clusterId,
      region,
      fetchedAt: state.fetchedAt,
      clusterInfoFailed: true,
    };
  }
  return {
    clusterName: state.data.cluster.data.name ?? fallbackName,
    lifecycleState: state.data.cluster.data.lifecycleState,
    kubernetesVersion: state.data.cluster.data.kubernetesVersion,
    clusterOcid: state.data.cluster.data.id,
    region,
    fetchedAt: state.fetchedAt,
  };
}
