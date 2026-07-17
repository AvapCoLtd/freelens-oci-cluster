import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { ociPreferencesStore } from "../store/oci-preferences-store";

// appPreferences登録のInput/Hintはregistrationからprops無しで描画される(ExtensionPreferenceBlock参照)。
export const OciAuthCommandInput = observer(function OciAuthCommandInput() {
  return (
    <Renderer.Component.Input
      value={ociPreferencesStore.authCommand}
      placeholder="(空欄: ~/.oci/config を使用)"
      onChange={(value) => ociPreferencesStore.setAuthCommand(value)}
    />
  );
});

export function OciAuthCommandHint() {
  return (
    <span>
      空欄の場合は ~/.oci/config(または環境変数 OCI_CONFIG_FILE のパス)から認証します。
      設定した場合はそのコマンドを実行し、標準出力の JSON から認証情報を受け取ります(形式は README を参照)。
      認証情報はメモリ上でのみ保持し、ディスクには保存しません。
      変更は次回のデータ取得(［更新］、またはクラスタの再選択)から反映されます。
    </span>
  );
}

export const OciPollingIntervalInput = observer(function OciPollingIntervalInput() {
  return (
    <Renderer.Component.Input
      value={String(ociPreferencesStore.nodePollingIntervalSeconds)}
      onChange={(value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) ociPreferencesStore.setNodePollingIntervalSeconds(parsed);
      }}
    />
  );
});

export function OciPollingIntervalHint() {
  return (
    <span>
      各ページ共通の自動更新(トグルON時)の間隔です。既定は60秒、下限は30秒(下回る値は丸められます)。
      変更は次の更新サイクルから反映されます。
    </span>
  );
}
