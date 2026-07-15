import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import type { OciPage } from "../match/page-sections";
import { ociClusterStore } from "../store/oci-cluster-store";

// ページが表示のため直接購読するstoreのみ登録する。ociClusterStore側のアンカー解決(nodesStore.loadAll())は
// loadAllを都度呼ぶ方式でsubscribeに依存しないため、各ページはここに列挙したstoreだけで足りる。
function subscribeTargetsForPage(page: OciPage): Array<{ subscribe: () => () => void }> {
  switch (page) {
    case "nodes":
      return [Renderer.K8sApi.nodesStore];
    case "service-lb":
      return [Renderer.K8sApi.serviceStore];
    case "pv-storage":
      return [Renderer.K8sApi.persistentVolumeStore];
  }
}

/**
 * サイドバー子メニュー3ページ(ノード/Service↔LB/PV↔ストレージ)共通のマウント処理。
 * ノード/Service/PVタブはRenderer.K8sApiのstoreを直接読む。組み込みページはKubeObjectListLayoutが
 * subscribeを担うが、本ページには無いため自前でマウント時にsubscribeしアンマウントで解除する。
 * ociClusterStoreはページ単位でセクションを遅延取得するため、同じセクションが複数ページから
 * 要求されても内部で1本のfetchにまとまる(重複実行しない)。
 */
export function useOciPageState(page: OciPage): { clusterKey: string | undefined } {
  const clusterKey = Renderer.Catalog.getActiveCluster()?.id;

  React.useEffect(() => {
    if (clusterKey) ociClusterStore.ensureLoaded(clusterKey, page);
  }, [clusterKey, page]);

  React.useEffect(() => {
    if (!clusterKey) return undefined;
    const disposers = subscribeTargetsForPage(page).map((store) => store.subscribe());
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [clusterKey, page]);

  return { clusterKey };
}
