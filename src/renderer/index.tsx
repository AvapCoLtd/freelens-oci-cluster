import { Renderer } from "@freelensapp/extensions";
import { reaction } from "mobx";
import { ociPreferencesStore } from "../common/store/oci-preferences-store";
import { EXPANDABLE_ROW_STYLE } from "./components/expandable-row";
import { ensureInjectedStyle, removeInjectedStyle } from "./components/injected-style";
import {
  OciCommandHint,
  OciCommandInput,
  OciPollingIntervalHint,
  OciPollingIntervalInput,
} from "./components/oci-preference";
import { SPINNER_STYLE } from "./components/spinner";
import { TOPOLOGY_FLOW_STYLE, XYFLOW_STYLE } from "./components/topology-graph-view";
import { OciNetworkPage } from "./pages/oci-network-page";
import { OciNodesPage } from "./pages/oci-nodes-page";
import { OciPvStoragePage } from "./pages/oci-pv-storage-page";
import { OciServiceLbPage } from "./pages/oci-service-lb-page";
import { OciTopologyPage } from "./pages/oci-topology-page";
import { ociClusterStore } from "./store/oci-cluster-store";

const INJECTED_STYLES = [EXPANDABLE_ROW_STYLE, SPINNER_STYLE, XYFLOW_STYLE, TOPOLOGY_FLOW_STYLE];

export default class OciClusterRenderer extends Renderer.LensExtension {
  clusterPages = [
    { id: "oci-nodes", components: { Page: OciNodesPage } },
    { id: "oci-service-lb", components: { Page: OciServiceLbPage } },
    { id: "oci-pv-storage", components: { Page: OciPvStoragePage } },
    { id: "oci-network", components: { Page: OciNetworkPage } },
    { id: "oci-topology", components: { Page: OciTopologyPage } },
  ];

  // 子メニューにもidが必須(idを省くと登録キーがextension単位まで潰れて衝突し、最後の1件しか残らない。
  // @freelensapp/core compiled JSのcluster-page-menu registrator実装で確認済み)。
  // FluxCD拡張(実機で動作)に倣い、親・子とも一意のidを付ける。
  // 親にtargetも必須(実機確認済み: targetがないとホバー解除後もハイライトが残る。FluxCDの親は
  // id+target併記。isActiveはtargetのpageIdが解決する実ルートへの一致で決まるため、
  // targetを欠くとisActiveの評価が本来の(現在ページに応じた)値にならない)。
  // 親のtargetは子(oci-nodes)と同じpageIdを指すため、配列内で子を親より前に置くこと:
  // タブ表示の兄弟解決(clusterPageMenus.find(target.pageId一致))は先勝ちで、親が先だと
  // その子(oci-nodes)だけタブストリップが消える(実機確認済み)。
  clusterPageMenus = [
    { id: "oci-nodes", parentId: "oci", target: { pageId: "oci-nodes" }, title: "Nodes", components: {} },
    {
      id: "oci-service-lb",
      parentId: "oci",
      target: { pageId: "oci-service-lb" },
      title: "Service↔LB",
      components: {},
    },
    {
      id: "oci-pv-storage",
      parentId: "oci",
      target: { pageId: "oci-pv-storage" },
      title: "PV ↔ Storage",
      components: {},
    },
    {
      id: "oci-network",
      parentId: "oci",
      target: { pageId: "oci-network" },
      title: "Network",
      components: {},
    },
    {
      id: "oci-topology",
      parentId: "oci",
      target: { pageId: "oci-topology" },
      title: "Topology",
      components: {},
    },
    {
      id: "oci",
      target: { pageId: "oci-nodes" },
      title: "OCI",
      components: {
        Icon: () => <Renderer.Component.Icon material="cloud" />,
      },
    },
  ];

  appPreferences = [
    {
      id: "oci-cluster-cli-command",
      title: "OCI: oci command",
      components: {
        Hint: OciCommandHint,
        Input: OciCommandInput,
      },
    },
    {
      id: "oci-node-polling-interval",
      title: "OCI: Node auto-refresh interval (seconds)",
      components: {
        Hint: OciPollingIntervalHint,
        Input: OciPollingIntervalInput,
      },
    },
  ];

  private stopSyncingOciCommand?: () => void;

  protected onActivate(): void {
    for (const { id, css } of INJECTED_STYLES) ensureInjectedStyle(id, css);
    ociPreferencesStore.loadExtension(this);
    // 設定変更を都度反映するためreactionでociClusterStoreへ同期する。
    this.stopSyncingOciCommand = reaction(
      () => ociPreferencesStore.ociCliCommand,
      (value) => ociClusterStore.setOciCliCommand(value),
      // delayは打鍵途中の値が取得に流れるのを抑えるためのもの(取得中の値の差し替えまでは防げない)
      { fireImmediately: true, delay: 500 },
    );
  }

  protected onDeactivate(): void {
    this.stopSyncingOciCommand?.();
    for (const { id } of INJECTED_STYLES) removeInjectedStyle(id);
  }
}
