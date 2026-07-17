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

/**
 * PV の CSI driver で Block Volume / FSS / 未対応 に分岐する。
 * FSSのvolumeHandleは`<fs OCID>:<IP>:<path>`形式なので先頭要素がFileSystem OCID。
 */
export function resolvePvStorage(driver: string | undefined, volumeHandle: string | undefined): PvStorageResolution {
  if (!driver || !volumeHandle) return { kind: "unsupported" };
  if (driver === BLOCK_VOLUME_CSI_DRIVER) return { kind: "block_volume", ocid: volumeHandle };
  if (driver === FSS_CSI_DRIVER) {
    const fsOcid = volumeHandle.split(":")[0];
    return fsOcid ? { kind: "file_system", ocid: fsOcid } : { kind: "unsupported" };
  }
  return { kind: "unsupported" };
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

/** 同一FileSystemを参照する複数PVがあっても`oci fs file-system get`をdistinct数だけ呼ぶための集合導出。 */
export function distinctFileSystemOcids(resolutions: PvStorageResolution[]): string[] {
  return distinctOcidsOfKind(resolutions, "file_system");
}

/** distinctなFileSystem OCIDのうち、まだ取得を開始していないものだけを返す(再照会時の重複実行防止)。 */
export function newFileSystemOcids(distinctOcids: readonly string[], started: ReadonlySet<string>): string[] {
  return distinctOcids.filter((ocid) => !started.has(ocid));
}
