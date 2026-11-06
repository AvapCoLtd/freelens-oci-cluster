import { Common, Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import * as React from "react";
import { FatalErrorGuidance, NonOkeGuidance } from "../components/error-guidance";
import { OciHeader } from "../components/oci-header";
import { PollingToggle } from "../components/polling-toggle";
import { SearchBar } from "../components/search-bar";
import { TopologyDetailPanel } from "../components/topology-detail-panel";
import { TopologyGraphView } from "../components/topology-graph-view";
import { TopologyMermaidCopyButton } from "../components/topology-mermaid-copy-button";
import { TopologyMissingBanner } from "../components/topology-missing-banner";
import { TopologyPngCopyButton } from "../components/topology-png-copy-button";
import { TopologyProgress } from "../components/topology-progress";
import { TopologySvgCopyButton } from "../components/topology-svg-copy-button";
import { type SearchState, useSearchQuery } from "../components/use-search-query";
import { buildHeaderInfo } from "../match/header-info";
import type { TopologySection } from "../match/page-sections";
import { hideTopologyEdgeKinds, topologyLegendRowsOf } from "../match/topology-edge-filter";
import { toTopologyFlow } from "../match/topology-flow";
import {
  buildTopologyGraph,
  type TopologyEdgeHealth,
  type TopologyEdgeKind,
  type TopologyNode,
} from "../match/topology-graph";
import { layoutTopology } from "../match/topology-layout";
import { readTopologyK8s, type TopologyK8sInput } from "../store/k8s-adapter";
import { ociClusterStore } from "../store/oci-cluster-store";
import { useOciPageState } from "./use-oci-page-state";

const PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  color: "var(--textColorPrimary, #fff)",
};

const BODY_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const GUIDANCE_STYLE: React.CSSProperties = { padding: 16, overflow: "auto" };

const CANVAS_ROW_STYLE: React.CSSProperties = { flex: 1, minHeight: 0, display: "flex" };

const SEARCH_ROW_STYLE: React.CSSProperties = { flexShrink: 0, padding: "8px 12px 0" };

/**
 * K8s側の入力は毎レンダー新しい配列で返るため、内容が変わらない限り同じ参照を返す。
 * これが無いと図の再導出がレンダーのたびに走る。
 */
function useStableK8sInput(input: TopologyK8sInput): TopologyK8sInput {
  const key = JSON.stringify(input);
  const cache = React.useRef({ key, input });
  if (cache.current.key !== key) cache.current = { key, input };
  return cache.current.input;
}

// observer()で包まない: FreeLensが登録時に包むため、二重になってthrowする。
export function OciTopologyPage() {
  return <TopologyPage />;
}

const TopologyPage = observer(function TopologyPage() {
  const { clusterKey } = useOciPageState("topology");
  // 検索語はページ側で持つ: 図の描画側に置くと再取得で本文が差し替わったときに消える。
  const search = useSearchQuery(clusterKey);
  if (!clusterKey) {
    return <div style={{ padding: 16 }}>No active cluster</div>;
  }
  return <TopologyPageContent clusterKey={clusterKey} search={search} />;
});

const TopologyPageContent = observer(function TopologyPageContent({
  clusterKey,
  search,
}: {
  clusterKey: string;
  search: SearchState;
}) {
  const state = ociClusterStore.getState(clusterKey, "topology");
  const snapshot = ociClusterStore.getTopologySnapshot(clusterKey);
  const progress = ociClusterStore.getTopologyProgress(clusterKey);
  const k8s = readTopologyK8s();
  const k8sInput = useStableK8sInput(k8s.input);

  const [expandedSubnetIds, setExpandedSubnetIds] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const [hiddenEdgeKinds, setHiddenEdgeKinds] = React.useState<ReadonlySet<TopologyEdgeKind>>(
    () => new Set<TopologyEdgeKind>(),
  );
  const [hiddenEdgeHealths, setHiddenEdgeHealths] = React.useState<ReadonlySet<TopologyEdgeHealth>>(
    () => new Set<TopologyEdgeHealth>(),
  );
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const { query, setQuery } = search;

  const generation = snapshot?.generation;
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  const failedSectionsRef = React.useRef<TopologySection[]>([]);
  // アンカー(現クラスタ)はスナップショットの世代が進む前に確定しているため、世代と同じ契機で読めば足りる。
  const clusterIdRef = React.useRef<string | undefined>(undefined);
  clusterIdRef.current = state.status === "loaded" ? state.anchor.clusterId : undefined;
  failedSectionsRef.current = progress.filter((entry) => entry.status === "failed").map((entry) => entry.section);

  // OCI側の差し替え契機は確定スナップショットの世代だけに絞り、K8s側入力(k8sInput)はライブ反映する。
  // biome-ignore lint/correctness/useExhaustiveDependencies(generation): 取得中のセクション差し替えを図に流さない
  const built = React.useMemo(() => {
    const current = snapshotRef.current;
    if (!current) return undefined;
    return {
      data: current.data,
      graph: buildTopologyGraph({
        data: current.data,
        nodes: k8sInput.nodes,
        services: k8sInput.services,
        persistentVolumes: k8sInput.persistentVolumes,
        endpointSlices: k8sInput.endpointSlices,
        expandedSubnetIds,
        failedSections: failedSectionsRef.current,
        clusterId: clusterIdRef.current,
      }),
    };
  }, [generation, k8sInput, expandedSubnetIds]);

  // 上のmemoと1つにまとめない: 凡例のトグルのたびにグラフ構築からやり直すことになる。
  const view = React.useMemo(() => {
    if (!built) return undefined;
    const graph = hideTopologyEdgeKinds(built.graph, hiddenEdgeKinds, hiddenEdgeHealths);
    return {
      data: built.data,
      graph,
      legendRows: topologyLegendRowsOf(built.graph, hiddenEdgeKinds, hiddenEdgeHealths),
      missing: graph.missing,
      flow: toTopologyFlow(graph, layoutTopology(graph.nodes, graph.edges)),
      nodeById: new Map<string, TopologyNode>(graph.nodes.map((node) => [node.id, node])),
    };
  }, [built, hiddenEdgeKinds, hiddenEdgeHealths]);

  // console.*はFreeLensのログファイルへ出ない。診断出力はCommon.loggerへ揃えること。
  const securityStats = built?.graph.security;
  React.useEffect(() => {
    if (!securityStats) return;
    Common.logger.info(
      `[OCI-CLUSTER]: topology securityLinks=${securityStats.links} securityEdges=${securityStats.edges}`,
    );
  }, [securityStats]);

  const localTrafficStats = built?.graph.localTraffic;
  React.useEffect(() => {
    if (!localTrafficStats) return;
    Common.logger.info(
      `[OCI-CLUSTER]: topology endpointSlices=${localTrafficStats.endpointSlices}` +
        ` localServices=${localTrafficStats.localServices} downgraded=${localTrafficStats.downgraded}`,
    );
  }, [localTrafficStats]);

  const handleToggleEdgeKind = (kind: TopologyEdgeKind) => {
    setHiddenEdgeKinds((previous) => {
      const next = new Set(previous);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  };

  const handleToggleEdgeHealth = (health: TopologyEdgeHealth) => {
    setHiddenEdgeHealths((previous) => {
      const next = new Set(previous);
      if (!next.delete(health)) next.add(health);
      return next;
    });
  };

  const handleSelectNode = (id: string | undefined) => {
    const node = id ? view?.nodeById.get(id) : undefined;
    if (node?.kind === "instance-group" && node.parentId) {
      const subnetId = node.parentId;
      setExpandedSubnetIds((previous) => new Set(previous).add(subnetId));
      setSelectedId(undefined);
      return;
    }
    // 詳細を持たないノードは空パネルになるだけなので開かない
    setSelectedId(node && node.detail.length > 0 ? id : undefined);
  };

  const k8sReady = k8s.loaded.nodes && k8s.loaded.services && k8s.loaded.persistentVolumes;
  const selectedNode = selectedId ? view?.nodeById.get(selectedId) : undefined;
  const catalogName = Renderer.Catalog.getActiveCluster()?.name;
  const headerInfo = buildHeaderInfo(state, catalogName);
  const exportMeta = {
    clusterName: headerInfo.clusterName,
    compartmentId: state.status === "loaded" ? state.anchor.compartmentId : undefined,
  };

  const body = (() => {
    switch (state.status) {
      case "non_oke":
        return (
          <div style={GUIDANCE_STYLE}>
            <NonOkeGuidance />
          </div>
        );
      case "fatal_error":
        return (
          <div style={GUIDANCE_STYLE}>
            <FatalErrorGuidance
              errorKind={state.errorKind}
              raw={state.raw}
              stage={state.stage}
              onRetry={() => ociClusterStore.refresh(clusterKey, "topology")}
            />
          </div>
        );
      default:
        if (!view || !k8sReady) return <TopologyProgress sections={progress} k8s={k8s.loaded} />;
        return (
          <>
            <TopologyMissingBanner missing={view.missing} data={view.data} />
            <div style={SEARCH_ROW_STYLE}>
              <SearchBar query={query} onChange={setQuery} placeholder="Search nodes" />
            </div>
            <div style={CANVAS_ROW_STYLE}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TopologyGraphView
                  flow={view.flow}
                  legendRows={view.legendRows}
                  onToggleEdgeKind={handleToggleEdgeKind}
                  onToggleEdgeHealth={handleToggleEdgeHealth}
                  searchQuery={query}
                  onSelectNode={handleSelectNode}
                />
              </div>
              {selectedNode && <TopologyDetailPanel node={selectedNode} onClose={() => setSelectedId(undefined)} />}
            </div>
          </>
        );
    }
  })();

  return (
    <div style={PAGE_STYLE}>
      <OciHeader
        info={headerInfo}
        fetching={state.status === "fetching" || (state.status === "loaded" && !state.settled) || manualRefreshing}
        // 図を消さずに差し替えるためforce再取得を使う。アンカー未解決の初回だけはrefreshで解決からやり直す。
        // pollRefreshはready済みセクションをloadingに戻さないため、手動時のみ自前のフラグで取得中を示す。
        onRefresh={() => {
          if (!snapshot) {
            ociClusterStore.refresh(clusterKey, "topology");
            return;
          }
          setManualRefreshing(true);
          void ociClusterStore.pollRefresh(clusterKey, "topology", true).finally(() => {
            if (mountedRef.current) setManualRefreshing(false);
          });
        }}
        extras={
          <>
            <PollingToggle clusterKey={clusterKey} page="topology" />
            <TopologyMermaidCopyButton graph={view?.graph} meta={exportMeta} />
            <TopologySvgCopyButton flow={view?.flow} meta={exportMeta} />
            <TopologyPngCopyButton flow={view?.flow} meta={exportMeta} />
          </>
        }
      />
      <div style={BODY_STYLE}>{body}</div>
    </div>
  );
});
