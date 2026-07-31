import { describe, expect, it, vi } from "vitest";
import { normalizePollingInterval, OciPreferencesStore } from "./oci-preferences-store";

// @freelensapp/extensionsの実体はFreeLens本体のrendererバンドルで、node環境のimportで例外を出す
// (Automatic publicPath is not supported in this browser)。基底クラスは差し替える。
vi.mock("@freelensapp/extensions", () => ({
  Common: { Store: { ExtensionStore: class {} } },
}));

const LEGACY_AUTH_COMMAND = "wsl haj oci-cred-json";
const LEGACY_OCI_COMMAND = "wsl oci --profile old";

describe("OciPreferencesStore", () => {
  it("新フィールドを読み書きする", () => {
    const store = new OciPreferencesStore();
    store.fromStore({ ociCliCommand: "wsl oci", nodePollingEnabled: true, nodePollingIntervalSeconds: 90 });

    expect(store.ociCliCommand).toBe("wsl oci");
    expect(store.toJSON()).toEqual({
      ociCliCommand: "wsl oci",
      nodePollingEnabled: true,
      nodePollingIntervalSeconds: 90,
    });
  });

  it("旧フィールドの値をociコマンドとして引き継がない", () => {
    const store = new OciPreferencesStore();
    store.fromStore({ authCommand: LEGACY_AUTH_COMMAND, ociCommand: LEGACY_OCI_COMMAND });

    expect(store.ociCliCommand).toBe("");
  });

  it("読み捨てた旧フィールドをファイルからは消さない", () => {
    const store = new OciPreferencesStore();
    store.fromStore({ authCommand: LEGACY_AUTH_COMMAND, ociCommand: LEGACY_OCI_COMMAND });
    store.setOciCliCommand("wsl oci");

    expect(store.toJSON()).toEqual({
      ociCommand: LEGACY_OCI_COMMAND,
      authCommand: LEGACY_AUTH_COMMAND,
      ociCliCommand: "wsl oci",
      nodePollingEnabled: false,
      nodePollingIntervalSeconds: 60,
    });
  });

  it("旧フィールドが無いファイルには旧キーを書き足さない", () => {
    const store = new OciPreferencesStore();
    store.fromStore({ ociCliCommand: "oci" });

    expect(Object.keys(store.toJSON())).toEqual(["ociCliCommand", "nodePollingEnabled", "nodePollingIntervalSeconds"]);
  });
});

describe("normalizePollingInterval", () => {
  it("下限30秒未満は30秒に切り上げる", () => {
    expect(normalizePollingInterval(29)).toBe(30);
  });

  it("下限ちょうどはそのまま", () => {
    expect(normalizePollingInterval(30)).toBe(30);
  });

  it("下限超えはそのまま", () => {
    expect(normalizePollingInterval(31)).toBe(31);
  });

  it("小数は切り捨てる", () => {
    expect(normalizePollingInterval(60.9)).toBe(60);
  });

  it("0は下限30秒に丸める", () => {
    expect(normalizePollingInterval(0)).toBe(30);
  });

  it("負値は下限30秒に丸める", () => {
    expect(normalizePollingInterval(-5)).toBe(30);
  });

  it("undefinedは既定60秒", () => {
    expect(normalizePollingInterval(undefined)).toBe(60);
  });

  it("NaNは既定60秒", () => {
    expect(normalizePollingInterval(Number.NaN)).toBe(60);
  });
});
