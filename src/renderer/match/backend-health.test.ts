import { describe, expect, it } from "vitest";
import {
  backendHealthByIp,
  backendHealthKey,
  backendNameIp,
  unlistedBackendHealth,
  worseBackendHealth,
} from "./backend-health";

const LB = "ocid1.loadbalancer.oc1.ap-tokyo-1.lb1";

describe("backendHealthKey", () => {
  it("種別・LB OCID・バックエンドセット名を1つのキーへ畳む", () => {
    expect(backendHealthKey("lb", LB, "TCP-443")).toBe(`lb:${LB}:TCP-443`);
    expect(backendHealthKey("nlb", LB, "TCP-443")).toBe(`nlb:${LB}:TCP-443`);
  });

  it("バックエンドセット名にコロンが含まれても種別・OCIDと混ざらない", () => {
    expect(backendHealthKey("lb", LB, "a:b")).toBe(`lb:${LB}:a:b`);
  });
});

describe("backendNameIp", () => {
  it("ip:port表記からIP部を取り出す", () => {
    expect(backendNameIp("10.0.11.23:32704")).toBe("10.0.11.23");
  });

  it("ブラケット付きIPv6はポートを外してアドレスだけを返す", () => {
    expect(backendNameIp("[2001:db8::1]:32704")).toBe("2001:db8::1");
  });

  it("ブラケット無しのIPv6は末尾で切らずそのまま返す", () => {
    expect(backendNameIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("ポートを持たない表記はそのままIPとして扱う", () => {
    expect(backendNameIp("10.0.11.23")).toBe("10.0.11.23");
  });
});

describe("worseBackendHealth", () => {
  it("深刻な方を残す", () => {
    expect(worseBackendHealth("ok", "critical")).toBe("critical");
    expect(worseBackendHealth("critical", "warning")).toBe("critical");
    expect(worseBackendHealth("warning", "unknown")).toBe("warning");
    expect(worseBackendHealth("unknown", "ok")).toBe("unknown");
  });

  it("no-local-podはokより深刻だが、OCIが返す不明・警告・異常には譲る", () => {
    expect(worseBackendHealth("ok", "no-local-pod")).toBe("no-local-pod");
    expect(worseBackendHealth("no-local-pod", "unknown")).toBe("unknown");
    expect(worseBackendHealth("no-local-pod", "warning")).toBe("warning");
    expect(worseBackendHealth("no-local-pod", "critical")).toBe("critical");
  });

  it("片方がundefinedならもう片方を返し、両方undefinedならundefinedを返す", () => {
    expect(worseBackendHealth(undefined, "ok")).toBe("ok");
    expect(worseBackendHealth("warning", undefined)).toBe("warning");
    expect(worseBackendHealth(undefined, undefined)).toBeUndefined();
  });
});

describe("backendHealthByIp", () => {
  it("state名リストのIPだけを載せ、挙がらないIPは載せない", () => {
    const byIp = backendHealthByIp({
      status: "CRITICAL",
      criticalStateBackendNames: ["10.0.1.10:32704"],
      warningStateBackendNames: ["10.0.1.11:32704"],
      unknownStateBackendNames: ["10.0.1.12:32704"],
    });
    expect([...byIp]).toEqual([
      ["10.0.1.10", "critical"],
      ["10.0.1.11", "warning"],
      ["10.0.1.12", "unknown"],
    ]);
    expect(byIp.get("10.0.1.13")).toBeUndefined();
  });

  it("同じIPが複数ポートで挙がれば深刻な方を採る", () => {
    const byIp = backendHealthByIp({
      criticalStateBackendNames: ["10.0.1.10:443"],
      warningStateBackendNames: ["10.0.1.10:80"],
    });
    expect(byIp.get("10.0.1.10")).toBe("critical");
  });

  it("リストを持たないヘルスは空のまま返す", () => {
    expect([...backendHealthByIp({ status: "OK", totalBackendCount: 3 })]).toEqual([]);
  });
});

describe("unlistedBackendHealth", () => {
  it("set全体がUNKNOWNのときだけunknownにする", () => {
    expect(unlistedBackendHealth({ status: "UNKNOWN" })).toBe("unknown");
  });

  it("OK・WARNING・CRITICAL・status無しはokのまま", () => {
    expect(unlistedBackendHealth({ status: "OK" })).toBe("ok");
    expect(unlistedBackendHealth({ status: "WARNING" })).toBe("ok");
    expect(unlistedBackendHealth({ status: "CRITICAL" })).toBe("ok");
    expect(unlistedBackendHealth({})).toBe("ok");
  });
});
