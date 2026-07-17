import { describe, expect, it } from "vitest";
import { parseCredJson } from "./auth-contract";

const API_KEY_CRED = {
  type: "api_key",
  tenancy: "ocid1.tenancy.oc1..t",
  user: "ocid1.user.oc1..u",
  fingerprint: "aa:bb",
  region: "ap-tokyo-1",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\n...",
};

describe("parseCredJson", () => {
  it("api_key型の全フィールドが揃っていれば成功する", () => {
    const result = parseCredJson(JSON.stringify(API_KEY_CRED));
    expect(result).toEqual({ ok: true, cred: API_KEY_CRED });
  });

  it("security_token型の全フィールドが揃っていれば成功する", () => {
    const cred = {
      type: "security_token",
      token: "eyJ...",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\n...",
      region: "ap-tokyo-1",
      tenancy: "ocid1.tenancy.oc1..t",
    };
    const result = parseCredJson(JSON.stringify(cred));
    expect(result).toEqual({ ok: true, cred });
  });

  it("JSONとして不正な入力はinvalid_json(値を含めない)", () => {
    expect(parseCredJson("not-json {")).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("配列・null・非オブジェクトはinvalid_json", () => {
    expect(parseCredJson("null")).toEqual({ ok: false, reason: "invalid_json" });
    expect(parseCredJson('"text"')).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("未知のtypeはunknown_type(type値をエコーしない)", () => {
    const result = parseCredJson(JSON.stringify({ ...API_KEY_CRED, type: "instance_principal" }));
    expect(result).toEqual({ ok: false, reason: "unknown_type" });
  });

  it("欠落フィールドはフィールド名のみ返す", () => {
    const { privateKeyPem: _omit, region: _omit2, ...partial } = API_KEY_CRED;
    const result = parseCredJson(JSON.stringify(partial));
    expect(result).toEqual({ ok: false, reason: "missing_fields", missing: ["region", "privateKeyPem"] });
  });

  it("空文字列のフィールドは欠落扱い", () => {
    const result = parseCredJson(JSON.stringify({ ...API_KEY_CRED, tenancy: "" }));
    expect(result).toEqual({ ok: false, reason: "missing_fields", missing: ["tenancy"] });
  });
});
