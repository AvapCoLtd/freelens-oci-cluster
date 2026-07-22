import { Renderer } from "@freelensapp/extensions";
import { reaction } from "mobx";
import { ociPreferencesStore } from "../common/store/oci-preferences-store";
import {
  OciAuthCommandHint,
  OciAuthCommandInput,
  OciPollingIntervalHint,
  OciPollingIntervalInput,
} from "./components/oci-auth-preference";
import { OciNetworkPage } from "./pages/oci-network-page";
import { OciNodesPage } from "./pages/oci-nodes-page";
import { OciPvStoragePage } from "./pages/oci-pv-storage-page";
import { OciServiceLbPage } from "./pages/oci-service-lb-page";
import { ociClusterStore } from "./store/oci-cluster-store";

export default class OciClusterRenderer extends Renderer.LensExtension {
  clusterPages = [
    { id: "oci-nodes", components: { Page: OciNodesPage } },
    { id: "oci-service-lb", components: { Page: OciServiceLbPage } },
    { id: "oci-pv-storage", components: { Page: OciPvStoragePage } },
    { id: "oci-network", components: { Page: OciNetworkPage } },
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
      id: "oci-cluster-command",
      title: "OCI",
      components: {
        Hint: OciAuthCommandHint,
        Input: OciAuthCommandInput,
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

  private stopSyncingAuthCommand?: () => void;

  protected onActivate(): void {
    ociPreferencesStore.loadExtension(this);
    // 設定変更を都度反映するためreactionでociClusterStoreへ同期する。
    this.stopSyncingAuthCommand = reaction(
      () => ociPreferencesStore.authCommand,
      (value) => ociClusterStore.setAuthCommand(value),
      { fireImmediately: true },
    );
  }

  protected onDeactivate(): void {
    this.stopSyncingAuthCommand?.();
  }
}
