import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type * as React from "react";
import { FatalErrorGuidance, NonOkeGuidance } from "../components/error-guidance";
import { OciHeader } from "../components/oci-header";
import { PollingToggle } from "../components/polling-toggle";
import { Spinner } from "../components/spinner";
import type { ClusterOciData } from "../fetch/fetch";
import { buildHeaderInfo } from "../match/header-info";
import { extractRegionFromOcid } from "../match/ocid-region";
import type { OciPage } from "../match/page-sections";
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
  overflow: "auto",
  padding: 16,
};

const CENTER_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  gap: 8,
};

export interface OciPageShellProps {
  page: OciPage;
  renderLoaded: (data: ClusterOciData, region: string | undefined, clusterKey: string) => React.ReactNode;
}

// clusterPagesで個別ページ登録される側(oci-nodes-page.tsx等)はhostがobserver()で包むため
// ここでは包まない(page.tsx時代からの既知の制約)。本コンポーネントはネストされた内部部品であり
// host側の二重ラップの対象にならないため、mobxの状態読み取りのため自前でobserver()する。
export const OciPageShell = observer(function OciPageShell({ page, renderLoaded }: OciPageShellProps) {
  const { clusterKey } = useOciPageState(page);

  if (!clusterKey) {
    return <div style={{ padding: 16 }}>No active cluster</div>;
  }

  const state = ociClusterStore.getState(clusterKey, page);
  const catalogName = Renderer.Catalog.getActiveCluster()?.name;
  const headerInfo = buildHeaderInfo(state, catalogName);
  const region = state.status === "loaded" ? extractRegionFromOcid(state.anchor.clusterId) : undefined;

  const body = (() => {
    switch (state.status) {
      // アンカー解決までは対象クラスタが決まらず本文を出せない。以降はセクション単位で出す。
      case "not_fetched":
      case "fetching":
        return (
          <div style={CENTER_STYLE}>
            <Spinner />
          </div>
        );
      case "non_oke":
        return <NonOkeGuidance />;
      case "fatal_error":
        return (
          <FatalErrorGuidance
            errorKind={state.errorKind}
            raw={state.raw}
            stage={state.stage}
            onRetry={() => ociClusterStore.refresh(clusterKey, page)}
          />
        );
      case "loaded":
        return renderLoaded(state.data, region, clusterKey);
    }
  })();

  return (
    <div style={PAGE_STYLE}>
      <OciHeader
        info={headerInfo}
        fetching={state.status === "fetching" || (state.status === "loaded" && !state.settled)}
        onRefresh={() => ociClusterStore.refresh(clusterKey, page)}
        extras={<PollingToggle clusterKey={clusterKey} page={page} />}
      />
      <div style={BODY_STYLE}>{body}</div>
    </div>
  );
});
