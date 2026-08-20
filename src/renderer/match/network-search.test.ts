import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OciResult } from "../oci/result";
import type { OciNsg, OciNsgRule, OciRouteTable, OciSecurityList, OciWafPolicy } from "../oci/types";
import type { LbRow, SubnetRow, WafRow } from "./network-path";
import {
  allSearchValues,
  dnsSearchValues,
  type LbSearchContext,
  lbSearchValues,
  matchedOnlyInDetail,
  nsgSearchValues,
  type SearchValue,
  type SubnetSearchContext,
  subnetSearchValues,
  wafSearchValues,
} from "./network-search";

const STDOUT_DIR = join(import.meta.dirname, "..", "cli", "__fixtures__", "stdout");

function fixture<T>(file: string): T {
  return (JSON.parse(readFileSync(join(STDOUT_DIR, file), "utf8")) as { data: T }).data;
}

function ok<T>(data: T): OciResult<T> {
  return { ok: true, data };
}

function texts(values: readonly SearchValue[]): string[] {
  return values.filter((value) => value !== undefined).map(String);
}

const SECURITY_LIST = fixture<OciSecurityList>("12-network-security-list-get.json");
const ROUTE_TABLE = fixture<OciRouteTable>("13-network-route-table-get.json");
const NSG = fixture<OciNsg>("14a-network-nsg-get.json");
const NSG_RULES = fixture<OciNsgRule[]>("14b-network-nsg-rules-list.json");
const WAF_POLICY = fixture<OciWafPolicy>("15-waf-web-app-firewall-policy-get.json");

const SL_ID = SECURITY_LIST.id;
const RT_ID = ROUTE_TABLE.id;
const NSG_ID = NSG.id;
const NAT_GATEWAY_ID = "ocid1.natgateway.oc1.ap-tokyo-1.aaaaexample0001";

const EMPTY_SUBNET_CONTEXT: SubnetSearchContext = { securityLists: {}, routeTables: {}, gateways: {} };

const SUBNET_ROW: SubnetRow = {
  subnetId: "ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0001",
  roles: ["node"],
  vcnId: "ocid1.vcn.oc1.ap-tokyo-1.aaaaexample0001",
  displayName: "example-k8s-node-subnet",
  cidrBlock: "10.0.10.80/28",
  prohibitPublicIpOnVnic: true,
  securityListIds: [SL_ID],
  routeTableId: RT_ID,
};

const LOADED_SUBNET_CONTEXT: SubnetSearchContext = {
  securityLists: { [SL_ID]: ok(SECURITY_LIST) },
  routeTables: { [RT_ID]: ok(ROUTE_TABLE) },
  gateways: {
    [NAT_GATEWAY_ID]: ok({ kind: "natgateway", displayName: "example-nat-gateway", blockTraffic: true }),
  },
};

describe("subnetSearchValues", () => {
  it("サマリに表示名・CIDR・role・public IP可否が入る", () => {
    const values = texts(subnetSearchValues(SUBNET_ROW, EMPTY_SUBNET_CONTEXT).summary);
    expect(values).toEqual(["example-k8s-node-subnet", "10.0.10.80/28", "Node", "Prohibited"]);
  });

  it("展開領域にSLの名前とルール(protocol/peer/description)が入る", () => {
    const values = texts(subnetSearchValues(SUBNET_ROW, LOADED_SUBNET_CONTEXT).detail);
    expect(values).toContain("securitylist20240712190211");
    expect(values).toContain("TCP");
    expect(values).toContain("10.0.10.96/28");
    expect(values).toContain("Auto Created from-lb-01-network");
  });

  it("展開領域にRTの名前・ルート宛先・ゲートウェイ状態が入る", () => {
    const values = texts(subnetSearchValues(SUBNET_ROW, LOADED_SUBNET_CONTEXT).detail);
    expect(values).toContain("example-k8s-node-route");
    expect(values).toContain("0.0.0.0/0");
    expect(values).toContain("NAT Gateway");
    expect(values).toContain("example-nat-gateway");
    expect(values).toContain("Blocking");
  });

  it("SL/RT未取得でも落ちず、見出しに出るOCIDが検索値に残る", () => {
    const values = texts(subnetSearchValues(SUBNET_ROW, EMPTY_SUBNET_CONTEXT).detail);
    expect(values).toEqual([SL_ID, RT_ID]);
  });

  it("subnet自体が未取得(OCIDのみ)の行でも落ちない", () => {
    const row: SubnetRow = { subnetId: "ocid1.subnet.oc1..pending", roles: [], securityListIds: [] };
    expect(texts(allSearchValues(subnetSearchValues(row, EMPTY_SUBNET_CONTEXT)))).toEqual([
      "ocid1.subnet.oc1..pending",
      "-",
      "-",
    ]);
  });
});

describe("nsgSearchValues", () => {
  it("NSG名とルールが入る", () => {
    const values = texts(nsgSearchValues(NSG_ID, { [NSG_ID]: ok({ nsg: NSG, rules: NSG_RULES }) }));
    expect(values).toContain("public-ssh-nsg");
    expect(values).toContain("ingress");
    expect(values).toContain("TCP");
    expect(values).toContain("0.0.0.0/0");
    expect(values).toContain("22");
  });

  it("未取得でも落ちず、OCIDのみを返す", () => {
    expect(texts(nsgSearchValues(NSG_ID, {}))).toEqual([NSG_ID]);
  });
});

const LB_ROW: LbRow = {
  id: "ocid1.loadbalancer.oc1.ap-tokyo-1.aaaaexample0003",
  kind: "lb",
  displayName: "client-a-staging-lb",
  lifecycleState: "ACTIVE",
  ips: ["203.0.113.6"],
  isPrivate: false,
  subnetIds: ["ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0002"],
  nsgIds: [NSG_ID],
  listeners: [{ name: "https-dev_client-b", port: 443, protocol: "HTTP2" }],
  backendSetNames: ["backend-dev-client-b"],
  certificates: [
    {
      name: "star-example-org",
      validTo: "2026-03-01T00:00:00.000Z",
      subject: "CN=*.example.org",
      sans: "DNS:*.example.org, DNS:example.org",
      listenerNames: ["https-dev_client-b"],
    },
  ],
  managedCertificateIds: ["ocid1.certificate.oc1.ap-tokyo-1.aaaaexample0001"],
};

const EMPTY_LB_CONTEXT: LbSearchContext = { nsgs: {}, managedCerts: {}, backendHealthOf: () => undefined };

const LOADED_LB_CONTEXT: LbSearchContext = {
  nsgs: { [NSG_ID]: ok({ nsg: NSG, rules: NSG_RULES }) },
  managedCerts: {
    "ocid1.certificate.oc1.ap-tokyo-1.aaaaexample0001": ok({ name: "managed-cert", validTo: "2026-05-05T00:00:00Z" }),
  },
  backendHealthOf: (name) =>
    name === "backend-dev-client-b"
      ? ok({ status: "CRITICAL", totalBackendCount: 3, criticalStateBackendNames: ["10.0.10.85:31234"] })
      : undefined,
};

describe("lbSearchValues", () => {
  it("サマリに名前・種別・IP・公開種別・lifecycle-stateが入る", () => {
    const values = texts(lbSearchValues(LB_ROW, EMPTY_LB_CONTEXT).summary);
    expect(values).toEqual(["client-a-staging-lb", "classic", "203.0.113.6", "public", "ACTIVE"]);
  });

  it("展開領域にlistener・証明書・バックエンド健全性・NSGルールが入る", () => {
    const values = texts(lbSearchValues(LB_ROW, LOADED_LB_CONTEXT).detail);
    expect(values).toContain("https-dev_client-b(HTTP2:443)");
    expect(values).toContain("managed-cert");
    expect(values).toContain("2026-05-05T00:00:00Z");
    expect(values).toContain("star-example-org");
    expect(values).toContain("CN=*.example.org");
    expect(values).toContain("DNS:*.example.org, DNS:example.org");
    expect(values).toContain("backend-dev-client-b");
    expect(values).toContain("CRITICAL");
    expect(values).toContain("3");
    expect(values).toContain("10.0.10.85:31234");
    expect(values).toContain("public-ssh-nsg");
    expect(values).toContain("22");
  });

  it("backend health・managedCerts・NSGが未取得でも落ちない", () => {
    const values = texts(lbSearchValues(LB_ROW, EMPTY_LB_CONTEXT).detail);
    expect(values).toContain("backend-dev-client-b");
    expect(values).toContain("ocid1.certificate.oc1.ap-tokyo-1.aaaaexample0001");
    expect(values).toContain(NSG_ID);
    expect(values).not.toContain("CRITICAL");
  });
});

const WAF_ROW: WafRow = {
  id: "ocid1.webappfirewall.oc1.ap-tokyo-1.aaaaexample0001",
  displayName: "client-a-release-waf",
  lifecycleState: "ACTIVE",
  policyId: "ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.aaaaexample0001",
  targetLbId: LB_ROW.id,
  targetLbName: "client-a-staging-lb",
};

describe("wafSearchValues", () => {
  it("サマリにWAF名・対象LB・lifecycle-stateが入る", () => {
    const values = texts(wafSearchValues(WAF_ROW, {}).summary);
    expect(values).toEqual(["client-a-release-waf", "client-a-staging-lb", "ACTIVE"]);
  });

  it("展開領域にポリシー名・既定アクション・ルール名/アクション/条件が入る", () => {
    const policyId = WAF_ROW.policyId as string;
    const values = texts(wafSearchValues(WAF_ROW, { [policyId]: ok(WAF_POLICY) }).detail);
    expect(values).toContain("client-a-release-waf-policy");
    expect(values).toContain("ALLOW (ALLOW)");
    expect(values).toContain("developer_allow_host_rule");
    expect(values).toContain("Request Control");
    expect(values.some((value) => value.includes("grafana.client-a.example.org"))).toBe(true);
  });

  it("ポリシー未取得でも落ちず、見出しに出るOCIDが検索値に残る", () => {
    expect(texts(wafSearchValues(WAF_ROW, {}).detail)).toEqual([WAF_ROW.policyId]);
  });

  it("ポリシーOCID自体が未取得でも落ちない", () => {
    expect(texts(wafSearchValues({ ...WAF_ROW, policyId: undefined }, {}).detail)).toEqual([]);
  });
});

describe("dnsSearchValues", () => {
  it("hostname・解決IP・一致LB名・結果文言が入る", () => {
    const values = texts(
      dnsSearchValues({
        host: "app.example.org",
        resolvedIps: ["203.0.113.6"],
        matchedLbNames: ["client-a-staging-lb"],
        statusLabel: "Matched",
      }),
    );
    expect(values).toEqual(["app.example.org", "203.0.113.6", "client-a-staging-lb", "Matched"]);
  });

  it("解決失敗行はエラーメッセージでも引ける", () => {
    const values = texts(
      dnsSearchValues({
        host: "app.example.org",
        resolvedIps: [],
        matchedLbNames: [],
        statusLabel: "Resolution failed",
        errorMessage: "Resolution failed: getaddrinfo ENOTFOUND",
      }),
    );
    expect(values).toContain("Resolution failed: getaddrinfo ENOTFOUND");
  });
});

describe("matchedOnlyInDetail", () => {
  const values = { summary: ["client-a-staging-lb", "classic"], detail: ["CRITICAL", "10.0.10.85:31234"] };

  it("queryが空なら自動展開しない", () => {
    expect(matchedOnlyInDetail("", values)).toBe(false);
    expect(matchedOnlyInDetail("   ", values)).toBe(false);
  });

  it("サマリ行に一致するなら自動展開しない", () => {
    expect(matchedOnlyInDetail("staging", values)).toBe(false);
  });

  it("展開領域にしか無い値で一致したら自動展開する", () => {
    expect(matchedOnlyInDetail("critical", values)).toBe(true);
  });

  it("トークンの一部が展開領域にしか無い場合も自動展開する", () => {
    expect(matchedOnlyInDetail("staging critical", values)).toBe(true);
  });
});
