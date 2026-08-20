import { isResourceNotFound, type OciResult } from "../oci/result";
import type { OciFssExport } from "../oci/types";

export interface CsiSource {
  driver?: string;
  volumeHandle?: string;
}

// PersistentVolumeSpec型にcsiフィールドが定義されていない(@freelensapp/kube-object 1.10.3時点の型欠落)。
// 実データには存在するため、csiを省略可能とする構造的な型で読む(パッケージへの直接依存を増やさないため)。
export function getCsiSource(spec: { csi?: CsiSource }): CsiSource | undefined {
  return spec.csi;
}

export type PvStorageKind = "block_volume" | "file_system" | "unsupported";

export interface PvStorageResolution {
  kind: PvStorageKind;
  ocid?: string;
}

const BLOCK_VOLUME_CSI_DRIVER = "blockvolume.csi.oraclecloud.com";
const FSS_CSI_DRIVER = "fss.csi.oraclecloud.com";
const FILE_SYSTEM_OCID_PREFIX = "ocid1.filesystem.";
const FSS_EXPORT_OCID_PREFIX = "ocid1.export.";

/** FSSのOCIDがExport OCIDか。Export OCIDを`fs file-system get`へ渡すと400になる。 */
export function isFssExportOcid(ocid: string): boolean {
  return ocid.startsWith(FSS_EXPORT_OCID_PREFIX);
}

// CLI引数へ渡す値。前置一致だけだと末尾に$(...)を仕込める(シェル経由のoci互換コマンドで展開される)。
const OCID_PATTERN = /^ocid1\.[a-z0-9]+\.[a-z0-9]+\.[a-z0-9_-]*\.[a-z0-9]+$/;

function isOcid(value: string): boolean {
  return OCID_PATTERN.test(value);
}

/**
 * PV の CSI driver で Block Volume / FSS / 未対応 に分岐する。
 * FSSのvolumeHandleは`<OCID>:<IP>:<path>`形式で、先頭要素はFileSystem OCIDとExport OCIDの両方が実在する。
 */
export function resolvePvStorage(driver: string | undefined, volumeHandle: string | undefined): PvStorageResolution {
  if (!driver || !volumeHandle) return { kind: "unsupported" };
  if (driver === BLOCK_VOLUME_CSI_DRIVER) {
    return isOcid(volumeHandle) ? { kind: "block_volume", ocid: volumeHandle } : { kind: "unsupported" };
  }
  if (driver === FSS_CSI_DRIVER) {
    const ocid = volumeHandle.split(":")[0];
    if (!ocid) return { kind: "unsupported" };
    if (!isOcid(ocid) || (!ocid.startsWith(FILE_SYSTEM_OCID_PREFIX) && !isFssExportOcid(ocid))) {
      return { kind: "unsupported" };
    }
    return { kind: "file_system", ocid };
  }
  return { kind: "unsupported" };
}

/**
 * FSS PVが参照するOCIDからFileSystem OCIDを得る。Export OCIDはexport応答の`file-system-id`で解決し、
 * 未取得・取得失敗はundefined(FileSystem解決失敗)になる。
 */
export function fileSystemOcidOf(ocid: string, exports: Record<string, OciResult<OciFssExport>>): string | undefined {
  if (!isFssExportOcid(ocid)) return ocid;
  const result = exports[ocid];
  return result?.ok ? result.data["file-system-id"] : undefined;
}

/** 孤立判定が読むper-OCID Record群(ClusterOciDataの部分形)。 */
export interface PvStorageResults {
  volumeBackupPolicies: Record<string, OciResult<unknown>>;
  fssExports: Record<string, OciResult<OciFssExport>>;
  fileSystems: Record<string, OciResult<unknown>>;
}

/** 実体を確認できなかった参照先の種別。exportはFSSのexportだけが消えFileSystemは残る運用と対応する。 */
export type PvStorageOrphanKind = "volume" | "filesystem" | "export";

/**
 * PVの参照先(Block Volume / FSS)の実体を確認できなかったか。確認できた場合はfalse。
 * Block Volumeはバックアップポリシー割当照会の追撃`bv volume get`、FSSはexport / FileSystem自身の
 * getの結果を読む(実体なしの確定は取得層が resource_not_found として付ける)。
 */
export function isOrphanedPvStorage(
  resolution: PvStorageResolution,
  results: PvStorageResults,
): false | PvStorageOrphanKind {
  const ocid = resolution.ocid;
  if (!ocid) return false;
  if (resolution.kind === "block_volume") {
    return isResourceNotFound(results.volumeBackupPolicies[ocid]) ? "volume" : false;
  }
  if (resolution.kind !== "file_system") return false;
  if (isResourceNotFound(results.fssExports[ocid])) return "export";
  const fileSystemId = fileSystemOcidOf(ocid, results.fssExports);
  return fileSystemId && isResourceNotFound(results.fileSystems[fileSystemId]) ? "filesystem" : false;
}

/** 指定kindのPVが参照するOCID集合(distinct)。同一OCID参照PVが複数あっても取得はdistinct数だけ行うための導出。 */
function distinctOcidsOfKind(resolutions: PvStorageResolution[], kind: PvStorageKind): string[] {
  const ocids = resolutions
    .filter((r): r is PvStorageResolution & { ocid: string } => r.kind === kind && !!r.ocid)
    .map((r) => r.ocid);
  return [...new Set(ocids)];
}

/** PVが参照するBlock VolumeのOCID集合(バックアップポリシー割当の取得対象)。 */
export function distinctBlockVolumeOcids(resolutions: PvStorageResolution[]): string[] {
  return distinctOcidsOfKind(resolutions, "block_volume");
}

/** FSS PVが参照するOCID集合。FileSystem OCIDとExport OCIDが混在する。 */
export function distinctFssRefOcids(resolutions: PvStorageResolution[]): string[] {
  return distinctOcidsOfKind(resolutions, "file_system");
}

/** 参照OCID集合を解決して得たFileSystem OCID集合(distinct、未解決分は落とす)。 */
export function fileSystemOcidsOf(
  refOcids: readonly string[],
  exports: Record<string, OciResult<OciFssExport>>,
): string[] {
  const ocids = refOcids.map((ref) => fileSystemOcidOf(ref, exports)).filter((ocid): ocid is string => !!ocid);
  return [...new Set(ocids)];
}

/** distinctなOCIDのうち、まだ取得を開始していないものだけを返す(再照会時の重複実行防止)。 */
export function unstartedOcids(distinctOcids: readonly string[], started: ReadonlySet<string>): string[] {
  return distinctOcids.filter((ocid) => !started.has(ocid));
}
