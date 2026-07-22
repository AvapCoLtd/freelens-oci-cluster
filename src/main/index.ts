import { Main } from "@freelensapp/extensions";
import { ociPreferencesStore } from "../common/store/oci-preferences-store";

export default class OciClusterMain extends Main.LensExtension {
  protected onActivate(): void {
    // 消すな: renderer側のloadだけではPreferences変更がcluster frameへ同期されない(詳細: docs/extension-api.md)。
    ociPreferencesStore.loadExtension(this);
  }
}
