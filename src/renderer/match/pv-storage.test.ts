import { describe, expect, it } from "vitest";
import type { OciResult } from "../oci/result";
import type {
  OciFssExport,
  OciFssExportSummary,
  OciFssMountIndex,
  OciMountTarget,
  OciResourceSummary,
} from "../oci/types";
import {
  existenceProbeOcids,
  type FssResolveResults,
  fallbackFssExportOcids,
  fileSystemOcidOf,
  fssFileSystemIdsOf,
  fssFileSystemRefOf,
  fssMountIndexOf,
  getCsiSource,
  isFssExportOcid,
  isOrphanedPvStorage,
  mountTargetPrivateIpIds,
  needsFssMountEntries,
  type PvStorageResolution,
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

  it("splits an FSS volumeHandle into the leading FileSystem OCID and the mount target IP / export path", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${FS_OCID}:10.0.0.5:/export/path`)).toEqual({
      kind: "file_system",
      ocid: FS_OCID,
      mount: { ip: "10.0.0.5", path: "/export/path" },
    });
  });

  it("splits an FSS volumeHandle whose leading element is an Export OCID", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${EXPORT_OCID}:10.0.0.5:/export/path`)).toEqual({
      kind: "file_system",
      ocid: EXPORT_OCID,
      mount: { ip: "10.0.0.5", path: "/export/path" },
    });
  });

  it("drops a trailing slash of the export path and keeps colons inside the path", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${FS_OCID}:10.0.0.5:/data/`)?.mount).toEqual({
      ip: "10.0.0.5",
      path: "/data",
    });
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${FS_OCID}:10.0.0.5:/a:b`)?.mount).toEqual({
      ip: "10.0.0.5",
      path: "/a:b",
    });
  });

  it("keeps the FSS PV but omits the mount part when the handle is not in OCID:IP:path form", () => {
    expect(resolvePvStorage("fss.csi.oraclecloud.com", FS_OCID)).toEqual({ kind: "file_system", ocid: FS_OCID });
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${FS_OCID}:mt.example.com:/x`)).toEqual({
      kind: "file_system",
      ocid: FS_OCID,
    });
    expect(resolvePvStorage("fss.csi.oraclecloud.com", `${FS_OCID}:10.0.0.5:relative`)).toEqual({
      kind: "file_system",
      ocid: FS_OCID,
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

// 実機の構成を写したケース: 10.20.5.51のmount targetのexport setに/Tavinosと/wpが並び、
// Tavinos系PVのvolumeHandleは先頭が/wp側のFileSystem OCIDでpathが/Tavinos。
const MT_IP = "10.20.5.51";
const MT_ID = "ocid1.mounttarget.oc1.ap_tokyo_1.aaaaexamplemt01";
const PRIVATE_IP_ID = "ocid1.privateip.oc1.ap-tokyo-1.aaaaexampleip01";
const EXPORT_SET_ID = "ocid1.exportset.oc1.ap_tokyo_1.aaaaexamplees01";
const FS_TAVINOS = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaaaaaaalzfayc";
const FS_WP = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaaaaaaaj5syaw2mia";
const EXPORT_TAVINOS = "ocid1.export.oc1.ap_tokyo_1.aaaaexampletavinos";
const EXPORT_WP = "ocid1.export.oc1.ap_tokyo_1.aaaaexamplewp";

const MOUNT_TARGET: OciMountTarget = {
  id: MT_ID,
  "export-set-id": EXPORT_SET_ID,
  "private-ip-ids": [PRIVATE_IP_ID],
  "lifecycle-state": "ACTIVE",
};

function exportSummary(id: string, path: string, fileSystemId: string, state = "ACTIVE"): OciFssExportSummary {
  return { id, path, "file-system-id": fileSystemId, "export-set-id": EXPORT_SET_ID, "lifecycle-state": state };
}

const MOUNT_ENTRIES: OciResult<OciFssMountIndex> = {
  ok: true,
  data: {
    entries: [
      { ipAddress: MT_IP, path: "/Tavinos", exportId: EXPORT_TAVINOS, fileSystemId: FS_TAVINOS },
      { ipAddress: MT_IP, path: "/wp", exportId: EXPORT_WP, fileSystemId: FS_WP },
    ],
    mountTargetIps: [MT_IP],
  },
};

const NO_MOUNT_TARGETS: OciResult<OciFssMountIndex> = { ok: true, data: { entries: [], mountTargetIps: [] } };

function fss(handle: string): PvStorageResolution {
  return resolvePvStorage("fss.csi.oraclecloud.com", handle);
}

function resolveResults(overrides: Partial<FssResolveResults> = {}): FssResolveResults {
  return { fssMountEntries: MOUNT_ENTRIES, fssExports: {}, ...overrides };
}

describe("fssMountIndexOf", () => {
  it("joins mount target IPs to exports through the export set", () => {
    const index = fssMountIndexOf([MOUNT_TARGET], new Map([[PRIVATE_IP_ID, MT_IP]]), [
      exportSummary(EXPORT_TAVINOS, "/Tavinos", FS_TAVINOS),
      exportSummary(EXPORT_WP, "/wp/", FS_WP),
    ]);
    expect(index).toEqual(MOUNT_ENTRIES.ok ? MOUNT_ENTRIES.data : undefined);
  });

  it("skips deleted exports and mount targets, exports of other export sets, and unresolved IPs", () => {
    const otherSet = { ...exportSummary(EXPORT_WP, "/wp", FS_WP), "export-set-id": "ocid1.exportset.oc1..other" };
    expect(
      fssMountIndexOf([MOUNT_TARGET], new Map([[PRIVATE_IP_ID, MT_IP]]), [
        exportSummary(EXPORT_TAVINOS, "/Tavinos", FS_TAVINOS, "DELETED"),
        otherSet,
      ]).entries,
    ).toEqual([]);
    expect(
      fssMountIndexOf([{ ...MOUNT_TARGET, "lifecycle-state": "DELETING" }], new Map([[PRIVATE_IP_ID, MT_IP]]), [
        exportSummary(EXPORT_TAVINOS, "/Tavinos", FS_TAVINOS),
      ]),
    ).toEqual({ entries: [], mountTargetIps: [] });
    expect(fssMountIndexOf([MOUNT_TARGET], new Map(), [exportSummary(EXPORT_TAVINOS, "/Tavinos", FS_TAVINOS)])).toEqual(
      { entries: [], mountTargetIps: [] },
    );
  });

  it("keeps the IP of a live mount target that has no export left", () => {
    expect(fssMountIndexOf([MOUNT_TARGET], new Map([[PRIVATE_IP_ID, MT_IP]]), [])).toEqual({
      entries: [],
      mountTargetIps: [MT_IP],
    });
  });
});

describe("mountTargetPrivateIpIds", () => {
  it("returns private IPs of every live mount target, with or without exports", () => {
    const idle: OciMountTarget = {
      id: "ocid1.mounttarget.oc1..idle",
      "export-set-id": "ocid1.exportset.oc1..idle",
      "private-ip-ids": ["ocid1.privateip.oc1..idle", PRIVATE_IP_ID],
    };
    expect(mountTargetPrivateIpIds([MOUNT_TARGET, idle])).toEqual([PRIVATE_IP_ID, "ocid1.privateip.oc1..idle"]);
    expect(mountTargetPrivateIpIds([{ ...MOUNT_TARGET, "lifecycle-state": "DELETED" }])).toEqual([]);
  });
});

describe("fssFileSystemRefOf", () => {
  it("resolves by IP:path and notes the handle OCID when it points to another file system (Tavinos case)", () => {
    expect(fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/Tavinos`), resolveResults())).toEqual({
      fileSystemId: FS_TAVINOS,
      inferred: false,
      conflictingHandleOcid: FS_WP,
    });
  });

  it("resolves a subdirectory of an export path to that export's file system", () => {
    expect(fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/wp/uploads`), resolveResults())).toEqual({
      fileSystemId: FS_WP,
      inferred: false,
    });
  });

  it("does not treat a sibling path sharing a prefix as a subdirectory", () => {
    expect(fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/wpx`), resolveResults())).toMatchObject({ inferred: true });
  });

  it("resolves by IP:path without a note when the handle FileSystem OCID agrees", () => {
    expect(fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/wp`), resolveResults())).toEqual({
      fileSystemId: FS_WP,
      inferred: false,
    });
  });

  it("compares an Export OCID handle with the matched export itself, without an export get", () => {
    expect(fssFileSystemRefOf(fss(`${EXPORT_TAVINOS}:${MT_IP}:/Tavinos`), resolveResults())).toEqual({
      fileSystemId: FS_TAVINOS,
      inferred: false,
    });
    expect(fssFileSystemRefOf(fss(`${EXPORT_WP}:${MT_IP}:/Tavinos`), resolveResults())).toEqual({
      fileSystemId: FS_TAVINOS,
      inferred: false,
      conflictingHandleOcid: EXPORT_WP,
    });
  });

  it("falls back to the handle OCID when no mount target has the IP", () => {
    expect(fssFileSystemRefOf(fss(`${FS_WP}:10.20.9.9:/Tavinos`), resolveResults())).toEqual({
      fileSystemId: FS_WP,
      inferred: true,
    });
  });

  it("falls back to the handle OCID when the mount target has no export at the path", () => {
    expect(fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/missing`), resolveResults())).toEqual({
      fileSystemId: FS_WP,
      inferred: true,
    });
  });

  it("falls back to the handle OCID when the handle is not in OCID:IP:path form", () => {
    expect(fssFileSystemRefOf(fss(FS_WP), resolveResults())).toEqual({ fileSystemId: FS_WP, inferred: true });
  });

  it("falls back through the export response when the handle is an Export OCID", () => {
    const results = resolveResults({ fssExports: { [EXPORT_OCID]: exported(FS_OCID) } });
    expect(fssFileSystemRefOf(fss(`${EXPORT_OCID}:10.0.0.5:/x`), results)).toEqual({
      fileSystemId: FS_OCID,
      inferred: true,
    });
  });

  it("falls back when the mount target / export lookup itself failed", () => {
    const results = resolveResults({ fssMountEntries: { ok: false, kind: "other", raw: { message: "x" } } });
    expect(fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/Tavinos`), results)).toEqual({
      fileSystemId: FS_WP,
      inferred: true,
    });
  });

  it("treats an IP:path that leads to two different file systems as unmatched", () => {
    const ambiguous: OciResult<OciFssMountIndex> = {
      ok: true,
      data: {
        entries: [
          { ipAddress: MT_IP, path: "/Tavinos", exportId: EXPORT_TAVINOS, fileSystemId: FS_TAVINOS },
          { ipAddress: MT_IP, path: "/Tavinos", exportId: EXPORT_WP, fileSystemId: FS_WP },
        ],
        mountTargetIps: [MT_IP],
      },
    };
    expect(
      fssFileSystemRefOf(fss(`${FS_WP}:${MT_IP}:/Tavinos`), resolveResults({ fssMountEntries: ambiguous })),
    ).toEqual({ fileSystemId: FS_WP, inferred: true });
  });
});

describe("needsFssMountEntries", () => {
  it("is true only when some FSS PV has an IP:path to match", () => {
    expect(needsFssMountEntries([fss(`${FS_WP}:${MT_IP}:/wp`)])).toBe(true);
    expect(needsFssMountEntries([fss(FS_WP), { kind: "block_volume", ocid: "ocid1.volume.oc1..a" }])).toBe(false);
  });
});

describe("fallbackFssExportOcids", () => {
  it("returns Export OCIDs only of PVs that IP:path could not resolve (distinct)", () => {
    const resolutions = [
      fss(`${EXPORT_WP}:${MT_IP}:/Tavinos`),
      fss(`${EXPORT_OCID}:10.0.0.5:/x`),
      fss(`${EXPORT_OCID}:10.0.0.5:/y`),
      fss(`${FS_OCID}:10.0.0.5:/x`),
    ];
    expect(fallbackFssExportOcids(resolutions, MOUNT_ENTRIES)).toEqual([EXPORT_OCID]);
  });
});

describe("fssFileSystemIdsOf", () => {
  it("collects matched and fallback FileSystem OCIDs, dropping unresolved exports", () => {
    const resolutions = [
      fss(`${FS_WP}:${MT_IP}:/Tavinos`),
      fss(`${FS_WP}:${MT_IP}:/wp`),
      fss(`${FS_OCID}:10.0.0.5:/x`),
      fss(`${EXPORT_OCID}:10.0.0.5:/x`),
      { kind: "block_volume" as const, ocid: "ocid1.volume.oc1..a" },
    ];
    expect(fssFileSystemIdsOf(resolutions, resolveResults({ fssExports: { [EXPORT_OCID]: FAILED } }))).toEqual([
      FS_TAVINOS,
      FS_WP,
      FS_OCID,
    ]);
  });
});

describe("isOrphanedPvStorage", () => {
  const VOLUME_OCID = "ocid1.volume.oc1.ap-tokyo-1.aaaaexample0001";
  const NOT_FOUND: OciResult<never> = { ok: false, kind: "resource_not_found", raw: { message: "gone" } };

  function hit(identifier: string, lifecycleState: string): OciResult<OciResourceSummary | null> {
    return { ok: true, data: { identifier, "resource-type": "Volume", "lifecycle-state": lifecycleState } };
  }

  const NO_HIT: OciResult<OciResourceSummary | null> = { ok: true, data: null };
  const SEARCH_FAILED: OciResult<never> = { ok: false, kind: "other", raw: { message: "search failed" } };

  function results(overrides: Partial<PvStorageResults> = {}): PvStorageResults {
    return {
      volumeBackupPolicies: {},
      fssExports: {},
      fssMountEntries: NO_MOUNT_TARGETS,
      fileSystems: {},
      resourceSearches: {},
      ...overrides,
    };
  }

  const blockVolume = { kind: "block_volume" as const, ocid: VOLUME_OCID };

  it("reports a volume that Search still finds as existing but not readable (forbidden)", () => {
    const observed = results({
      volumeBackupPolicies: { [VOLUME_OCID]: NOT_FOUND },
      resourceSearches: { [VOLUME_OCID]: hit(VOLUME_OCID, "AVAILABLE") },
    });
    expect(isOrphanedPvStorage(blockVolume, observed)).toEqual({ kind: "volume", certainty: "forbidden" });
  });

  it.each([
    "TERMINATED",
    "TERMINATING",
    "DELETED",
    "DELETING",
  ])("reports a volume that Search finds in %s as absent", (state) => {
    const observed = results({
      volumeBackupPolicies: { [VOLUME_OCID]: NOT_FOUND },
      resourceSearches: { [VOLUME_OCID]: hit(VOLUME_OCID, state) },
    });
    expect(isOrphanedPvStorage(blockVolume, observed)).toEqual({ kind: "volume", certainty: "absent" });
  });

  it("reports a volume that Search does not find as unknown (absent or forbidden)", () => {
    const observed = results({
      volumeBackupPolicies: { [VOLUME_OCID]: NOT_FOUND },
      resourceSearches: { [VOLUME_OCID]: NO_HIT },
    });
    expect(isOrphanedPvStorage(blockVolume, observed)).toEqual({ kind: "volume", certainty: "unknown" });
  });

  it("reports every probed reference as unknown when Search itself failed", () => {
    const observed = results({
      volumeBackupPolicies: { [VOLUME_OCID]: NOT_FOUND },
      fileSystems: { [FS_OCID]: NOT_FOUND },
      resourceSearches: { [VOLUME_OCID]: SEARCH_FAILED, [FS_OCID]: SEARCH_FAILED },
    });
    expect(isOrphanedPvStorage(blockVolume, observed)).toEqual({ kind: "volume", certainty: "unknown" });
    expect(isOrphanedPvStorage({ kind: "file_system", ocid: FS_OCID }, observed)).toEqual({
      kind: "filesystem",
      certainty: "unknown",
    });
  });

  it("reports unknown while the Search result has not arrived", () => {
    const observed = results({ volumeBackupPolicies: { [VOLUME_OCID]: NOT_FOUND } });
    expect(isOrphanedPvStorage(blockVolume, observed)).toEqual({ kind: "volume", certainty: "unknown" });
  });

  it("does not flag a block volume PV whose backup policy lookup merely failed", () => {
    expect(isOrphanedPvStorage(blockVolume, results({ volumeBackupPolicies: { [VOLUME_OCID]: FAILED } }))).toBe(false);
  });

  it("does not flag a block volume PV while the lookup is still pending", () => {
    expect(isOrphanedPvStorage(blockVolume, results())).toBe(false);
  });

  it('reports an export whose get failed as "export" (the file system itself may still exist)', () => {
    const resolution = { kind: "file_system" as const, ocid: EXPORT_OCID };
    const observed = results({
      fssExports: { [EXPORT_OCID]: NOT_FOUND },
      resourceSearches: { [EXPORT_OCID]: hit(EXPORT_OCID, "ACTIVE") },
    });
    expect(isOrphanedPvStorage(resolution, observed)).toEqual({ kind: "export", certainty: "forbidden" });
  });

  it("confirms an absent export when the mount target at the IP has no export at the path", () => {
    const resolution = fss(`${FS_WP}:${MT_IP}:/removed`);
    const observed = results({ fssMountEntries: MOUNT_ENTRIES, fileSystems: { [FS_WP]: { ok: true, data: {} } } });
    expect(isOrphanedPvStorage(resolution, observed)).toEqual({
      kind: "export",
      certainty: "absent",
      byMountPath: true,
    });
  });

  it("does not confirm an absent export when the PV mounts a subdirectory of an existing export", () => {
    const resolution = fss(`${FS_WP}:${MT_IP}:/wp/uploads`);
    const observed = results({ fssMountEntries: MOUNT_ENTRIES, fileSystems: { [FS_WP]: { ok: true, data: {} } } });
    expect(isOrphanedPvStorage(resolution, observed)).toBe(false);
  });

  it("confirms an absent export on a mount target that has no export left at all", () => {
    const onlyMountTarget: OciResult<OciFssMountIndex> = { ok: true, data: { entries: [], mountTargetIps: [MT_IP] } };
    const resolution = fss(`${FS_WP}:${MT_IP}:/Tavinos`);
    expect(isOrphanedPvStorage(resolution, results({ fssMountEntries: onlyMountTarget }))).toEqual({
      kind: "export",
      certainty: "absent",
      byMountPath: true,
    });
  });

  it("does not confirm an absent export when no mount target has the IP or the lookup failed", () => {
    const unknownIp = fss(`${FS_WP}:10.20.9.9:/Tavinos`);
    expect(isOrphanedPvStorage(unknownIp, results({ fssMountEntries: MOUNT_ENTRIES }))).toBe(false);
    const lookupFailed = results({ fssMountEntries: { ok: false, kind: "other", raw: { message: "x" } } });
    expect(isOrphanedPvStorage(fss(`${FS_WP}:${MT_IP}:/removed`), lookupFailed)).toBe(false);
  });

  it("flags an FSS PV whose file system get failed behind a resolved export", () => {
    const resolution = { kind: "file_system" as const, ocid: EXPORT_OCID };
    const observed = results({
      fssExports: { [EXPORT_OCID]: exported(FS_OCID) },
      fileSystems: { [FS_OCID]: NOT_FOUND },
      resourceSearches: { [FS_OCID]: NO_HIT },
    });
    expect(isOrphanedPvStorage(resolution, observed)).toEqual({ kind: "filesystem", certainty: "unknown" });
  });

  it("checks the file system matched by IP:path, not the one the handle OCID points to", () => {
    const resolution = fss(`${FS_WP}:${MT_IP}:/Tavinos`);
    expect(
      isOrphanedPvStorage(
        resolution,
        results({ fssMountEntries: MOUNT_ENTRIES, fileSystems: { [FS_TAVINOS]: NOT_FOUND } }),
      ),
    ).toEqual({ kind: "filesystem", certainty: "unknown" });
    expect(
      isOrphanedPvStorage(resolution, results({ fssMountEntries: MOUNT_ENTRIES, fileSystems: { [FS_WP]: NOT_FOUND } })),
    ).toBe(false);
  });

  it("never flags unsupported PVs", () => {
    expect(isOrphanedPvStorage({ kind: "unsupported" }, results())).toBe(false);
  });
});

describe("existenceProbeOcids", () => {
  const VOLUME_A = "ocid1.volume.oc1.ap-tokyo-1.aaaaexample0001";
  const VOLUME_B = "ocid1.volume.oc1.ap-tokyo-1.aaaaexample0002";
  const NOT_FOUND: OciResult<never> = { ok: false, kind: "resource_not_found", raw: { message: "gone" } };

  it("collects every reference whose own get failed, deduplicated, so they go into one Search", () => {
    const resolutions: PvStorageResolution[] = [
      { kind: "block_volume", ocid: VOLUME_A },
      { kind: "block_volume", ocid: VOLUME_A },
      { kind: "block_volume", ocid: VOLUME_B },
      { kind: "file_system", ocid: EXPORT_OCID },
      { kind: "file_system", ocid: FS_OCID },
    ];
    expect(
      existenceProbeOcids(resolutions, {
        volumeBackupPolicies: { [VOLUME_A]: NOT_FOUND, [VOLUME_B]: NOT_FOUND },
        fssExports: { [EXPORT_OCID]: NOT_FOUND },
        fssMountEntries: NO_MOUNT_TARGETS,
        fileSystems: { [FS_OCID]: NOT_FOUND },
      }),
    ).toEqual([VOLUME_A, VOLUME_B, EXPORT_OCID, FS_OCID]);
  });

  it("skips references that resolved, failed for another reason, or were already confirmed absent by IP:path", () => {
    const resolutions: PvStorageResolution[] = [
      { kind: "block_volume", ocid: VOLUME_A },
      { kind: "block_volume", ocid: VOLUME_B },
      fss(`${EXPORT_OCID}:${MT_IP}:/removed`),
    ];
    expect(
      existenceProbeOcids(resolutions, {
        volumeBackupPolicies: { [VOLUME_A]: { ok: true, data: {} }, [VOLUME_B]: FAILED },
        fssExports: { [EXPORT_OCID]: NOT_FOUND },
        fssMountEntries: MOUNT_ENTRIES,
        fileSystems: {},
      }),
    ).toEqual([]);
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
