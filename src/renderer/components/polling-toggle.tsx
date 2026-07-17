import { observer } from "mobx-react";
import * as React from "react";
import type { OciPage } from "../match/page-sections";
import { ociClusterStore } from "../store/oci-cluster-store";
import { normalizePollingInterval, ociPreferencesStore } from "../store/oci-preferences-store";

const LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "var(--textColorSecondary, #9aa0a6)",
  cursor: "pointer",
  userSelect: "none",
};

/**
 * 各ページ共通の自動更新ON/OFF(設計 Decision #14の全ページ展開)。
 * タイマーはこのコンポーネントの生存期間(=そのページ表示中)のみ動く。
 * 再取得は旧データ表示のまま裏で行う(pollRefresh)。認証エラー検出で自動停止し、永続化トグルもOFFへ倒す。
 */
export const PollingToggle = observer(function PollingToggle({
  clusterKey,
  page,
}: {
  clusterKey: string;
  page: OciPage;
}) {
  const enabled = ociPreferencesStore.nodePollingEnabled;
  const intervalSeconds = normalizePollingInterval(ociPreferencesStore.nodePollingIntervalSeconds);

  // biome-ignore lint/correctness/useExhaustiveDependencies(enabled): OFF→ONの切替でタイマーを張り直すため必要
  React.useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      void ociClusterStore.pollRefresh(clusterKey, page).then((authErrorKind) => {
        if (authErrorKind) ociPreferencesStore.setNodePollingEnabled(false);
      });
    }, intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [enabled, intervalSeconds, clusterKey, page]);

  return (
    <label style={LABEL_STYLE}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => ociPreferencesStore.setNodePollingEnabled(event.target.checked)}
      />
      自動更新({intervalSeconds}秒)
    </label>
  );
});
