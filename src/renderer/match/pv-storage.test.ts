import { describe, expect, it } from "vitest";
import { distinctFileSystemOcids, getCsiSource, newFileSystemOcids, resolvePvStorage } from "./pv-storage";

describe("getCsiSource", () => {
  it("returns the csi field when present", () => {
    const csi = { driver: "fss.csi.oraclecloud.com", volumeHandle: "ocid1.filesystem.oc1..aaaa:10.0.0.5:/export" };
    expect(getCsiSource({ csi })).toEqual(csi);
  });

  it("returns undefined when csi is absent", () => {
    expect(getCsiSource({})).toBeUndefined();
  });
});

describe("resolvePvStorage", () => {
  it("resolves block volume CSI as block_volume with the volume OCID", () => {
    const ocid = "ocid1.volume.oc1.ap-tokyo-1.aaaaexample";
    expect(resolvePvStorage("blockvolume.csi.oraclecloud.com", ocid)).toEqual({ kind: "block_volume", ocid });
  });

  it("resolves FSS CSI volumeHandle by extracting the leading FileSystem OCID", () => {
    const fsOcid = "ocid1.filesystem.oc1.ap-tokyo-1.aaaaexample";
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${fsOcid}:10.0.0.5:/export/path`)).toEqual({
      kind: "file_system",
      ocid: fsOcid,
    });
  });

  it("marks unrecognized CSI drivers as unsupported", () => {
    expect(resolvePvStorage("csi.other.example.com", "whatever")).toEqual({ kind: "unsupported" });
  });

  it("marks missing driver or volumeHandle as unsupported", () => {
    expect(resolvePvStorage(undefined, "whatever")).toEqual({ kind: "unsupported" });
    expect(resolvePvStorage("blockvolume.csi.oraclecloud.com", undefined)).toEqual({ kind: "unsupported" });
  });
});

describe("distinctFileSystemOcids", () => {
  it("returns distinct FileSystem OCIDs only, excluding non-file_system entries", () => {
    const fsOcid = "ocid1.filesystem.oc1.ap-tokyo-1.aaaaexample";
    const resolutions = [
      { kind: "file_system" as const, ocid: fsOcid },
      { kind: "file_system" as const, ocid: fsOcid },
      { kind: "block_volume" as const, ocid: "ocid1.volume.oc1.ap-tokyo-1.aaaa" },
      { kind: "unsupported" as const },
    ];
    expect(distinctFileSystemOcids(resolutions)).toEqual([fsOcid]);
  });

  it("returns an empty array when there are no FileSystem PVs", () => {
    expect(
      distinctFileSystemOcids([{ kind: "block_volume" as const, ocid: "x" }, { kind: "unsupported" as const }]),
    ).toEqual([]);
  });
});

describe("newFileSystemOcids", () => {
  it("returns only OCIDs not already started (dedup across page/refresh calls)", () => {
    const fsA = "ocid1.filesystem.oc1.ap-tokyo-1.aaaaexampleA";
    const fsB = "ocid1.filesystem.oc1.ap-tokyo-1.aaaaexampleB";
    expect(newFileSystemOcids([fsA, fsB], new Set([fsA]))).toEqual([fsB]);
  });

  it("returns an empty array when every OCID already started", () => {
    const fsA = "ocid1.filesystem.oc1.ap-tokyo-1.aaaaexampleA";
    expect(newFileSystemOcids([fsA], new Set([fsA]))).toEqual([]);
  });

  it("returns all OCIDs when nothing started yet", () => {
    const fsA = "ocid1.filesystem.oc1.ap-tokyo-1.aaaaexampleA";
    expect(newFileSystemOcids([fsA], new Set())).toEqual([fsA]);
  });
});
