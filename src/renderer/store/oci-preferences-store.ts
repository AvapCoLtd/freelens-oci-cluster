import { Common } from "@freelensapp/extensions";
import { action, makeObservable, observable } from "mobx";

interface PreferencesModel {
  ociCommand: string;
}

interface ExtensionStoreInstance {
  loadExtension(extension: unknown): void;
}

// Common.Store.ExtensionStoreは、@freelensapp/core 1.10.3の型定義では
// (エイリアス再エクスポート+ジェネリクスの入れ子構成により)anyへ潰れてメンバが一切見えない既知の不具合がある
// (実体・実行時挙動は正しいクラスであることを確認済み)。必要な形だけ自前で宣言してキャストする。
const ExtensionStoreBase = Common.Store.ExtensionStore as unknown as new (params: {
  configName: string;
}) => ExtensionStoreInstance;

/**
 * 設計 Decision #7: oci コマンドの上書き文字列をFreeLensの拡張向け永続化機構(ExtensionStore)で保存する。
 * loadExtension(extension)は拡張のonActivateから一度だけ呼ぶ(Common.Store.ExtensionStoreの利用規約)。
 */
export class OciPreferencesStore extends ExtensionStoreBase {
  ociCommand = "";

  constructor() {
    super({ configName: "preferences" });
    makeObservable(this, {
      ociCommand: observable,
      setOciCommand: action,
    });
  }

  setOciCommand(value: string): void {
    this.ociCommand = value;
  }

  fromStore(data: Partial<PreferencesModel>): void {
    this.ociCommand = data.ociCommand ?? "";
  }

  toJSON(): PreferencesModel {
    return { ociCommand: this.ociCommand };
  }
}

export const ociPreferencesStore = new OciPreferencesStore();
