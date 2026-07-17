import { describe, expect, it } from "vitest";
import type { OciRouteTable } from "../sdk/types";
import { gatewayHealth, gatewayIdsOfRouteTables, isSupportedGatewayId } from "./gateway-status";

describe("gatewayIdsOfRouteTables", () => {
  it("対応種別のゲートウェイOCIDを重複なしで集める", () => {
    const rts = [
      {
        routeRules: [
          { destination: "0.0.0.0/0", networkEntityId: "ocid1.natgateway.oc1..n1" },
          { destination: "10.0.0.0/8", networkEntityId: "ocid1.drg.oc1..d1" },
        ],
      },
      {
        routeRules: [
          { destination: "0.0.0.0/0", networkEntityId: "ocid1.natgateway.oc1..n1" },
          { destination: "10.1.0.0/16", networkEntityId: "ocid1.privateip.oc1..p1" },
        ],
      },
    ] as unknown as OciRouteTable[];
    expect(gatewayIdsOfRouteTables(rts).sort()).toEqual(["ocid1.drg.oc1..d1", "ocid1.natgateway.oc1..n1"]);
  });
});

describe("isSupportedGatewayId", () => {
  it("privateip等の非ゲートウェイ宛先は対象外", () => {
    expect(isSupportedGatewayId("ocid1.privateip.oc1..p1")).toBe(false);
    expect(isSupportedGatewayId(undefined)).toBe(false);
    expect(isSupportedGatewayId("ocid1.internetgateway.oc1..i1")).toBe(true);
  });
});

describe("gatewayHealth", () => {
  it("正常なゲートウェイはhealthy", () => {
    expect(gatewayHealth({ kind: "NAT Gateway", lifecycleState: "AVAILABLE", blockTraffic: false })).toEqual({
      label: "正常",
      healthy: true,
    });
  });

  it("IGW無効・NAT遮断・LPG未接続を検出する", () => {
    expect(gatewayHealth({ kind: "Internet Gateway", isEnabled: false, lifecycleState: "AVAILABLE" }).label).toBe(
      "無効",
    );
    expect(gatewayHealth({ kind: "NAT Gateway", blockTraffic: true, lifecycleState: "AVAILABLE" }).healthy).toBe(false);
    expect(gatewayHealth({ kind: "Local Peering Gateway", peeringStatus: "NEW" }).label).toBe("peering: NEW");
  });

  it("lifecycleState異常も拾う(ATTACHEDはDRGの正常状態として許容)", () => {
    expect(gatewayHealth({ kind: "DRG", lifecycleState: "PROVISIONING" }).healthy).toBe(false);
    expect(gatewayHealth({ kind: "DRG", lifecycleState: "ATTACHED" }).healthy).toBe(true);
  });
});
