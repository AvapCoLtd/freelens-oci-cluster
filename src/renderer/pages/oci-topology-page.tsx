import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import * as React from "react";
import { FatalErrorGuidance, NonOkeGuidance } from "../components/error-guidance";
import { OciHeader } from "../components/oci-header";
import { PollingToggle } from "../components/polling-toggle";
import { TopologyDetailPanel } from "../components/topology-detail-panel";
import { TopologyGraphView } from "../components/topology-graph-view";
import { TopologyMissingBanner } from "../components/topology-missing-banner";
import { TopologyProgress } from "../components/topology-progress";
import { buildHeaderInfo } from "../match/header-info";
import type { TopologySection } from "../match/page-sections";
import { toTopologyFlow } from "../match/topology-flow";
import { buildTopologyGraph, type TopologyNode } from "../match/topology-graph";
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

// @freelensapp/coreがclusterPagesのPage登録時にobserver()で包むため、ここでは包まない(既知の制約)。
export function OciTopologyPage() {
  return <TopologyPage />;
}

const TopologyPage = observer(function TopologyPage() {
  const { clusterKey } = useOciPageState("topology");
  if (!clusterKey) {
    return <div style={{ padding: 16 }}>No active cluster</div>;
  }
  return <TopologyPageContent clusterKey={clusterKey} />;
});

const TopologyPageContent = observer(function TopologyPageContent({ clusterKey }: { clusterKey: string }) {
  const state = ociClusterStore.getState(clusterKey, "topology");
  const snapshot = ociClusterStore.getTopologySnapshot(clusterKey);
  const progress = ociClusterStore.getTopologyProgress(clusterKey);
  const k8s = readTopologyK8s();
  const k8sInput = useStableK8sInput(k8s.input);

  const [expandedSubnetIds, setExpandedSubnetIds] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);

  const generation = snapshot?.generation;
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  const failedSectionsRef = React.useRef<TopologySection[]>([]);
  failedSectionsRef.current = progress.filter((entry) => entry.status === "failed").map((entry) => entry.section);

  // OCI側の差し替え契機は確定スナップショットの世代だけに絞り、K8s側入力(k8sInput)はライブ反映する。
  // biome-ignore lint/correctness/useExhaustiveDependencies(generation): 取得中のセクション差し替えを図に流さない
  const view = React.useMemo(() => {
    const current = snapshotRef.current;
    if (!current) return undefined;
    const graph = buildTopologyGraph({
      data: current.data,
      nodes: k8sInput.nodes,
      services: k8sInput.services,
      persistentVolumes: k8sInput.persistentVolumes,
      expandedSubnetIds,
      failedSections: failedSectionsRef.current,
    });
    return {
      data: current.data,
      missing: graph.missing,
      flow: toTopologyFlow(graph, layoutTopology(graph.nodes, graph.edges)),
      nodeById: new Map<string, TopologyNode>(graph.nodes.map((node) => [node.id, node])),
    };
  }, [generation, k8sInput, expandedSubnetIds]);

  const handleSelectNode = (id: string | undefined) => {
    const node = id ? view?.nodeById.get(id) : undefined;
    if (node?.kind === "instance-group" && node.parentId) {
      const subnetId = node.parentId;
      setExpandedSubnetIds((previous) => new Set(previous).add(subnetId));
      setSelectedId(undefined);
      return;
    }
    // 件数サマリのような詳細を持たないノードは空パネルになるだけなので開かない
    setSelectedId(node && node.detail.length > 0 ? id : undefined);
  };

  const k8sReady = k8s.loaded.nodes && k8s.loaded.services && k8s.loaded.persistentVolumes;
  const selectedNode = selectedId ? view?.nodeById.get(selectedId) : undefined;
  const catalogName = Renderer.Catalog.getActiveCluster()?.name;

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
            <div style={CANVAS_ROW_STYLE}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TopologyGraphView flow={view.flow} onSelectNode={handleSelectNode} />
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
        info={buildHeaderInfo(state, catalogName)}
        fetching={state.status === "fetching" || (state.status === "loaded" && !state.settled)}
        // 図を消さずに差し替えるためforce再取得を使う。アンカー未解決の初回だけはrefreshで解決からやり直す。
        onRefresh={() => {
          if (snapshot) void ociClusterStore.pollRefresh(clusterKey, "topology");
          else ociClusterStore.refresh(clusterKey, "topology");
        }}
        extras={<PollingToggle clusterKey={clusterKey} page="topology" />}
      />
      <div style={BODY_STYLE}>{body}</div>
    </div>
  );
});
