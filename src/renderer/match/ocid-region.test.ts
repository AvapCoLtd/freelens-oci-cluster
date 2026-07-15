import { describe, expect, it } from "vitest";
import { extractRegionFromOcid } from "./ocid-region";

describe("extractRegionFromOcid", () => {
  it("extracts the region segment", () => {
    expect(extractRegionFromOcid("ocid1.instance.oc1.ap-tokyo-1.aaaaexample1234")).toBe("ap-tokyo-1");
  });

  it("returns undefined when the region segment is empty", () => {
    expect(extractRegionFromOcid("ocid1.tenancy.oc1..aaaaexample1234")).toBeUndefined();
  });

  it("returns undefined when the OCID has too few segments", () => {
    expect(extractRegionFromOcid("ocid1.instance.oc1")).toBeUndefined();
  });

  it("normalizes underscore-separated region segments (FSS OCIDs, 実機確認済み)", () => {
    expect(extractRegionFromOcid("ocid1.filesystem.oc1.ap_tokyo_1.aaaaexample1234")).toBe("ap-tokyo-1");
  });
});
