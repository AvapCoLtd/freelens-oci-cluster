import { Common } from "@freelensapp/extensions";
import { action, makeObservable, observable } from "mobx";

interface PreferencesModel {
  // ociCommandはCLI時代の設定(SDK移行で廃止)。読み捨てるがファイルからは消さない(設計 Decision #16)。
  ociCommand?: string;
  authCommand: string;
  nodePollingEnabled: boolean;
  nodePollingIntervalSeconds: number;
}

export const POLLING_INTERVAL_DEFAULT_SECONDS = 60;
export const POLLING_INTERVAL_MIN_SECONDS = 30;

/** ポーリング間隔の正規化(設計 Decision #14: 下限30秒、不正値は既定60秒に丸め)。 */
export function normalizePollingInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return POLLING_INTERVAL_DEFAULT_SECONDS;
  return Math.max(POLLING_INTERVAL_MIN_SECONDS, Math.floor(value));
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
 * 設計 Decision #2/#16: 認証情報コマンド文字列をFreeLensの拡張向け永続化機構(ExtensionStore)で保存する。
 * 秘密そのもの(鍵・トークン・認証JSON)はここに入れてはならない(設計 Decision #3)。
 * loadExtension(extension)は拡張のonActivateから一度だけ呼ぶ(Common.Store.ExtensionStoreの利用規約)。
 */
export class OciPreferencesStore extends ExtensionStoreBase {
  authCommand = "";
  nodePollingEnabled = false;
  nodePollingIntervalSeconds = POLLING_INTERVAL_DEFAULT_SECONDS;

  private legacyOciCommand = "";

  constructor() {
    super({ configName: "preferences" });
    makeObservable(this, {
      authCommand: observable,
      nodePollingEnabled: observable,
      nodePollingIntervalSeconds: observable,
      setAuthCommand: action,
      setNodePollingEnabled: action,
      setNodePollingIntervalSeconds: action,
    });
  }

  setAuthCommand(value: string): void {
    this.authCommand = value;
  }

  setNodePollingEnabled(value: boolean): void {
    this.nodePollingEnabled = value;
  }

  setNodePollingIntervalSeconds(value: number): void {
    this.nodePollingIntervalSeconds = normalizePollingInterval(value);
  }

  fromStore(data: Partial<PreferencesModel>): void {
    this.authCommand = data.authCommand ?? "";
    this.nodePollingEnabled = data.nodePollingEnabled ?? false;
    this.nodePollingIntervalSeconds = normalizePollingInterval(data.nodePollingIntervalSeconds);
    this.legacyOciCommand = data.ociCommand ?? "";
  }

  toJSON(): PreferencesModel {
    const model: PreferencesModel = {
      authCommand: this.authCommand,
      nodePollingEnabled: this.nodePollingEnabled,
      nodePollingIntervalSeconds: this.nodePollingIntervalSeconds,
    };
    return this.legacyOciCommand.length > 0 ? { ociCommand: this.legacyOciCommand, ...model } : model;
  }
}

export const ociPreferencesStore = new OciPreferencesStore();
