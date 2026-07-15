import { describe, expect, it } from "vitest";
import { parseBareArrayEnvelope, parseItemsEnvelope } from "./oci-envelope";

// 実機の `oci nlb network-load-balancer list --output json` 応答を匿名化した回帰fixture。
// このコマンドは "data" 直下ではなく "data.items" に配列を持つ(実機検証済み)。
const NLB_LIST_RESPONSE = JSON.stringify({
  data: {
    items: [
      {
        id: "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaaexample0000000000000000000001",
        "display-name": "example-nlb-1",
        "lifecycle-state": "ACTIVE",
        "compartment-id": "ocid1.compartment.oc1..aaaaexamplecompartment0000000001",
        "ip-addresses": [{ "ip-address": "140.245.90.83", "is-public": true }],
      },
    ],
  },
});

// 実機の `oci compute instance list` / `oci lb load-balancer list` / `oci bv volume list` 応答を匿名化した回帰fixture。
// これらは "data" 直下が配列そのもの。
const BARE_ARRAY_RESPONSE = JSON.stringify({
  data: [
    {
      id: "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0000000000000000000002",
      "display-name": "example-instance-1",
      "lifecycle-state": "RUNNING",
    },
  ],
});

describe("parseItemsEnvelope", () => {
  it("extracts data.items as an iterable array (regression: nlb list is not a bare array)", () => {
    const items = parseItemsEnvelope<{ id: string }>(NLB_LIST_RESPONSE);
    expect(Array.isArray(items)).toBe(true);
    expect(() => [...items]).not.toThrow();
    expect(items).toEqual([
      {
        id: "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaaexample0000000000000000000001",
        "display-name": "example-nlb-1",
        "lifecycle-state": "ACTIVE",
        "compartment-id": "ocid1.compartment.oc1..aaaaexamplecompartment0000000001",
        "ip-addresses": [{ "ip-address": "140.245.90.83", "is-public": true }],
      },
    ]);
  });
});

describe("parseBareArrayEnvelope", () => {
  it("extracts data as the array itself", () => {
    expect(parseBareArrayEnvelope<{ id: string }>(BARE_ARRAY_RESPONSE)).toEqual([
      {
        id: "ocid1.instance.oc1.ap-tokyo-1.aaaaexample0000000000000000000002",
        "display-name": "example-instance-1",
        "lifecycle-state": "RUNNING",
      },
    ]);
  });

  it("treats empty stdout as an empty array (regression: zero-result list commands print nothing)", () => {
    expect(parseBareArrayEnvelope("")).toEqual([]);
  });

  it("treats whitespace-only stdout as an empty array", () => {
    expect(parseBareArrayEnvelope("   \n")).toEqual([]);
  });
});
