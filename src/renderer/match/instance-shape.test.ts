import { describe, expect, it } from "vitest";
import type { OciInstance } from "../oci/types";
import { ocpuMemoryText, placementSummary, shapeSummary, shapeText } from "./instance-shape";

function instance(overrides: Partial<OciInstance>): OciInstance {
  return { id: "ocid1.instance.oc1.ap-tokyo-1.i1", ...overrides };
}

const FLEX = "VM.Standard.E4.Flex";

describe("shapeText / shapeSummary", () => {
  it("shapeとocpus/memoryを両方出す", () => {
    const target = instance({ shape: FLEX, "shape-config": { ocpus: 2, "memory-in-gbs": 16 } });
    expect(shapeText(target)).toBe("VM.Standard.E4.Flex 2 OCPU / 16 GB");
    expect(shapeSummary(target)).toBe("VM.Standard.E4.Flex 2c/16G");
  });

  it("ocpusだけならOCPUだけを添える", () => {
    const target = instance({ shape: FLEX, "shape-config": { ocpus: 4 } });
    expect(shapeText(target)).toBe("VM.Standard.E4.Flex 4 OCPU");
    expect(shapeSummary(target)).toBe("VM.Standard.E4.Flex 4c");
  });

  it("memoryだけならメモリだけを添える", () => {
    const target = instance({ shape: FLEX, "shape-config": { "memory-in-gbs": 32 } });
    expect(shapeText(target)).toBe("VM.Standard.E4.Flex 32 GB");
    expect(shapeSummary(target)).toBe("VM.Standard.E4.Flex 32G");
  });

  it("shape-configが無ければshapeだけを出す", () => {
    const target = instance({ shape: "VM.Standard2.1" });
    expect(shapeText(target)).toBe("VM.Standard2.1");
    expect(shapeSummary(target)).toBe("VM.Standard2.1");
  });

  it("shapeもshape-configも無ければ値を持たない", () => {
    expect(shapeText(instance({}))).toBeUndefined();
    expect(shapeSummary(instance({}))).toBeUndefined();
  });

  it("ocpus=0も値として出す(未設定と区別する)", () => {
    const target = instance({ shape: FLEX, "shape-config": { ocpus: 0, "memory-in-gbs": 16 } });
    expect(shapeText(target)).toBe("VM.Standard.E4.Flex 0 OCPU / 16 GB");
    expect(shapeSummary(target)).toBe("VM.Standard.E4.Flex 0c/16G");
  });

  it("shapeが無くてもshape-configだけでサイズを出す", () => {
    const target = instance({ "shape-config": { ocpus: 2, "memory-in-gbs": 16 } });
    expect(shapeText(target)).toBe("2 OCPU / 16 GB");
    expect(shapeSummary(target)).toBe("2c/16G");
  });
});

describe("ocpuMemoryText", () => {
  it("両方あればスラッシュで並べる", () => {
    expect(ocpuMemoryText(instance({ "shape-config": { ocpus: 2, "memory-in-gbs": 16 } }))).toBe("2 / 16 GB");
  });

  it("片方だけならその値だけを出す", () => {
    expect(ocpuMemoryText(instance({ "shape-config": { ocpus: 2 } }))).toBe("2");
    expect(ocpuMemoryText(instance({ "shape-config": { "memory-in-gbs": 16 } }))).toBe("16 GB");
  });

  it("ocpus=0も値として出す", () => {
    expect(ocpuMemoryText(instance({ "shape-config": { ocpus: 0 } }))).toBe("0");
  });

  it("shape-configもInstanceも無ければ値を持たない", () => {
    expect(ocpuMemoryText(instance({ shape: FLEX }))).toBeUndefined();
    expect(ocpuMemoryText(undefined)).toBeUndefined();
  });
});

describe("placementSummary", () => {
  it("AD/FDを短縮して並べる", () => {
    const target = instance({ "availability-domain": "kIdk:AP-TOKYO-1-AD-1", "fault-domain": "FAULT-DOMAIN-2" });
    expect(placementSummary(target)).toBe("AD-1 / FD-2");
  });

  it("短縮できない値は原文のまま出す", () => {
    const target = instance({ "availability-domain": "tokyo-ad-x", "fault-domain": "FD_2" });
    expect(placementSummary(target)).toBe("tokyo-ad-x / FD_2");
  });

  it("片方だけならその1つだけを出す", () => {
    expect(placementSummary(instance({ "availability-domain": "kIdk:AP-TOKYO-1-AD-3" }))).toBe("AD-3");
    expect(placementSummary(instance({ "fault-domain": "FAULT-DOMAIN-1" }))).toBe("FD-1");
  });

  it("どちらも無ければ値を持たない", () => {
    expect(placementSummary(instance({}))).toBeUndefined();
  });
});
