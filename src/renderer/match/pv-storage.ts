import { isResourceNotFound, type OciResult } from "../oci/result";
import type {
  OciFssExport,
  OciFssExportSummary,
  OciFssMountEntry,
  OciFssMountIndex,
  OciMountTarget,
  OciResourceSummary,
} from "../oci/types";
import { pushToMap } from "./map-list";

export interface CsiSource {
  driver?: string;
  volumeHandle?: string;
}

// 拡張APIのPersistentVolumeSpec型にcsiが無いが、実データにはある。
export function getCsiSource(spec: object): CsiSource | undefined {
  return (spec as { csi?: CsiSource }).csi;
}

export type PvStorageKind = "block_volume" | "file_system" | "unsupported";

export interface FssMountPath {
  ip: string;
  path: string;
}

export interface PvStorageResolution {
  kind: PvStorageKind;
  /** Block VolumeのOCID、またはFSS volumeHandle先頭のOCID(FileSystem / Export) */
  ocid?: string;
  /** FSSのみ: volumeHandleの`<IP>:<path>`部。この形で読めないhandleでは持たない */
  mount?: FssMountPath;
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

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function normalizeExportPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** pathは`:`を含みうるため2要素目以降を連結する。 */
function parseFssMountPath(rest: readonly string[]): FssMountPath | undefined {
  const [ip, ...pathParts] = rest;
  const path = pathParts.join(":");
  if (!ip || !IPV4_PATTERN.test(ip) || !path.startsWith("/")) return undefined;
  return { ip, path: normalizeExportPath(path) };
}

/**
 * PV の CSI driver で Block Volume / FSS / 未対応 に分岐する。
 * FSSのvolumeHandleは`<OCID>:<IP>:<path>`形式で、先頭要素はFileSystem OCIDとExport OCIDの両方が実在する。
 * 先頭OCIDは実際にマウントしているFSSと食い違うことがある(IP:pathが別FSSのexportを指すPVが実在する)ため、
 * IP:pathも分解して持ち、照合は{@link fssFileSystemRefOf}で行う。
 */
export function resolvePvStorage(driver: string | undefined, volumeHandle: string | undefined): PvStorageResolution {
  if (!driver || !volumeHandle) return { kind: "unsupported" };
  if (driver === BLOCK_VOLUME_CSI_DRIVER) {
    return isOcid(volumeHandle) ? { kind: "block_volume", ocid: volumeHandle } : { kind: "unsupported" };
  }
  if (driver === FSS_CSI_DRIVER) {
    const [ocid, ...rest] = volumeHandle.split(":");
    if (!ocid) return { kind: "unsupported" };
    if (!isOcid(ocid) || (!ocid.startsWith(FILE_SYSTEM_OCID_PREFIX) && !isFssExportOcid(ocid))) {
      return { kind: "unsupported" };
    }
    const mount = parseFssMountPath(rest);
    return mount ? { kind: "file_system", ocid, mount } : { kind: "file_system", ocid };
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

const GONE_LIFECYCLE_STATES = new Set(["DELETING", "DELETED"]);

function isLive(resource: { "lifecycle-state"?: string }): boolean {
  return !GONE_LIFECYCLE_STATES.has(resource["lifecycle-state"] ?? "");
}

/**
 * 削除中・削除済みは照合対象から外す(同じpathで作り直したexportと並ぶと、どちらを指すか決まらなくなる)。
 * exportを1つも持たないmount targetもIPは載せる(exportだけ消えた構成でexport不在を確定させるため)。
 */
export function fssMountIndexOf(
  mountTargets: readonly OciMountTarget[],
  ipAddressById: ReadonlyMap<string, string>,
  exports: readonly OciFssExportSummary[],
): OciFssMountIndex {
  const exportsBySet = new Map<string, OciFssExportSummary[]>();
  for (const fssExport of exports) {
    const exportSetId = fssExport["export-set-id"];
    if (!exportSetId || !isLive(fssExport)) continue;
    pushToMap(exportsBySet, exportSetId, fssExport);
  }
  const entries: OciFssMountEntry[] = [];
  const mountTargetIps = new Set<string>();
  for (const mountTarget of mountTargets) {
    if (!isLive(mountTarget)) continue;
    const setExports = exportsBySet.get(mountTarget["export-set-id"] ?? "") ?? [];
    for (const privateIpId of mountTarget["private-ip-ids"] ?? []) {
      const ipAddress = ipAddressById.get(privateIpId);
      if (!ipAddress) continue;
      mountTargetIps.add(ipAddress);
      for (const fssExport of setExports) {
        const fileSystemId = fssExport["file-system-id"];
        if (!fileSystemId || !fssExport.path) continue;
        entries.push({ ipAddress, path: normalizeExportPath(fssExport.path), exportId: fssExport.id, fileSystemId });
      }
    }
  }
  return { entries, mountTargetIps: [...mountTargetIps] };
}

/** exportを持たないmount targetのIPも引く。PVのIPがそこを指すとき、exportだけが消えたと確定させるため。 */
export function mountTargetPrivateIpIds(mountTargets: readonly OciMountTarget[]): string[] {
  const ids = mountTargets.filter(isLive).flatMap((mountTarget) => mountTarget["private-ip-ids"] ?? []);
  return [...new Set(ids)];
}

// FSSはexport配下のサブディレクトリもマウントできるため、完全一致だけで照合すると実在するexportを不在と誤判定する。
function entryCoversMount(entry: OciFssMountEntry, mount: FssMountPath): boolean {
  if (entry.ipAddress !== mount.ip) return false;
  return entry.path === mount.path || entry.path === "/" || mount.path.startsWith(`${entry.path}/`);
}

/** 同じIPのmount targetが別VCNに並ぶ構成では複数件になりうるため、FileSystemが1つに決まらなければ照合できなかった扱いにする。 */
function matchFssMount(
  index: OciResult<OciFssMountIndex> | undefined,
  mount: FssMountPath | undefined,
): OciFssMountEntry[] {
  if (!mount || !index?.ok) return [];
  const matches = index.data.entries.filter((entry) => entryCoversMount(entry, mount));
  return new Set(matches.map((entry) => entry.fileSystemId)).size === 1 ? matches : [];
}

function isFssExportAbsent(index: OciResult<OciFssMountIndex>, mount: FssMountPath | undefined): boolean {
  if (!mount || !index.ok || !index.data.mountTargetIps.includes(mount.ip)) return false;
  return !index.data.entries.some((entry) => entryCoversMount(entry, mount));
}

export interface FssFileSystemRef {
  fileSystemId?: string;
  /** IP:pathで照合できず、volumeHandle先頭のOCIDから推定した */
  inferred: boolean;
  /** IP:pathで照合できた先と、volumeHandle先頭のOCIDが指す先が食い違うときの先頭OCID */
  conflictingHandleOcid?: string;
}

export interface FssResolveResults {
  fssMountEntries: OciResult<OciFssMountIndex>;
  fssExports: Record<string, OciResult<OciFssExport>>;
}

export function fssFileSystemRefOf(resolution: PvStorageResolution, results: FssResolveResults): FssFileSystemRef {
  const handleOcid = resolution.ocid;
  const matches = matchFssMount(results.fssMountEntries, resolution.mount);
  const matched = matches[0];
  if (!matched) {
    return { fileSystemId: handleOcid ? fileSystemOcidOf(handleOcid, results.fssExports) : undefined, inferred: true };
  }
  const consistent =
    !handleOcid ||
    (isFssExportOcid(handleOcid)
      ? matches.some((entry) => entry.exportId === handleOcid)
      : handleOcid === matched.fileSystemId);
  return consistent
    ? { fileSystemId: matched.fileSystemId, inferred: false }
    : { fileSystemId: matched.fileSystemId, inferred: false, conflictingHandleOcid: handleOcid };
}

export interface PvStorageGetResults extends FssResolveResults {
  volumeBackupPolicies: Record<string, OciResult<unknown>>;
  fileSystems: Record<string, OciResult<unknown>>;
}

/** 孤立判定が読むper-OCID Record群(ClusterOciDataの部分形)。 */
export interface PvStorageResults extends PvStorageGetResults {
  /** 自身のgetが404だったOCID→Resource Searchのヒット(nullはヒットなし) */
  resourceSearches: Record<string, OciResult<OciResourceSummary | null>>;
}

/** 実体を確認できなかった参照先の種別。exportはFSSのexportだけが消えFileSystemは残る運用と対応する。 */
export type PvStorageOrphanKind = "volume" | "filesystem" | "export";

/**
 * 実体を確認できなかった理由の確からしさ。OCIは不在と権限不足に同じ404を返すため、getだけでは決まらない。
 * - absent: 不在と確定(Searchのヒットが終了状態、またはIP:pathのmount targetにexportが無い)
 * - forbidden: 存在するがgetの権限が無いと確定(Searchでヒットした)
 * - unknown: 不在か権限不足か決まらない(Searchでヒットしない、またはSearch自体が失敗した)
 */
export type PvStorageOrphanCertainty = "absent" | "forbidden" | "unknown";

export interface PvStorageOrphan {
  kind: PvStorageOrphanKind;
  certainty: PvStorageOrphanCertainty;
  /** IP:pathのmount targetにexportが無いことで確定した(volumeHandle先頭OCIDからの推定ではない) */
  byMountPath?: true;
}

// Searchは削除後もしばらく終了状態のリソースを返しうる。削除中も実体はまもなく消えるため不在へ寄せる。
const TERMINAL_LIFECYCLE_STATES = new Set(["TERMINATING", "TERMINATED", "DELETING", "DELETED"]);

/** 実体を確認できなかった参照先と、Searchで存在を確かめるOCID(export不在の確定ではSearchが要らない)。 */
interface UnreachableRef {
  kind: PvStorageOrphanKind;
  probeOcid?: string;
  byMountPath?: true;
}

function unreachableRefOf(resolution: PvStorageResolution, results: PvStorageGetResults): UnreachableRef | undefined {
  const ocid = resolution.ocid;
  if (!ocid) return undefined;
  if (resolution.kind === "block_volume") {
    return isResourceNotFound(results.volumeBackupPolicies[ocid]) ? { kind: "volume", probeOcid: ocid } : undefined;
  }
  if (resolution.kind !== "file_system") return undefined;
  // NFSマウントの対象はIP:pathで決まるため、そのexportが無ければFileSystemが残っていてもマウントできない。
  if (isFssExportAbsent(results.fssMountEntries, resolution.mount)) return { kind: "export", byMountPath: true };
  const ref = fssFileSystemRefOf(resolution, results);
  // IP:pathで照合できたPVはexport getを叩かないため、export getの404はフォールバック時だけの観測になる。
  if (ref.inferred && isResourceNotFound(results.fssExports[ocid])) return { kind: "export", probeOcid: ocid };
  const fileSystemId = ref.fileSystemId;
  if (fileSystemId && isResourceNotFound(results.fileSystems[fileSystemId])) {
    return { kind: "filesystem", probeOcid: fileSystemId };
  }
  return undefined;
}

function certaintyOf(search: OciResult<OciResourceSummary | null> | undefined): PvStorageOrphanCertainty {
  if (!search?.ok || !search.data) return "unknown";
  return TERMINAL_LIFECYCLE_STATES.has(search.data["lifecycle-state"] ?? "") ? "absent" : "forbidden";
}

/** PVの参照先(Block Volume / FSS)の実体を確認できなかったか。確認できた場合はfalse。 */
export function isOrphanedPvStorage(
  resolution: PvStorageResolution,
  results: PvStorageResults,
): false | PvStorageOrphan {
  const ref = unreachableRefOf(resolution, results);
  if (!ref) return false;
  const certainty = ref.probeOcid ? certaintyOf(results.resourceSearches[ref.probeOcid]) : "absent";
  return ref.byMountPath ? { kind: ref.kind, certainty, byMountPath: true } : { kind: ref.kind, certainty };
}

export function existenceProbeOcids(
  resolutions: readonly PvStorageResolution[],
  results: PvStorageGetResults,
): string[] {
  const ocids = resolutions
    .map((resolution) => unreachableRefOf(resolution, results)?.probeOcid)
    .filter((ocid): ocid is string => !!ocid);
  return [...new Set(ocids)];
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

export function needsFssMountEntries(resolutions: readonly PvStorageResolution[]): boolean {
  return resolutions.some((resolution) => resolution.kind === "file_system" && !!resolution.mount);
}

export function fallbackFssExportOcids(
  resolutions: readonly PvStorageResolution[],
  mountEntries: OciResult<OciFssMountIndex>,
): string[] {
  const ocids = resolutions
    .filter((resolution) => resolution.kind === "file_system" && !!resolution.ocid)
    .filter((resolution) => matchFssMount(mountEntries, resolution.mount).length === 0)
    .map((resolution) => resolution.ocid as string)
    .filter(isFssExportOcid);
  return [...new Set(ocids)];
}

export function fssFileSystemIdsOf(resolutions: readonly PvStorageResolution[], results: FssResolveResults): string[] {
  const ids = resolutions
    .filter((resolution) => resolution.kind === "file_system")
    .map((resolution) => fssFileSystemRefOf(resolution, results).fileSystemId)
    .filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** distinctなOCIDのうち、まだ取得を開始していないものだけを返す(再照会時の重複実行防止)。 */
export function unstartedOcids(distinctOcids: readonly string[], started: ReadonlySet<string>): string[] {
  return distinctOcids.filter((ocid) => !started.has(ocid));
}
