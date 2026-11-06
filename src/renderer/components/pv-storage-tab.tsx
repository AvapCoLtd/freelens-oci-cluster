import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type * as React from "react";
import type { ClusterOciData } from "../fetch/fetch";
import { type ClusterTagMismatch, clusterTagMismatchesOf, clusterTagMismatchText } from "../match/cluster-tag";
import type { OciConsoleResourceType } from "../match/console-url";
import { filterRows } from "../match/filter-rows";
import {
  distinctBlockVolumeOcids,
  existenceProbeOcids,
  type FssFileSystemRef,
  fallbackFssExportOcids,
  fssFileSystemIdsOf,
  fssFileSystemRefOf,
  getCsiSource,
  isFssExportOcid,
  isOrphanedPvStorage,
  needsFssMountEntries,
  type PvStorageOrphan,
  type PvStorageResolution,
  resolvePvStorage,
} from "../match/pv-storage";
import { entriesReady, sectionsReady } from "../match/section-ready";
import { sortRows } from "../match/sort-rows";
import { ClusterTagNotes } from "./cluster-tag-notes";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { OcidCopyButton } from "./ocid-copy-button";
import { SearchBar } from "./search-bar";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LoadingBlock } from "./spinner";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE, UNMATCHED_ROW_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";
import type { SearchState } from "./use-search-query";

interface StorageResolution {
  displayName: string;
  lifecycleState?: string;
  sizeGb?: number;
  ocid?: string;
  consoleType?: OciConsoleResourceType;
  kindLabel: string;
  backupLabel: string;
  backupPolicyId?: string;
  backupConsoleType?: OciConsoleResourceType;
  orphaned?: true;
  /** FSSのみ: mount target IP / export pathで照合できず、volumeHandle先頭のOCIDから推定した */
  inferred?: true;
  /** FSSのみ: 照合できたFSSとvolumeHandle先頭のOCIDが食い違うときの注記 */
  handleNote?: string;
  /** 参照先の実体が現クラスタとは別のクラスタを指すタグを持つ(FSSはIP:pathで照合した実体のタグ) */
  tagMismatches: ClusterTagMismatch[];
}

const STORAGE_ORPHAN_MESSAGE: Record<PvStorageOrphan["certainty"], string> = {
  absent: "Not found in OCI (orphaned PV)",
  forbidden: "Exists in OCI but not readable (insufficient permission)",
  unknown: "Not found in OCI or not readable (unconfirmed)",
};

const ORPHAN_MESSAGE: Record<PvStorageOrphan["kind"], Record<PvStorageOrphan["certainty"], string>> = {
  volume: STORAGE_ORPHAN_MESSAGE,
  filesystem: STORAGE_ORPHAN_MESSAGE,
  export: {
    absent: "Export not found (file system may still exist)",
    forbidden: "Export exists but not readable (insufficient permission)",
    unknown: "Export not found or not readable (file system may still exist)",
  },
};

const INFERRED_LABEL = "inferred";
const INFERRED_TITLE =
  "Not matched by mount target IP and export path; inferred from the OCID at the head of volumeHandle";

const NOTE_STYLE: React.CSSProperties = {
  color: "var(--textColorSecondary, #9aa0a6)",
  fontSize: 12,
};

function fssMarksOf(ref: FssFileSystemRef): Pick<StorageResolution, "inferred" | "handleNote"> {
  if (ref.inferred) return { inferred: true };
  const handleOcid = ref.conflictingHandleOcid;
  if (!handleOcid) return {};
  const target = isFssExportOcid(handleOcid) ? "a different export" : "a different file system";
  return { handleNote: `volumeHandle OCID points to ${target} (${handleOcid})` };
}

// バックアップポリシー名の表示(未割当="None"は保護されていないボリュームの検出材料)。
function backupPolicyLabel(policy: ClusterOciData["volumeBackupPolicies"][string] | undefined): string {
  if (!policy?.ok) return "-";
  return policy.data.policyName ?? "None";
}

function resolveStorage(data: ClusterOciData, resolution: PvStorageResolution, clusterId: string): StorageResolution {
  const fssRef = resolution.kind === "file_system" ? fssFileSystemRefOf(resolution, data) : undefined;
  const fssMarks = fssRef ? fssMarksOf(fssRef) : {};
  const orphaned = isOrphanedPvStorage(resolution, data);
  if (orphaned) {
    return {
      displayName: ORPHAN_MESSAGE[orphaned.kind][orphaned.certainty],
      // IP:pathで照合できたPVの参照先は先頭OCIDではなく照合したFileSystemになる。
      ocid: fssRef && !fssRef.inferred ? fssRef.fileSystemId : resolution.ocid,
      kindLabel: resolution.kind === "block_volume" ? "Volume" : "FSS",
      backupLabel: "-",
      orphaned: true,
      tagMismatches: [],
      ...(orphaned.byMountPath ? {} : fssMarks),
    };
  }
  if (resolution.kind === "block_volume" && resolution.ocid) {
    const ocid = resolution.ocid;
    const backup = data.volumeBackupPolicies[ocid];
    const backupLabel = backupPolicyLabel(backup);
    const backupPolicyId = backup?.ok ? backup.data.policyId : undefined;
    if (!data.volumes.ok) {
      return {
        displayName: "-",
        kindLabel: "Volume",
        ocid,
        consoleType: "volume",
        backupLabel,
        backupPolicyId,
        backupConsoleType: "volume-backup-policy",
        tagMismatches: [],
      };
    }
    const volume = data.volumes.data.find((v) => v.id === ocid);
    return {
      displayName: volume?.["display-name"] ?? "-",
      lifecycleState: volume?.["lifecycle-state"],
      sizeGb: volume?.["size-in-gbs"],
      ocid,
      consoleType: "volume",
      kindLabel: "Volume",
      backupLabel,
      backupPolicyId,
      backupConsoleType: "volume-backup-policy",
      tagMismatches: clusterTagMismatchesOf(volume, clusterId),
    };
  }
  if (resolution.kind === "file_system" && fssRef) {
    const ocid = fssRef.fileSystemId;
    const fsResult = ocid ? data.fileSystems[ocid] : undefined;
    if (!fsResult?.ok) {
      return {
        displayName: "-",
        kindLabel: "FSS",
        ocid,
        consoleType: "filesystem",
        backupLabel: "-",
        tagMismatches: [],
        ...fssMarks,
      };
    }
    const policyId = fsResult.data["filesystem-snapshot-policy-id"];
    return {
      displayName: fsResult.data["display-name"] ?? "-",
      lifecycleState: fsResult.data["lifecycle-state"],
      ocid,
      consoleType: "filesystem",
      kindLabel: "FSS",
      backupLabel: policyId ? backupPolicyLabel(data.fssSnapshotPolicies[policyId]) : "None",
      backupPolicyId: policyId,
      backupConsoleType: "fss-snapshot-policy",
      tagMismatches: clusterTagMismatchesOf(fsResult.data, clusterId),
      ...fssMarks,
    };
  }
  return { displayName: "-", kindLabel: "Unsupported", backupLabel: "-", tagMismatches: [] };
}

type PvColumn = "pv" | "pvc" | "entity" | "kind" | "size" | "backup" | "lifecycle";

interface PvRow {
  key: string;
  pvName: string;
  pvcLabel: string;
  storage: StorageResolution;
}

const SORT_VALUE: Record<PvColumn, (row: PvRow) => string | number | undefined> = {
  pv: (row) => row.pvName,
  pvc: (row) => row.pvcLabel,
  entity: (row) => row.storage.displayName,
  kind: (row) => row.storage.kindLabel,
  size: (row) => row.storage.sizeGb,
  backup: (row) => row.storage.backupLabel,
  lifecycle: (row) => row.storage.lifecycleState,
};

function searchTextOf(row: PvRow): readonly (string | number | undefined)[] {
  return [
    row.pvName,
    row.pvcLabel,
    // orphaned行のentity列はORPHAN_MESSAGE(実体名ではない)ため、説明文で行が引けないよう外す。
    row.storage.orphaned ? undefined : row.storage.displayName,
    ...row.storage.tagMismatches.map(clusterTagMismatchText),
    row.storage.kindLabel,
    row.storage.sizeGb,
    row.storage.backupLabel,
    row.storage.lifecycleState,
  ];
}

/** 一覧の各セルが埋まる材料(OCI側)が揃ったか。PV行はK8s由来なので行数自体は先に確定している。 */
function storageCellsReady(data: ClusterOciData, resolutions: PvStorageResolution[]): boolean {
  if (!sectionsReady(data.volumes, data.taggedResources)) return false;
  // IP:pathの照合材料が来る前に出すと、全FSS行が一旦「推定」になってから差し替わる。
  if (needsFssMountEntries(resolutions) && !sectionsReady(data.fssMountEntries)) return false;
  if (!entriesReady(data.fssExports, fallbackFssExportOcids(resolutions, data.fssMountEntries))) return false;
  const fileSystemIds = fssFileSystemIdsOf(resolutions, data);
  if (!entriesReady(data.fileSystems, fileSystemIds)) return false;
  if (!entriesReady(data.volumeBackupPolicies, distinctBlockVolumeOcids(resolutions))) return false;
  // 存在確認が来る前に出すと、孤立PVの行が一旦「不明」になってから確定の文言へ差し替わる。
  if (!entriesReady(data.resourceSearches, existenceProbeOcids(resolutions, data))) return false;
  const policyIds = fileSystemIds
    .map((id) => {
      const fileSystem = data.fileSystems[id];
      return fileSystem?.ok ? fileSystem.data["filesystem-snapshot-policy-id"] : undefined;
    })
    .filter((id): id is string => !!id);
  return entriesReady(data.fssSnapshotPolicies, policyIds);
}

export interface PvStorageTabProps {
  data: ClusterOciData;
  region: string | undefined;
  search: SearchState;
  clusterId: string;
}

export const PvStorageTab = observer(function PvStorageTab({ data, region, search, clusterId }: PvStorageTabProps) {
  const pvStore = Renderer.K8sApi.persistentVolumeStore;
  const [sort, toggleSort] = useColumnSort<PvColumn>("pv");
  const { query, setQuery } = search;

  if (!pvStore.isLoaded) {
    return <LoadingBlock />;
  }
  const pvs = pvStore.items;
  if (pvs.length === 0) {
    return <EmptyState message="No PersistentVolumes" />;
  }
  const resolved = pvs.map((pv) => {
    const csi = getCsiSource(pv.spec);
    return { pv, resolution: resolvePvStorage(csi?.driver, csi?.volumeHandle) };
  });
  // 行のOCI列が後から埋まるとテーブルがガタつくため、材料が揃ってから表を出す。
  if (
    !storageCellsReady(
      data,
      resolved.map((entry) => entry.resolution),
    )
  ) {
    return <LoadingBlock />;
  }

  const rows: PvRow[] = resolved.map(({ pv, resolution }) => {
    const claimRef = pv.spec.claimRef;
    return {
      key: pv.getId(),
      pvName: pv.getName(),
      pvcLabel: claimRef ? `${claimRef.namespace ?? "-"}/${claimRef.name}` : "-",
      storage: resolveStorage(data, resolution, clusterId),
    };
  });
  const sortedRows = sortRows(filterRows(rows, query, searchTextOf), SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      {!data.volumes.ok && <SectionError kind={data.volumes.kind} raw={data.volumes.raw} />}
      <SearchBar query={query} onChange={setQuery} placeholder="Search PV / PVC / entity name" />
      {sortedRows.length === 0 ? (
        <EmptyState message={`No volumes match "${query}"`} />
      ) : (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <SortableHeaderCell column="pv" sort={sort} onSort={toggleSort}>
                PV
              </SortableHeaderCell>
              <SortableHeaderCell column="pvc" sort={sort} onSort={toggleSort}>
                PVC
              </SortableHeaderCell>
              <SortableHeaderCell column="entity" sort={sort} onSort={toggleSort}>
                Entity Name
              </SortableHeaderCell>
              <SortableHeaderCell column="kind" sort={sort} onSort={toggleSort}>
                Kind
              </SortableHeaderCell>
              <SortableHeaderCell column="size" sort={sort} onSort={toggleSort}>
                Size (GB)
              </SortableHeaderCell>
              <SortableHeaderCell column="backup" sort={sort} onSort={toggleSort}>
                Backup
              </SortableHeaderCell>
              <SortableHeaderCell column="lifecycle" sort={sort} onSort={toggleSort}>
                lifecycle-state
              </SortableHeaderCell>
              <th style={TH_STYLE}>OCID</th>
              <th style={TH_STYLE} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const { storage } = row;
              if (storage.kindLabel === "Unsupported") {
                return (
                  <tr key={row.key} style={UNMATCHED_ROW_STYLE}>
                    <td style={TD_STYLE}>{row.pvName}</td>
                    <td style={TD_STYLE}>{row.pvcLabel}</td>
                    <td style={TD_STYLE} colSpan={6}>
                      Unsupported (no matching Block Volume / FSS found)
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={row.key} style={storage.orphaned ? UNMATCHED_ROW_STYLE : undefined}>
                  <td style={TD_STYLE}>{row.pvName}</td>
                  <td style={TD_STYLE}>{row.pvcLabel}</td>
                  <td style={TD_STYLE}>
                    {storage.displayName}
                    {storage.inferred && (
                      <span style={{ ...NOTE_STYLE, marginLeft: 6 }} title={INFERRED_TITLE}>
                        ({INFERRED_LABEL})
                      </span>
                    )}
                    {storage.handleNote && <div style={NOTE_STYLE}>{storage.handleNote}</div>}
                    <ClusterTagNotes mismatches={storage.tagMismatches} />
                  </td>
                  <td style={TD_STYLE}>{storage.kindLabel}</td>
                  <td style={TD_STYLE}>{storage.kindLabel === "Volume" ? (storage.sizeGb ?? "-") : "-"}</td>
                  <td style={TD_STYLE}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {storage.backupLabel}
                      {storage.backupPolicyId && storage.backupConsoleType && region && (
                        <ConsoleButton type={storage.backupConsoleType} ocid={storage.backupPolicyId} region={region} />
                      )}
                    </span>
                  </td>
                  <td style={TD_STYLE}>
                    <LifecycleBadge state={storage.lifecycleState} />
                  </td>
                  <td style={TD_STYLE}>{storage.ocid ? <OcidCopyButton ocid={storage.ocid} /> : "-"}</td>
                  <td style={TD_STYLE}>
                    {storage.ocid && storage.consoleType && region && (
                      <ConsoleButton type={storage.consoleType} ocid={storage.ocid} region={region} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
});
