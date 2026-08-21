import { describe, expect, it } from "vitest";
import type { OciDnsZone } from "../oci/types";
import { findZoneForHost } from "./dns-zone-match";

function zone(name: string): OciDnsZone {
  return { id: `ocid1.dns-zone.oc1..${name}`, name };
}

const ZONES: OciDnsZone[] = [zone("example.org"), zone("staging.example.org"), zone("example.com")];

describe("findZoneForHost", () => {
  it("ゾーン名と完全一致するホストはそのゾーンを返す", () => {
    expect(findZoneForHost("example.org", ZONES)?.name).toBe("example.org");
  });

  it("サブドメインは親ゾーンに収まる", () => {
    expect(findZoneForHost("app.example.com", ZONES)?.name).toBe("example.com");
  });

  it("複数ゾーンに収まるホストは最長一致を選ぶ", () => {
    expect(findZoneForHost("app.staging.example.org", ZONES)?.name).toBe("staging.example.org");
  });

  it("ゾーン名の部分文字列で終わるだけのホストは一致しない", () => {
    expect(findZoneForHost("notexample.org", ZONES)).toBeUndefined();
  });

  it("どのゾーンにも属さないホストはundefined", () => {
    expect(findZoneForHost("app.example.net", ZONES)).toBeUndefined();
  });

  it("末尾ドット付きのホストも一致する", () => {
    expect(findZoneForHost("app.example.org.", ZONES)?.name).toBe("example.org");
  });

  it("大文字小文字は区別しない", () => {
    expect(findZoneForHost("APP.Example.ORG", ZONES)?.name).toBe("example.org");
    expect(findZoneForHost("app.example.org", [zone("EXAMPLE.ORG")])?.name).toBe("EXAMPLE.ORG");
  });

  it("ゾーンが空なら一致なし", () => {
    expect(findZoneForHost("app.example.org", [])).toBeUndefined();
  });

  it("同名ゾーンが併存するとACTIVEを優先する", () => {
    const deleting: OciDnsZone = {
      ...zone("example.com"),
      id: "ocid1.dns-zone.oc1..deleting",
      "lifecycle-state": "DELETING",
    };
    const active: OciDnsZone = {
      ...zone("example.com"),
      id: "ocid1.dns-zone.oc1..active",
      "lifecycle-state": "ACTIVE",
    };

    expect(findZoneForHost("app.example.com", [deleting, active])?.id).toBe(active.id);
    expect(findZoneForHost("app.example.com", [active, deleting])?.id).toBe(active.id);
  });

  it("lifecycle-stateを欠くゾーンだけでも最長一致が返る", () => {
    expect(findZoneForHost("app.staging.example.org", ZONES)?.name).toBe("staging.example.org");
  });

  it("name/idを欠く要素が混ざっていても他のゾーンは正しく判定する", () => {
    const malformed = { id: undefined, name: undefined } as unknown as OciDnsZone;
    expect(findZoneForHost("app.example.com", [malformed, ...ZONES])?.name).toBe("example.com");
  });
});
