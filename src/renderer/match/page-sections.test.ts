import { describe, expect, it } from "vitest";
import { sectionsForPage, TOPOLOGY_SECTION_LABEL, TOPOLOGY_SECTIONS } from "./page-sections";

describe("sectionsForPage", () => {
  it("maps nodes page to instances + nodePools", () => {
    expect(sectionsForPage("nodes")).toEqual(["instances", "nodePools"]);
  });

  it("maps service-lb page to taggedResources + nlbs + lbs", () => {
    expect(sectionsForPage("service-lb")).toEqual(["taggedResources", "nlbs", "lbs"]);
  });

  it("maps pv-storage page to taggedResources + volumes + fileSystems (taggedResources shared with service-lb)", () => {
    expect(sectionsForPage("pv-storage")).toEqual(["taggedResources", "volumes", "fileSystems"]);
  });

  it("maps network page to lb/nlb (service-lbと共有) + nodePools + wafs + network複合セクション", () => {
    expect(sectionsForPage("network")).toEqual(["nodePools", "taggedResources", "nlbs", "lbs", "wafs", "network"]);
  });

  it("topologyページは他4ページのセクション和 + vcnを要求する", () => {
    const others = new Set(
      (["nodes", "service-lb", "pv-storage", "network"] as const).flatMap((page) => sectionsForPage(page)),
    );
    expect(new Set(sectionsForPage("topology"))).toEqual(new Set([...others, "vcn"]));
  });
});

describe("TOPOLOGY_SECTIONS", () => {
  it("複合セクションを型別list単位まで割った進捗の分母になる", () => {
    expect([...TOPOLOGY_SECTIONS]).toEqual([
      "cluster",
      "taggedResources",
      "instances",
      "nodePools",
      "lbs",
      "nlbs",
      "wafs",
      "volumes",
      "volumeBackupPolicies",
      "fileSystems",
      "fssSnapshotPolicies",
      "vcn",
      "subnets",
      "routeTables",
      "securityLists",
      "nsgs",
      "gateways",
      "managedCerts",
      "dnsChecks",
      "dnsZones",
    ]);
  });

  it("初回描画が待つ図の材料以外のセクションも分母に含む", () => {
    expect(TOPOLOGY_SECTIONS).toEqual(
      expect.arrayContaining(["securityLists", "nsgs", "managedCerts", "dnsChecks", "taggedResources"]),
    );
  });

  it("全セクションにラベルが対応する", () => {
    for (const section of TOPOLOGY_SECTIONS) {
      expect(TOPOLOGY_SECTION_LABEL[section]).toBeTruthy();
    }
  });
});
