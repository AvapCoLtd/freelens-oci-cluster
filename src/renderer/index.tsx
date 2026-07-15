import { Renderer } from "@freelensapp/extensions";
import { reaction } from "mobx";
import { OciCommandHint, OciCommandInput } from "./components/oci-command-preference";
import { OciNodesPage } from "./pages/oci-nodes-page";
import { OciPvStoragePage } from "./pages/oci-pv-storage-page";
import { OciServiceLbPage } from "./pages/oci-service-lb-page";
import { ociClusterStore } from "./store/oci-cluster-store";
import { ociPreferencesStore } from "./store/oci-preferences-store";

export default class OciClusterRenderer extends Renderer.LensExtension {
  clusterPages = [
    { id: "oci-nodes", components: { Page: OciNodesPage } },
    { id: "oci-service-lb", components: { Page: OciServiceLbPage } },
    { id: "oci-pv-storage", components: { Page: OciPvStoragePage } },
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
    { id: "oci-nodes", parentId: "oci", target: { pageId: "oci-nodes" }, title: "ノード", components: {} },
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
      title: "PV↔ストレージ",
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
        Hint: OciCommandHint,
        Input: OciCommandInput,
      },
    },
  ];

  private stopSyncingOverrideCommand?: () => void;

  protected onActivate(): void {
    ociPreferencesStore.loadExtension(this);
    // overrideCommandはociClusterStoreの公開IF(設計:変更しない)。設定変更を都度反映するためreactionで同期する。
    this.stopSyncingOverrideCommand = reaction(
      () => ociPreferencesStore.ociCommand,
      (value) => ociClusterStore.setOverrideCommand(value),
      { fireImmediately: true },
    );
  }

  protected onDeactivate(): void {
    this.stopSyncingOverrideCommand?.();
  }
}
