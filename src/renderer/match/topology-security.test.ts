import { describe, expect, it } from "vitest";
import type { OciSecurityRule } from "../oci/types";
import { portToken, type SecurityGraphInput, securityLinksOf, summarizePorts } from "./topology-security";

const SUBNET_LB = "ocid1.subnet.oc1.ap-tokyo-1.lb";
const SUBNET_NODE = "ocid1.subnet.oc1.ap-tokyo-1.node";
const SUBNET_ENDPOINT = "ocid1.subnet.oc1.ap-tokyo-1.endpoint";
const NSG_LB = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.nsglb";
const NSG_NODE = "ocid1.networksecuritygroup.oc1.ap-tokyo-1.nsgnode";
const LB = "ocid1.networkloadbalancer.oc1.ap-tokyo-1.nlb1";
const INSTANCE = "ocid1.instance.oc1.ap-tokyo-1.i1";

function tcp(port: number, source: string): OciSecurityRule {
  return { protocol: "6", source, "tcp-options": { "destination-port-range": { min: port, max: port } } };
}

function input(overrides: Partial<SecurityGraphInput> = {}): SecurityGraphInput {
  return {
    peers: [
      { nodeId: SUBNET_LB, cidrs: ["10.0.2.0/24"] },
      { nodeId: SUBNET_NODE, cidrs: ["10.0.1.0/24"] },
      { nodeId: SUBNET_ENDPOINT, cidrs: ["10.0.3.0/29"] },
    ],
    subnetIngress: [],
    nsgIngress: [],
    vcnCidrs: ["10.0.0.0/16"],
    ...overrides,
  };
}

describe("portToken", () => {
  it("プロトコル名とポートを組む", () => {
    expect(portToken(tcp(443, "10.0.2.0/24"))).toBe("tcp/443");
    expect(portToken({ protocol: "17", "udp-options": { "destination-port-range": { min: 53, max: 53 } } })).toBe(
      "udp/53",
    );
  });

  it("範囲指定はmin-maxで出す", () => {
    expect(portToken({ protocol: "6", "tcp-options": { "destination-port-range": { min: 30000, max: 32767 } } })).toBe(
      "tcp/30000-32767",
    );
  });

  it("ポート指定の無いルールはプロトコル名だけになる", () => {
    expect(portToken({ protocol: "all" })).toBe("all");
    expect(portToken({ protocol: "1" })).toBe("icmp");
    expect(portToken({})).toBe("all");
  });

  it("名前を持たないプロトコル番号はそのまま出す", () => {
    expect(portToken({ protocol: "47" })).toBe("47");
  });
});

describe("summarizePorts", () => {
  it("重複を畳み、プロトコル→ポート番号順に並べる", () => {
    expect(summarizePorts(["tcp/6443", "tcp/443", "tcp/443", "udp/53"])).toBe("tcp/443, tcp/6443, udp/53");
  });

  it("4件までは全部並べる", () => {
    expect(summarizePorts(["tcp/80", "tcp/443", "tcp/6443", "tcp/10250"])).toBe("tcp/80, tcp/443, tcp/6443, tcp/10250");
  });

  it("4件を超えたら先頭1件と残り件数にする", () => {
    expect(summarizePorts(["tcp/443", "tcp/80", "tcp/6443", "tcp/10250", "tcp/12250", "udp/53"])).toBe("tcp/80 +5");
  });

  it("空入力は空文字", () => {
    expect(summarizePorts([])).toBe("");
  });
});

describe("securityLinksOf: Subnet間(security list)", () => {
  it("ingressのsource CIDRと重なるSubnetから許可先Subnetへ張る", () => {
    const links = securityLinksOf(
      input({ subnetIngress: [{ nodeId: SUBNET_NODE, rules: [tcp(10250, "10.0.2.0/24")] }] }),
    );
    expect(links).toEqual([{ kind: "sl-allow", source: SUBNET_LB, target: SUBNET_NODE, port: "tcp/10250" }]);
  });

  it("より広いsourceでも重なれば拾う", () => {
    const links = securityLinksOf(
      input({ subnetIngress: [{ nodeId: SUBNET_ENDPOINT, rules: [tcp(6443, "10.0.1.0/22")] }] }),
    );
    expect(links.map((link) => link.source)).toEqual([SUBNET_LB, SUBNET_NODE]);
  });

  it("VCN全体を含むsourceは捨てる(図中の全Subnetへ一斉に線が伸びる)", () => {
    const rules = [tcp(22, "10.0.0.0/16"), tcp(80, "0.0.0.0/0"), tcp(443, "10.0.0.0/8")];
    expect(securityLinksOf(input({ subnetIngress: [{ nodeId: SUBNET_NODE, rules }] }))).toEqual([]);
  });

  it("VCNのCIDRが分からなくても0.0.0.0/0は捨てる", () => {
    const links = securityLinksOf(
      input({ subnetIngress: [{ nodeId: SUBNET_NODE, rules: [tcp(80, "0.0.0.0/0")] }], vcnCidrs: [] }),
    );
    expect(links).toEqual([]);
  });

  it("自分自身のCIDRだけに重なるルールは線にしない", () => {
    expect(
      securityLinksOf(input({ subnetIngress: [{ nodeId: SUBNET_NODE, rules: [tcp(22, "10.0.1.0/24")] }] })),
    ).toEqual([]);
  });

  it("CIDRとして読めないsource(サービスCIDRラベル)は捨てる", () => {
    const rules: OciSecurityRule[] = [{ protocol: "6", source: "all-nrt-services-in-oracle-services-network" }];
    expect(securityLinksOf(input({ subnetIngress: [{ nodeId: SUBNET_NODE, rules }] }))).toEqual([]);
  });
});

describe("securityLinksOf: リソース間(NSG)", () => {
  const peers = [
    { nodeId: LB, nsgIds: [NSG_LB], ips: ["10.0.2.5"] },
    { nodeId: INSTANCE, nsgIds: [NSG_NODE], ips: ["10.0.1.10"] },
  ];

  it("sourceが相手NSGを指すルールはリソース間の線になる", () => {
    const links = securityLinksOf(
      input({ peers, nsgIngress: [{ nodeId: INSTANCE, nsgId: NSG_NODE, rules: [tcp(10250, NSG_LB)] }] }),
    );
    expect(links).toEqual([{ kind: "nsg-allow", source: LB, target: INSTANCE, port: "tcp/10250" }]);
  });

  it("適用先自身が属するNSGからの許可は捨てる(NSG内の総当たりになる)", () => {
    const sharedPeers = [
      { nodeId: LB, nsgIds: [NSG_NODE], ips: [] },
      { nodeId: INSTANCE, nsgIds: [NSG_NODE], ips: [] },
    ];
    const links = securityLinksOf(
      input({
        peers: sharedPeers,
        nsgIngress: [{ nodeId: INSTANCE, nsgId: NSG_NODE, rules: [tcp(10250, NSG_NODE)] }],
      }),
    );
    expect(links).toEqual([]);
  });

  it("sourceがCIDRのときは図中リソースのIPと突合する", () => {
    const links = securityLinksOf(
      input({ peers, nsgIngress: [{ nodeId: INSTANCE, nsgId: NSG_NODE, rules: [tcp(10250, "10.0.2.0/24")] }] }),
    );
    expect(links).toEqual([{ kind: "nsg-allow", source: LB, target: INSTANCE, port: "tcp/10250" }]);
  });

  it("どのリソースのIPとも当たらないCIDRは線にしない", () => {
    const links = securityLinksOf(
      input({ peers, nsgIngress: [{ nodeId: INSTANCE, nsgId: NSG_NODE, rules: [tcp(10250, "192.168.0.0/24")] }] }),
    );
    expect(links).toEqual([]);
  });

  it("VCN全体を含むsourceはNSG側でも捨てる", () => {
    const links = securityLinksOf(
      input({ peers, nsgIngress: [{ nodeId: INSTANCE, nsgId: NSG_NODE, rules: [tcp(22, "10.0.0.0/16")] }] }),
    );
    expect(links).toEqual([]);
  });

  it("同じペアの複数ルールはそれぞれリンクになり、集約は呼び出し側に委ねる", () => {
    const rules = [tcp(10250, NSG_LB), tcp(30000, NSG_LB)];
    const links = securityLinksOf(input({ peers, nsgIngress: [{ nodeId: INSTANCE, nsgId: NSG_NODE, rules }] }));
    expect(links.map((link) => link.port)).toEqual(["tcp/10250", "tcp/30000"]);
  });
});
