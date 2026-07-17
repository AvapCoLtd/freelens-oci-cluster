import { describe, expect, it } from "vitest";
import { collectHostnames, matchDnsToLbs } from "./dns-check";

describe("collectHostnames", () => {
  it("Ingressのrules/tlsとServiceのexternal-dnsアノテーションから重複なしで集める", () => {
    const ingresses = [
      {
        spec: {
          rules: [{ host: "app.example.com" }, { host: "api.example.com" }],
          tls: [{ hosts: ["app.example.com", "tls-only.example.com"] }],
        },
      },
      { spec: {} },
    ];
    const services = [
      {
        metadata: { annotations: { "external-dns.alpha.kubernetes.io/hostname": "svc.example.com, api.example.com" } },
      },
      { metadata: {} },
    ];
    expect(collectHostnames(ingresses, services).sort()).toEqual([
      "api.example.com",
      "app.example.com",
      "svc.example.com",
      "tls-only.example.com",
    ]);
  });

  it("ワイルドカードホストは除外する(resolve不能)", () => {
    expect(collectHostnames([{ spec: { rules: [{ host: "*.example.com" }] } }], [])).toEqual([]);
  });
});

describe("matchDnsToLbs", () => {
  const LBS = [
    { displayName: "lb-1", ips: ["140.1.2.3", "10.0.0.5"] },
    { displayName: "nlb-1", ips: ["131.9.8.7"] },
  ];

  it("解決IPがLBのIPに一致すればmatched", () => {
    expect(matchDnsToLbs(["140.1.2.3"], LBS)).toEqual({ kind: "matched", matchedLbNames: ["lb-1"] });
  });

  it("一致しなければunmatched(古いLBを指している可能性)", () => {
    expect(matchDnsToLbs(["203.0.113.9"], LBS)).toEqual({ kind: "unmatched", matchedLbNames: [] });
  });

  it("解決結果が空ならunresolved", () => {
    expect(matchDnsToLbs([], LBS)).toEqual({ kind: "unresolved", matchedLbNames: [] });
  });
});
