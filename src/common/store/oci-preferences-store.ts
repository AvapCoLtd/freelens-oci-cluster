import { Common } from "@freelensapp/extensions";
import { action, makeObservable, observable } from "mobx";

interface PreferencesModel {
  // ociCommand/authCommandは廃止済みの設定。読み捨てるがファイルからは消さない。
  // authCommandの値は認証情報JSONを返すコマンドであり、ociコマンドとして実行してはならない。
  ociCommand?: string;
  authCommand?: string;
  ociCliCommand: string;
  nodePollingEnabled: boolean;
  nodePollingIntervalSeconds: number;
}

export const POLLING_INTERVAL_DEFAULT_SECONDS = 60;
export const POLLING_INTERVAL_MIN_SECONDS = 30;

/** ポーリング間隔の正規化(下限30秒、不正値は既定60秒に丸め)。 */
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
 * oci CLIの呼び出しコマンド文字列と自動更新設定をFreeLensの拡張向け永続化機構(ExtensionStore)で保存する。
 * 鍵・トークン・認証JSONはここに入れてはならない(認証はociコマンド側で完結する)。
 * loadExtension(extension)はmain/renderer両方のonActivateから一度ずつ呼ぶ
 * (mainを欠くとフレーム間同期が壊れ旧値がファイルへ書き戻る。詳細: docs/extension-api.md)。
 */
export class OciPreferencesStore extends ExtensionStoreBase {
  ociCliCommand = "";
  nodePollingEnabled = false;
  nodePollingIntervalSeconds = POLLING_INTERVAL_DEFAULT_SECONDS;

  private legacyOciCommand = "";
  private legacyAuthCommand = "";

  constructor() {
    super({ configName: "preferences" });
    makeObservable(this, {
      ociCliCommand: observable,
      nodePollingEnabled: observable,
      nodePollingIntervalSeconds: observable,
      setOciCliCommand: action,
      setNodePollingEnabled: action,
      setNodePollingIntervalSeconds: action,
    });
  }

  setOciCliCommand(value: string): void {
    this.ociCliCommand = value;
  }

  setNodePollingEnabled(value: boolean): void {
    this.nodePollingEnabled = value;
  }

  setNodePollingIntervalSeconds(value: number): void {
    this.nodePollingIntervalSeconds = normalizePollingInterval(value);
  }

  fromStore(data: Partial<PreferencesModel>): void {
    this.ociCliCommand = data.ociCliCommand ?? "";
    this.nodePollingEnabled = data.nodePollingEnabled ?? false;
    this.nodePollingIntervalSeconds = normalizePollingInterval(data.nodePollingIntervalSeconds);
    this.legacyOciCommand = data.ociCommand ?? "";
    this.legacyAuthCommand = data.authCommand ?? "";
  }

  toJSON(): PreferencesModel {
    return {
      ...(this.legacyOciCommand.length > 0 ? { ociCommand: this.legacyOciCommand } : {}),
      ...(this.legacyAuthCommand.length > 0 ? { authCommand: this.legacyAuthCommand } : {}),
      ociCliCommand: this.ociCliCommand,
      nodePollingEnabled: this.nodePollingEnabled,
      nodePollingIntervalSeconds: this.nodePollingIntervalSeconds,
    };
  }
}

export const ociPreferencesStore = new OciPreferencesStore();
