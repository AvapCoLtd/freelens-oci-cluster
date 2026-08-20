import { describe, expect, it } from "vitest";
import type { OciResult } from "../oci/result";
import type { OciFssExport } from "../oci/types";
import {
  distinctFssRefOcids,
  fileSystemOcidOf,
  fileSystemOcidsOf,
  getCsiSource,
  isFssExportOcid,
  isOrphanedPvStorage,
  type PvStorageResults,
  resolvePvStorage,
  unstartedOcids,
} from "./pv-storage";

const FS_OCID = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaexample0001";
const EXPORT_OCID = "ocid1.export.oc1.ap_tokyo_1.aaaaexample0001";
const FAILED: OciResult<OciFssExport> = {
  ok: false,
  kind: "forbidden_or_not_found",
  raw: { message: "denied" },
};

function exported(fileSystemId: string): OciResult<OciFssExport> {
  return { ok: true, data: { "file-system-id": fileSystemId } };
}

describe("getCsiSource", () => {
  it("returns the csi field when present", () => {
    const csi = { driver: "fss.csi.oraclecloud.com", volumeHandle: `${FS_OCID}:10.0.0.5:/export` };
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
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${FS_OCID}:10.0.0.5:/export/path`)).toEqual({
      kind: "file_system",
      ocid: FS_OCID,
    });
  });

  it("resolves FSS CSI volumeHandle whose leading element is an Export OCID", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${EXPORT_OCID}:10.0.0.5:/export/path`)).toEqual({
      kind: "file_system",
      ocid: EXPORT_OCID,
    });
  });

  it("marks an FSS volumeHandle whose leading element is neither OCID form as unsupported", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", "ocid1.mounttarget.oc1.ap_tokyo_1.aaaa:10.0.0.5:/x")).toEqual({
      kind: "unsupported",
    });
    expect(resolvePvStorage("fss.csi.oraclecloud.com", "10.0.0.5:/export")).toEqual({ kind: "unsupported" });
  });

  it("marks unrecognized CSI drivers as unsupported", () => {
    expect(resolvePvStorage("csi.other.example.com", "whatever")).toEqual({ kind: "unsupported" });
  });

  it("marks missing driver or volumeHandle as unsupported", () => {
    expect(resolvePvStorage(undefined, "whatever")).toEqual({ kind: "unsupported" });
    expect(resolvePvStorage("blockvolume.csi.oraclecloud.com", undefined)).toEqual({ kind: "unsupported" });
  });

  it("marks a block volume handle with shell metacharacters as unsupported", () => {
    expect(resolvePvStorage("blockvolume.csi.oraclecloud.com", "ocid1.volume.oc1.ap-tokyo-1.$(id -un)")).toEqual({
      kind: "unsupported",
    });
  });

  it("marks an FSS export OCID with shell metacharacters as unsupported", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", "ocid1.export.oc1.ap-tokyo-1.a;id:10.0.0.5:/x")).toEqual({
      kind: "unsupported",
    });
  });
});

describe("isFssExportOcid", () => {
  it("distinguishes Export OCIDs from FileSystem OCIDs", () => {
    expect(isFssExportOcid(EXPORT_OCID)).toBe(true);
    expect(isFssExportOcid(FS_OCID)).toBe(false);
  });
});

describe("fileSystemOcidOf", () => {
  it("returns a FileSystem OCID unchanged without consulting exports", () => {
    expect(fileSystemOcidOf(FS_OCID, {})).toBe(FS_OCID);
  });

  it("resolves an Export OCID through the export response file-system-id", () => {
    expect(fileSystemOcidOf(EXPORT_OCID, { [EXPORT_OCID]: exported(FS_OCID) })).toBe(FS_OCID);
  });

  it("returns undefined while the export is not fetched yet", () => {
    expect(fileSystemOcidOf(EXPORT_OCID, {})).toBeUndefined();
  });

  it("returns undefined when the export fetch failed", () => {
    expect(fileSystemOcidOf(EXPORT_OCID, { [EXPORT_OCID]: FAILED })).toBeUndefined();
  });
});

describe("distinctFssRefOcids", () => {
  it("returns distinct FSS-referenced OCIDs only, excluding non-file_system entries", () => {
    const resolutions = [
      { kind: "file_system" as const, ocid: FS_OCID },
      { kind: "file_system" as const, ocid: FS_OCID },
      { kind: "file_system" as const, ocid: EXPORT_OCID },
      { kind: "block_volume" as const, ocid: "ocid1.volume.oc1.ap-tokyo-1.aaaa" },
      { kind: "unsupported" as const },
    ];
    expect(distinctFssRefOcids(resolutions)).toEqual([FS_OCID, EXPORT_OCID]);
  });

  it("returns an empty array when there are no FileSystem PVs", () => {
    expect(
      distinctFssRefOcids([{ kind: "block_volume" as const, ocid: "x" }, { kind: "unsupported" as const }]),
    ).toEqual([]);
  });
});

describe("fileSystemOcidsOf", () => {
  it("dedups a FileSystem OCID reached both directly and through an export", () => {
    expect(fileSystemOcidsOf([FS_OCID, EXPORT_OCID], { [EXPORT_OCID]: exported(FS_OCID) })).toEqual([FS_OCID]);
  });

  it("drops unresolved exports and keeps the rest", () => {
    expect(fileSystemOcidsOf([FS_OCID, EXPORT_OCID], { [EXPORT_OCID]: FAILED })).toEqual([FS_OCID]);
  });
});

describe("isOrphanedPvStorage", () => {
  const VOLUME_OCID = "ocid1.volume.oc1.ap-tokyo-1.aaaaexample0001";
  const NOT_FOUND: OciResult<never> = { ok: false, kind: "resource_not_found", raw: { message: "gone" } };

  function results(overrides: Partial<PvStorageResults> = {}): PvStorageResults {
    return { volumeBackupPolicies: {}, fssExports: {}, fileSystems: {}, ...overrides };
  }

  it("flags a block volume PV whose volume was confirmed absent", () => {
    const resolution = { kind: "block_volume" as const, ocid: VOLUME_OCID };
    const orphaned = results({ volumeBackupPolicies: { [VOLUME_OCID]: NOT_FOUND } });
    expect(isOrphanedPvStorage(resolution, orphaned)).toBe("volume");
  });

  it("does not flag a block volume PV whose backup policy lookup merely failed", () => {
    const resolution = { kind: "block_volume" as const, ocid: VOLUME_OCID };
    expect(isOrphanedPvStorage(resolution, results({ volumeBackupPolicies: { [VOLUME_OCID]: FAILED } }))).toBe(false);
  });

  it("does not flag a block volume PV while the lookup is still pending", () => {
    expect(isOrphanedPvStorage({ kind: "block_volume", ocid: VOLUME_OCID }, results())).toBe(false);
  });

  it('reports an absent export as "export" (the file system itself may still exist)', () => {
    const resolution = { kind: "file_system" as const, ocid: EXPORT_OCID };
    expect(isOrphanedPvStorage(resolution, results({ fssExports: { [EXPORT_OCID]: NOT_FOUND } }))).toBe("export");
  });

  it("flags an FSS PV whose file system was confirmed absent behind a resolved export", () => {
    const resolution = { kind: "file_system" as const, ocid: EXPORT_OCID };
    const orphaned = results({
      fssExports: { [EXPORT_OCID]: exported(FS_OCID) },
      fileSystems: { [FS_OCID]: NOT_FOUND },
    });
    expect(isOrphanedPvStorage(resolution, orphaned)).toBe("filesystem");
  });

  it("flags an FSS PV referencing a FileSystem OCID directly", () => {
    const resolution = { kind: "file_system" as const, ocid: FS_OCID };
    expect(isOrphanedPvStorage(resolution, results({ fileSystems: { [FS_OCID]: NOT_FOUND } }))).toBe("filesystem");
  });

  it("never flags unsupported PVs", () => {
    expect(isOrphanedPvStorage({ kind: "unsupported" }, results())).toBe(false);
  });
});

describe("unstartedOcids", () => {
  it("returns only OCIDs not already started (dedup across page/refresh calls)", () => {
    const fsA = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaexampleA";
    const fsB = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaexampleB";
    expect(unstartedOcids([fsA, fsB], new Set([fsA]))).toEqual([fsB]);
  });

  it("returns an empty array when every OCID already started", () => {
    const fsA = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaexampleA";
    expect(unstartedOcids([fsA], new Set([fsA]))).toEqual([]);
  });

  it("returns all OCIDs when nothing started yet", () => {
    const fsA = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaexampleA";
    expect(unstartedOcids([fsA], new Set())).toEqual([fsA]);
  });
});
