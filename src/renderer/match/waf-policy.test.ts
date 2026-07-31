import { describe, expect, it } from "vitest";
import type { OciWafPolicy } from "../oci/types";
import { wafDefaultAction, wafPolicyRuleRows } from "./waf-policy";

const POLICY: OciWafPolicy = {
  "display-name": "policy-1",
  actions: [
    { name: "allowAction", type: "ALLOW" },
    { name: "blockAction", type: "RETURN_HTTP_RESPONSE" },
  ],
  "request-access-control": {
    "default-action-name": "blockAction",
    rules: [
      {
        name: "allow-office-ip",
        "action-name": "allowAction",
        condition: "i_contains(['1.2.3.4'], connection.source.address)",
      },
    ],
  },
  "request-rate-limiting": {
    rules: [
      {
        name: "limit-login",
        "action-name": "blockAction",
        configurations: [{ "period-in-seconds": 60, "requests-limit": 100, "action-duration-in-seconds": 300 }],
      },
    ],
  },
  "request-protection": {
    rules: [
      {
        name: "owasp",
        "action-name": "blockAction",
        "protection-capabilities": [{ key: "920360" }],
      },
    ],
  },
};

describe("wafPolicyRuleRows", () => {
  it("全モジュールのルールをアクション種別・内容つきで平坦化する", () => {
    expect(wafPolicyRuleRows(POLICY)).toEqual([
      {
        module: "Request Control",
        name: "allow-office-ip",
        action: "allowAction (ALLOW)",
        detail: "i_contains(['1.2.3.4'], connection.source.address)",
      },
      {
        module: "Rate Limiting",
        name: "limit-login",
        action: "blockAction (RETURN_HTTP_RESPONSE)",
        detail: "100req/60s (block 300s)",
      },
      {
        module: "Request Protection",
        name: "owasp",
        action: "blockAction (RETURN_HTTP_RESPONSE)",
        detail: "920360",
      },
    ]);
  });

  it("ルールなしポリシーは空配列(throwしない)", () => {
    expect(wafPolicyRuleRows({ "display-name": "empty" })).toEqual([]);
  });
});

describe("wafDefaultAction", () => {
  it("既定アクションを種別つきで返す", () => {
    expect(wafDefaultAction(POLICY)).toBe("blockAction (RETURN_HTTP_RESPONSE)");
  });

  it("未定義なら-", () => {
    expect(wafDefaultAction({ "display-name": "empty" })).toBe("-");
  });
});
