import { describe, expect, it } from "vitest";
import type { OciNsgRule, OciRouteTable, OciSecurityList } from "../sdk/types";
import { nsgRuleRows, protocolLabel, routeRows, securityListRuleRows } from "./rule-rows";

describe("securityListRuleRows", () => {
  it("ingress/egressをdirection付きで平坦化し、ポート範囲を整形する", () => {
    const sl = {
      ingressSecurityRules: [
        {
          source: "0.0.0.0/0",
          protocol: "6",
          isStateless: false,
          tcpOptions: { destinationPortRange: { min: 30000, max: 32767 } },
          description: "NodePort",
        },
        { source: "10.0.0.0/16", protocol: "all" },
      ],
      egressSecurityRules: [
        { destination: "0.0.0.0/0", protocol: "17", udpOptions: { destinationPortRange: { min: 53, max: 53 } } },
      ],
    } as unknown as OciSecurityList;
    expect(securityListRuleRows(sl)).toEqual([
      {
        direction: "ingress",
        protocol: "TCP",
        peer: "0.0.0.0/0",
        ports: "30000-32767",
        stateless: false,
        description: "NodePort",
      },
      {
        direction: "ingress",
        protocol: "all",
        peer: "10.0.0.0/16",
        ports: "-",
        stateless: false,
        description: undefined,
      },
      {
        direction: "egress",
        protocol: "UDP",
        peer: "0.0.0.0/0",
        ports: "53",
        stateless: false,
        description: undefined,
      },
    ]);
  });

  it("ルール配列が無くてもthrowしない", () => {
    expect(securityListRuleRows({} as OciSecurityList)).toEqual([]);
  });
});

describe("nsgRuleRows", () => {
  it("EGRESSはdestination、INGRESSはsourceをpeerにする", () => {
    const rules = [
      {
        direction: "INGRESS",
        protocol: "6",
        source: "1.2.3.4/32",
        tcpOptions: { destinationPortRange: { min: 443, max: 443 } },
      },
      { direction: "EGRESS", protocol: "all", destination: "0.0.0.0/0" },
    ] as unknown as OciNsgRule[];
    expect(nsgRuleRows(rules)).toEqual([
      {
        direction: "ingress",
        protocol: "TCP",
        peer: "1.2.3.4/32",
        ports: "443",
        stateless: false,
        description: undefined,
      },
      { direction: "egress", protocol: "all", peer: "0.0.0.0/0", ports: "-", stateless: false, description: undefined },
    ]);
  });
});

describe("routeRows", () => {
  it("宛先エンティティ種別をOCIDから表示名にする", () => {
    const rt = {
      routeRules: [
        { destination: "0.0.0.0/0", networkEntityId: "ocid1.natgateway.oc1..x" },
        { destination: "192.168.100.0/24", networkEntityId: "ocid1.drg.oc1..y", description: "to onprem" },
      ],
    } as unknown as OciRouteTable;
    expect(routeRows(rt)).toEqual([
      {
        destination: "0.0.0.0/0",
        entityKind: "NAT Gateway",
        entityId: "ocid1.natgateway.oc1..x",
        description: undefined,
      },
      { destination: "192.168.100.0/24", entityKind: "DRG", entityId: "ocid1.drg.oc1..y", description: "to onprem" },
    ]);
  });
});

describe("protocolLabel", () => {
  it("既知番号は名前、未知番号はそのまま", () => {
    expect(protocolLabel("6")).toBe("TCP");
    expect(protocolLabel("58")).toBe("ICMPv6");
    expect(protocolLabel("47")).toBe("47");
    expect(protocolLabel(undefined)).toBe("-");
  });
});
