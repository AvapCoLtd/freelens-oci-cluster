import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { resolveOciCommand } from "../match/command-resolve";
import { ociPreferencesStore } from "../store/oci-preferences-store";

const DEFAULT_COMMAND = resolveOciCommand("").join(" ");

// appPreferences登録のInput/Hintはregistrationからprops無しで描画される(ExtensionPreferenceBlock参照)。
export const OciCommandInput = observer(function OciCommandInput() {
  return (
    <Renderer.Component.Input
      value={ociPreferencesStore.ociCommand}
      placeholder={DEFAULT_COMMAND}
      onChange={(value) => ociPreferencesStore.setOciCommand(value)}
    />
  );
});

export function OciCommandHint() {
  return (
    <span>
      空欄の場合は既定のコマンド({DEFAULT_COMMAND})を使用します。`--profile FOO` 等の追加引数を
      スペース区切りで含められます。変更は次回のデータ取得(タブの［更新］、またはクラスタの再選択)から反映されます。
    </span>
  );
}
