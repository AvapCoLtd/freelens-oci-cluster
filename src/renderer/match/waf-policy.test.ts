import { describe, expect, it } from "vitest";
import type { OciWafPolicy } from "../sdk/types";
import { wafDefaultAction, wafPolicyRuleRows } from "./waf-policy";

const POLICY = {
  id: "ocid1.webappfirewallpolicy.oc1..p",
  displayName: "policy-1",
  actions: [
    { name: "allowAction", type: "ALLOW" },
    { name: "blockAction", type: "RETURN_HTTP_RESPONSE" },
  ],
  requestAccessControl: {
    defaultActionName: "blockAction",
    rules: [
      {
        type: "ACCESS_CONTROL",
        name: "allow-office-ip",
        actionName: "allowAction",
        condition: "i_contains(['1.2.3.4'], connection.source.address)",
      },
    ],
  },
  requestRateLimiting: {
    rules: [
      {
        type: "REQUEST_RATE_LIMITING",
        name: "limit-login",
        actionName: "blockAction",
        configurations: [{ periodInSeconds: 60, requestsLimit: 100, actionDurationInSeconds: 300 }],
      },
    ],
  },
  requestProtection: {
    rules: [
      {
        type: "PROTECTION",
        name: "owasp",
        actionName: "blockAction",
        protectionCapabilities: [{ key: "920360", version: 1 }],
      },
    ],
  },
} as unknown as OciWafPolicy;

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
    expect(wafPolicyRuleRows({ id: "x", displayName: "empty" } as OciWafPolicy)).toEqual([]);
  });
});

describe("wafDefaultAction", () => {
  it("既定アクションを種別つきで返す", () => {
    expect(wafDefaultAction(POLICY)).toBe("blockAction (RETURN_HTTP_RESPONSE)");
  });

  it("未定義なら-", () => {
    expect(wafDefaultAction({ id: "x", displayName: "empty" } as OciWafPolicy)).toBe("-");
  });
});
